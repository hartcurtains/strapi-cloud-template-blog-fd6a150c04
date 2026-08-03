'use strict';

const crypto = require('node:crypto');
const { loadProductionMappings, normalizeCanonicalColourName, normalizeToken } = require('../../shared/ashley-wilde-mapping');
const supplierMappings = require('./supplier-mapping');
const { ensureColourDiagnosticId, logColourDiagnostic } = require('../utils/ashleyWildeDiagnostics');

const IDENTITY_UID = 'api::fabric-colour-identity.fabric-colour-identity';
const ASSET_UID = 'api::fabric-colour-asset.fabric-colour-asset';
const COLOUR_UID = 'api::colour.colour';
const SUPPLIER = 'Ashley Wilde';
const ALL_SUPPLIERS = '__ALL_SUPPLIERS__';
const PROMOTABLE_ASSET_TYPES = new Set(['ordinary_colour', 'full_colour_name', 'numbered_alternate']);
const PLAN_TTL_MS = 10 * 60 * 1000;

function key(value) { return String(value || '').normalize('NFKC').trim().toUpperCase(); }
function isAllSuppliers(value) { return key(value) === key(ALL_SUPPLIERS); }
function selectedSupplier(value = SUPPLIER) {
  const supplier = String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!supplier) {
    const error = new Error('Select a supplier before previewing or promoting staged colours.');
    error.code = 'SUPPLIER_REQUIRED';
    throw error;
  }
  return supplier;
}
function supplierFromOptions(options = {}) {
  return Object.prototype.hasOwnProperty.call(options, 'supplier') ? selectedSupplier(options.supplier) : SUPPLIER;
}
function promotionScopeLabel(supplier) { return isAllSuppliers(supplier) ? 'All brands' : supplier; }
function relationKey(value) { return value?.documentId || value?.id || value; }
function entityRelationId(value) { return value?.id || value?.documentId || value; }
function first(value) { return Array.isArray(value) ? value[0] : value; }
function identityDocumentId(identity) { return identity.documentId || identity.id; }
function stableEntityKey(value) {
  return [
    String(value?.documentId || ''),
    String(value?.id || ''),
    String(value?.assetType || ''),
    String(value?.sha256 || ''),
  ].join('|');
}
function stableEntities(values) {
  return [...(values || [])].sort((left, right) => stableEntityKey(left).localeCompare(stableEntityKey(right)));
}
function registryEntries(mappings) {
  return Object.entries(mappings?.codeRegistry?.codes || {})
    .map(([code, entry]) => [normalizeToken(code), entry])
    .filter(([code, entry]) => code && entry?.colourName)
    .sort(([left], [right]) => left.localeCompare(right));
}
function resolveInternalColourCode(identity, mappings) {
  const officialName = normalizeCanonicalColourName(identity.officialColourName);
  const currentCode = normalizeToken(identity.internalColourCode);
  const entries = registryEntries(mappings);
  const currentOwner = entries.find(([code]) => code === currentCode)?.[1];
  if (currentCode && normalizeCanonicalColourName(currentOwner?.colourName) === officialName) {
    return { code: currentCode, repaired: false, generated: false };
  }
  const canonical = entries.find(([, entry]) => normalizeCanonicalColourName(entry.colourName) === officialName);
  if (canonical) return { code: canonical[0], repaired: canonical[0] !== currentCode, generated: false };

  const digest = crypto.createHash('sha256').update(officialName || key(identity.officialColourName), 'utf8').digest('hex').toUpperCase();
  for (let length = 8; length <= digest.length; length += 2) {
    const candidate = `AW${digest.slice(0, length)}`;
    const owner = entries.find(([code]) => code === candidate)?.[1];
    if (!owner || normalizeCanonicalColourName(owner.colourName) === officialName) {
      mappings.codeRegistry.codes[candidate] = { colourName: identity.officialColourName, generated: true };
      return { code: candidate, repaired: candidate !== currentCode, generated: true };
    }
  }
  throw new Error(`Unable to allocate a deterministic internal colour code for ${identity.officialColourName}`);
}
function reconcileIdentityInternalCode(identity, mappings) {
  const resolution = resolveInternalColourCode(identity, mappings);
  return {
    ...identity,
    storedInternalColourCode: identity.internalColourCode || null,
    internalColourCode: resolution.code,
    internalCodeReconciled: resolution.repaired,
    internalCodeGenerated: resolution.generated,
  };
}
function existingFabricColour(identity) {
  const fabric = first(identity.fabric);
  const expectedName = normalizeCanonicalColourName(identity.officialColourName);
  if (!expectedName || !Array.isArray(fabric?.colours)) return null;
  return stableEntities(fabric.colours).find((colour) => normalizeCanonicalColourName(colour?.name) === expectedName) || null;
}
function existingColourScopeReasons(matching) {
  return matching?.alreadyLinkedToFabric ? ['colour_already_exists_for_fabric'] : [];
}
function hasFabric(colour, fabric) {
  const expected = String(relationKey(fabric));
  return Array.isArray(colour?.fabrics) && colour.fabrics.some((item) => String(relationKey(item)) === expected);
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items || []) {
    const value = keyFn(item);
    if (!value) continue;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(item);
  }
  return groups;
}

function validateIdentitySet(identities) {
  const reasonsByIdentity = new Map();
  const addReason = (identity, reason) => {
    const id = identityDocumentId(identity);
    if (!reasonsByIdentity.has(id)) reasonsByIdentity.set(id, new Set());
    reasonsByIdentity.get(id).add(reason);
  };
  const duplicateFabricColourCodes = [];
  const duplicateIdentityScopes = [];
  const internalCodeCollisions = [];

  for (const [value, rows] of groupBy(identities, (identity) => key(identity.fabricColourCode)).entries()) {
    if (rows.length < 2) continue;
    const ids = rows.map(identityDocumentId);
    duplicateFabricColourCodes.push({ value, identityDocumentIds: ids });
    rows.forEach((identity) => addReason(identity, 'duplicate_fabric_colour_code'));
  }
  for (const [value, rows] of groupBy(identities, (identity) => [
    key(identity.supplier), String(relationKey(identity.fabric)), key(identity.supplierProductCode), key(identity.supplierColourCode),
  ].join('|')).entries()) {
    if (rows.length < 2) continue;
    const ids = rows.map(identityDocumentId);
    duplicateIdentityScopes.push({ value, identityDocumentIds: ids });
    rows.forEach((identity) => addReason(identity, 'duplicate_identity_scope'));
  }
  for (const [value, rows] of groupBy(identities, (identity) => key(identity.internalColourCode)).entries()) {
    const names = [...new Set(rows.map((identity) => normalizeCanonicalColourName(identity.officialColourName)).filter(Boolean))];
    if (!value || names.length < 2) continue;
    const ids = rows.map(identityDocumentId);
    internalCodeCollisions.push({ value, officialColourNames: [...new Set(rows.map((identity) => identity.officialColourName).filter(Boolean))], identityDocumentIds: ids });
    rows.forEach((identity) => addReason(identity, 'internal_code_collision'));
  }
  return { reasonsByIdentity, duplicateFabricColourCodes, duplicateIdentityScopes, internalCodeCollisions };
}

function allocateSharedCollisionCode(identity, mappings, usedCodes) {
  const officialName = normalizeCanonicalColourName(identity.officialColourName);
  const seed = [
    officialName || key(identity.officialColourName),
    key(identity.supplier),
    String(identity.fabricDocumentId || relationKey(first(identity.fabric))),
    key(identity.supplierProductCode),
    key(identity.supplierColourCode),
  ].join('|');
  const digest = crypto.createHash('sha256').update(seed, 'utf8').digest('hex').toUpperCase();
  const entries = registryEntries(mappings);
  for (let length = 8; length <= digest.length; length += 2) {
    const candidate = `AW${digest.slice(0, length)}`;
    if (usedCodes.has(candidate)) continue;
    const owner = entries.find(([code]) => code === candidate)?.[1];
    if (owner && normalizeCanonicalColourName(owner.colourName) !== officialName) continue;
    mappings.codeRegistry.codes[candidate] = { colourName: identity.officialColourName, generated: true };
    usedCodes.add(candidate);
    return candidate;
  }
  throw new Error(`Unable to allocate a deterministic internal colour code for ${identity.officialColourName}`);
}

function repairSharedInternalCodeCollisions(identities, mappingsByIdentityId) {
  const collisionIds = new Set();
  for (const rows of groupBy(identities, (identity) => key(identity.internalColourCode)).values()) {
    const names = new Set(rows.map((identity) => normalizeCanonicalColourName(identity.officialColourName)).filter(Boolean));
    if (rows.length < 2 || names.size < 2) continue;
    rows.slice().sort((left, right) => String(identityDocumentId(left)).localeCompare(String(identityDocumentId(right))))
      .slice(1)
      .forEach((identity) => collisionIds.add(identityDocumentId(identity)));
  }
  if (!collisionIds.size) return identities;

  const usedCodes = new Set();
  for (const identity of identities) if (identity.internalColourCode) usedCodes.add(normalizeToken(identity.internalColourCode));
  for (const mappings of mappingsByIdentityId.values()) for (const [code] of registryEntries(mappings)) usedCodes.add(code);
  return identities.map((identity) => {
    if (!collisionIds.has(identityDocumentId(identity))) return identity;
    const mappings = mappingsByIdentityId.get(identityDocumentId(identity));
    if (!mappings) return identity;
    const internalColourCode = allocateSharedCollisionCode(identity, mappings, usedCodes);
    return { ...identity, internalColourCode, internalCodeReconciled: true, internalCodeGenerated: true };
  });
}

function exactLegacyIdentity(row, identity) {
  const fields = ['supplier', 'fabricDocumentId', 'supplierProductCode', 'supplierColourCode'];
  const present = fields.filter((field) => row?.[field] !== undefined && row?.[field] !== null && row[field] !== '');
  if (present.length !== fields.length) return { exact: false, conflict: false };
  return {
    exact: key(row.supplier) === key(identity.supplier)
      && String(row.fabricDocumentId) === String(identity.fabricDocumentId)
      && key(row.supplierProductCode) === key(identity.supplierProductCode)
      && key(row.supplierColourCode) === key(identity.supplierColourCode),
    conflict: false,
  };
}

async function loadColourRows(strapi) {
  const rows = [];
  const pageSize = 1000;
  let start = 0;
  while (true) {
    const page = await strapi.entityService.findMany(COLOUR_UID, { populate: ['fabrics', 'thumbnail'], sort: ['documentId:asc'], start, limit: pageSize });
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < pageSize) break;
    start += page.length;
  }
  return rows;
}

async function findMatchingColour(strapi, identity, options = {}) {
  if (identity.promotedColour) return { colour: identity.promotedColour, conflict: false, priority: 'promoted_relation', alreadyLinkedToFabric: true };
  const linkedColour = existingFabricColour(identity);
  if (linkedColour) return { colour: linkedColour, conflict: false, priority: 'fabric_canonical_colour_name', alreadyLinkedToFabric: true };
  const rows = Array.isArray(options.colourRows) ? options.colourRows : await loadColourRows(strapi);
  for (const row of stableEntities(rows)) {
    if (exactLegacyIdentity(row, identity).exact) return { colour: row, conflict: false, priority: 'exact_legacy_identity', alreadyLinkedToFabric: hasFabric(row, first(identity.fabric)) };
  }
  // Colour records without the complete legacy identity are not evidence of a conflict.
  // Names, internal codes, suffixes, and filenames are deliberately not match keys.
  return { colour: null, conflict: false, priority: null, alreadyLinkedToFabric: false };
}

async function loadIdentity(strapi, identityId) {
  const populate = { populate: ['fabric', 'fabric.brand', 'fabric.colours', 'assets', 'assets.media', 'assets.existingMedia', 'promotedColour'] };
  let identity = await strapi.entityService.findOne(IDENTITY_UID, identityId, populate);
  if (!identity) {
    const matches = await strapi.entityService.findMany(IDENTITY_UID, { filters: { documentId: { $eq: identityId } }, ...populate, limit: 1 });
    identity = matches?.[0] || null;
  }
  if (!identity) throw new Error('Fabric colour identity was not found');
  return identity;
}

async function loadPromotionMappings(strapi, requestedSupplier = SUPPLIER) {
  const supplier = selectedSupplier(requestedSupplier);
  const active = await supplierMappings.getActiveImporterMappings(strapi, supplier);
  if (active) {
    const registry = await supplierMappings.loadRegistry(strapi, supplier);
    const codes = {};
    for (const [code, entry] of registry.byCode.entries()) codes[code] = { colourName: entry.canonicalColourName || entry.normalizedColourName || entry.colourName };
    return {
      codeRegistry: { codes },
      supplier,
      mappingVersion: active.version.version || active.version.documentId,
      mappingSource: 'strapi-active-version',
      mappingDocumentId: active.version.documentId || null,
      mappingRowCount: Array.isArray(active.rows) ? active.rows.length : null,
      activeVersionsFound: active.activeVersionsFound || 1,
    };
  }
  if (key(supplier) !== key(SUPPLIER)) {
    const error = new Error(`No active colour mapping version exists for ${supplier}.`);
    error.code = 'SUPPLIER_MAPPING_NOT_FOUND';
    throw error;
  }
  const fallback = loadProductionMappings({ mode: 'production' });
  return { ...fallback, supplier, mappingVersion: fallback.colourMap.generatedAt || null, mappingSource: 'repository-fallback', mappingDocumentId: null, mappingRowCount: null, activeVersionsFound: 0 };
}

async function loadPromotionMappingScope(strapi, requestedSupplier = SUPPLIER) {
  const supplier = selectedSupplier(requestedSupplier);
  if (!isAllSuppliers(supplier)) {
    const mappings = await loadPromotionMappings(strapi, supplier);
    return { allSuppliers: false, supplier, mappings, bySupplier: new Map([[key(supplier), mappings]]) };
  }
  const activeSuppliers = await supplierMappings.listActiveMappingSuppliers(strapi);
  if (!activeSuppliers.length) {
    const error = new Error('No active colour mapping versions exist for any supplier.');
    error.code = 'SUPPLIER_MAPPING_NOT_FOUND';
    throw error;
  }
  const loaded = await Promise.all(activeSuppliers.map(async (entry) => ({
    supplier: entry.supplier,
    mappings: await loadPromotionMappings(strapi, entry.supplier),
  })));
  return {
    allSuppliers: true,
    supplier: ALL_SUPPLIERS,
    mappings: null,
    bySupplier: new Map(loaded.map((entry) => [key(entry.supplier), entry.mappings])),
    suppliers: loaded.map((entry) => ({
      supplier: entry.supplier,
      mappingVersion: entry.mappings.mappingVersion || null,
      mappingDocumentId: entry.mappings.mappingDocumentId || null,
      mappingRowCount: entry.mappings.mappingRowCount || null,
      activeVersionsFound: entry.mappings.activeVersionsFound ?? null,
    })),
  };
}

function mappingForIdentity(mappingScope, identity) {
  return mappingScope.bySupplier.get(key(identity?.supplier)) || null;
}

function mappingScopeMetadata(mappingScope) {
  if (!mappingScope.allSuppliers) {
    return [{
      supplier: mappingScope.supplier,
      mappingVersion: mappingScope.mappings.mappingVersion || null,
      mappingDocumentId: mappingScope.mappings.mappingDocumentId || null,
      mappingRowCount: mappingScope.mappings.mappingRowCount || null,
      activeVersionsFound: mappingScope.mappings.activeVersionsFound ?? null,
    }];
  }
  return mappingScope.suppliers || [];
}

function fabricBelongsToSupplier(fabric, supplier) {
  const brands = Array.isArray(fabric?.brand) ? fabric.brand : [fabric?.brand];
  return brands.some((brand) => key(brand?.name || brand?.attributes?.name) === key(supplier));
}

function eligibility(identity, mappings, requestedSupplier = mappings?.supplier || SUPPLIER) {
  const supplier = selectedSupplier(requestedSupplier);
  const reasons = [];
  if (identity.mappingStatus !== 'verified') reasons.push('mapping_status_not_verified');
  if (!['verified_manual', 'verified_official'].includes(identity.evidenceStatus)) reasons.push('evidence_not_acceptable');
  if (!identity.supplier) reasons.push('supplier_missing');
  if (key(identity.supplier) !== key(supplier)) reasons.push('supplier_mismatch');
  if (!identity.supplierProductCode) reasons.push('supplier_product_code_missing');
  if (!identity.supplierColourCode) reasons.push('supplier_colour_code_missing');
  if (!identity.fabricColourCode || normalizeToken(identity.fabricColourCode) !== normalizeToken(`${identity.supplierProductCode}${identity.supplierColourCode}`)) reasons.push('fabric_colour_code_invalid');
  if (!identity.officialColourName) reasons.push('official_colour_name_missing');
  const registryEntry = mappings.codeRegistry.codes[normalizeToken(identity.internalColourCode)];
  if (!identity.internalColourCode || !registryEntry || normalizeCanonicalColourName(registryEntry.colourName) !== normalizeCanonicalColourName(identity.officialColourName)) reasons.push('internal_code_invalid_or_semantic_collision');
  const fabric = first(identity.fabric);
  if (!fabric || !fabric.documentId || String(fabric.documentId) !== String(identity.fabricDocumentId)) reasons.push('fabric_relation_not_unique_or_scalar_disagrees');
  if (key(supplier) !== key(SUPPLIER) && (!fabricBelongsToSupplier(fabric, supplier))) reasons.push('fabric_brand_supplier_mismatch');
  const assets = Array.isArray(identity.assets) ? identity.assets : [];
  if (assets.some((asset) => asset.duplicateStatus === 'conflicting_image' || asset.conflictGroup)) reasons.push('unresolved_asset_conflict');
  const approvedAssets = stableEntities(assets.filter((asset) => asset.importStatus === 'staged' && PROMOTABLE_ASSET_TYPES.has(asset.assetType) && (asset.media || asset.existingMedia)));
  if (!approvedAssets.length) reasons.push('no_approved_promotable_asset');
  return { eligible: reasons.length === 0, reasons, approvedAssets };
}

function buildPlan(identity, matching, eligible, scopeReasons = []) {
  const colour = matching.colour;
  const asset = eligible.approvedAssets[0];
  const fabric = first(identity.fabric);
  return {
    identityDocumentId: identityDocumentId(identity),
    identityKey: identity.identityKey,
    fabricName: fabric?.name || null,
    fabricDocumentId: identity.fabricDocumentId,
    supplierProductCode: identity.supplierProductCode,
    supplierColourCode: identity.supplierColourCode,
    fabricColourCode: identity.fabricColourCode,
    officialColourName: identity.officialColourName,
    internalColourCode: identity.internalColourCode,
    internalCodeDecision: identity.internalCodeReconciled ? (identity.internalCodeGenerated ? 'generate_deterministic_code' : 'repair_to_canonical_code') : 'reuse_verified_code',
    mappingStatus: identity.mappingStatus,
    evidenceStatus: identity.evidenceStatus,
    action: matching.conflict ? 'promotion_conflict' : colour ? 'match_existing_colour' : 'create_colour',
    colourDecision: colour ? 'reuse_existing_colour' : 'create_new_colour',
    matchPriority: matching.priority,
    existingColourDocumentId: colour?.documentId || colour?.id || null,
    stagedAssetDocumentIds: eligible.approvedAssets.map((item) => item.documentId || item.id),
    stagedMediaId: first(asset)?.media?.documentId || first(asset)?.media?.id || first(asset)?.media || first(asset)?.existingMedia?.documentId || first(asset)?.existingMedia?.id || first(asset)?.existingMedia || null,
    assetDecision: asset ? 'reuse_staged_media' : 'blocked_no_approved_asset',
    eligible: eligible.eligible && !matching.conflict && scopeReasons.length === 0,
    skippedReasons: [...eligible.reasons, ...scopeReasons, ...(matching.conflict ? ['existing_colour_identity_conflict'] : [])],
    alreadyExistsForFabric: Boolean(matching.alreadyLinkedToFabric),
    preserveExistingThumbnail: Boolean(colour?.thumbnail),
    preserveExistingFabricRelations: Boolean(colour?.fabrics?.length),
  };
}

function identitySnapshot(identity) {
  return {
    identityDocumentId: identityDocumentId(identity),
    updatedAt: identity.updatedAt || null,
    mappingStatus: identity.mappingStatus || null,
    evidenceStatus: identity.evidenceStatus || null,
    mappingVersion: identity.mappingVersion || null,
    supplier: identity.supplier || null,
    fabricDocumentId: identity.fabricDocumentId || null,
    supplierProductCode: identity.supplierProductCode || null,
    supplierColourCode: identity.supplierColourCode || null,
    fabricColourCode: identity.fabricColourCode || null,
    officialColourName: identity.officialColourName || null,
    storedInternalColourCode: identity.storedInternalColourCode ?? identity.internalColourCode ?? null,
    internalColourCode: identity.internalColourCode || null,
    promotedColour: relationKey(identity.promotedColour) || null,
    assets: (identity.assets || []).map((asset) => ({ documentId: asset.documentId || asset.id, updatedAt: asset.updatedAt || null, sha256: asset.sha256 || null, importStatus: asset.importStatus || null, duplicateStatus: asset.duplicateStatus || null, media: relationKey(asset.media) || relationKey(asset.existingMedia) || null })).sort((a, b) => String(a.documentId).localeCompare(String(b.documentId))),
  };
}

function stableFingerprint(value) { return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }

function scopeFilters(options = {}) {
  const supplier = supplierFromOptions(options);
  const filters = isAllSuppliers(supplier) ? {} : { supplier };
  if (options.supplierProductCode) filters.supplierProductCode = { $eq: options.supplierProductCode };
  if (options.fabricName) filters.fabric = { name: { $eqi: options.fabricName } };
  if (Array.isArray(options.identityDocumentIds) && options.identityDocumentIds.length) filters.documentId = { $in: options.identityDocumentIds };
  return filters;
}

async function scopedIdentities(strapi, options = {}) {
  const requestedLimit = Number(options.limit);
  const hasRequestedLimit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0;
  const maximumRows = hasRequestedLimit ? requestedLimit : Number.POSITIVE_INFINITY;
  const pageSize = Math.min(1000, maximumRows);
  const rows = [];
  let start = 0;
  while (rows.length < maximumRows) {
    const limit = Math.min(pageSize, maximumRows - rows.length);
    const page = await strapi.entityService.findMany(IDENTITY_UID, {
      filters: scopeFilters(options),
      populate: ['fabric', 'fabric.brand', 'fabric.colours', 'assets', 'assets.media', 'assets.existingMedia', 'promotedColour'],
      sort: ['documentId:asc'],
      start,
      limit,
    });
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < limit) break;
    start += page.length;
  }
  return rows;
}

async function previewPromotion(strapi, options = {}) {
  const diagnosticRequestId = ensureColourDiagnosticId(options.diagnosticRequestId);
  const supplier = supplierFromOptions(options);
  const mappingScope = options.mappings
    ? (() => {
      const mappings = { ...options.mappings, supplier: options.mappings.supplier || supplier };
      return { allSuppliers: false, supplier, mappings, bySupplier: new Map([[key(supplier), mappings]]) };
    })()
    : await loadPromotionMappingScope(strapi, supplier);
  const mappingMetadata = mappingScopeMetadata(mappingScope);
  logColourDiagnostic(strapi, 'colour-preview-request', {
    diagnosticRequestId,
    route: '/order-management/ashley-wilde/promote/preview',
    supplier: promotionScopeLabel(supplier),
    fabricName: options.fabricName || null,
    supplierProductCode: options.supplierProductCode || null,
    identityDocumentIdCount: Array.isArray(options.identityDocumentIds) ? options.identityDocumentIds.length : 0,
  });
  if (!mappingScope.allSuppliers && key(mappingScope.mappings.supplier) !== key(supplier)) throw new Error(`The selected mapping belongs to ${mappingScope.mappings.supplier || 'an unknown supplier'}, not ${supplier}.`);
  logColourDiagnostic(strapi, 'mapping-selection', {
    diagnosticRequestId,
    requestedSupplier: supplier,
    selectedMappingSuppliers: mappingMetadata,
    mappingSource: mappingScope.allSuppliers ? 'multiple-strapi-active-versions' : mappingScope.mappings.mappingSource || null,
    lookupFilter: mappingScope.allSuppliers ? { status: 'active', isActive: true } : { supplier, status: 'active', isActive: true },
  });
  const allIdentities = await scopedIdentities(strapi, { ...options, supplier });
  const statusBreakdown = new Map();
  for (const identity of allIdentities || []) {
    const identitySupplier = identity.supplier || '(missing supplier)';
    const entry = statusBreakdown.get(key(identitySupplier)) || { supplier: identitySupplier, total: 0, verified: 0, pending: 0, promoted: 0, other: 0, mappingMatched: 0 };
    entry.total += 1;
    if (identity.mappingStatus === 'verified') entry.verified += 1;
    else if (identity.mappingStatus === 'pending') entry.pending += 1;
    else if (identity.mappingStatus === 'promoted') entry.promoted += 1;
    else entry.other += 1;
    if (mappingForIdentity(mappingScope, identity)) entry.mappingMatched += 1;
    statusBreakdown.set(key(identitySupplier), entry);
  }
  const candidateIdentities = (allIdentities || []).filter((identity) => identity.mappingStatus === 'verified');
  const mappingsByIdentityId = new Map();
  const reconciledIdentities = candidateIdentities.map((identity) => {
    const mappings = mappingForIdentity(mappingScope, identity);
    mappingsByIdentityId.set(identityDocumentId(identity), mappings);
    return mappings ? reconcileIdentityInternalCode(identity, mappings) : identity;
  });
  const identities = repairSharedInternalCodeCollisions(reconciledIdentities, mappingsByIdentityId);
  const reconciledById = new Map(identities.map((identity) => [identityDocumentId(identity), identity]));
  const validation = validateIdentitySet(identities);
  const colourRows = identities.length ? await loadColourRows(strapi) : [];
  const results = [];
  for (const identity of identities) {
    const mappings = mappingsByIdentityId.get(identityDocumentId(identity));
    if (!mappings) {
      results.push({ identityDocumentId: identityDocumentId(identity), eligible: false, action: 'blocked', colourDecision: null, skippedReasons: ['active_mapping_missing_for_supplier'] });
      continue;
    }
    try {
      const identitySupplier = identity.supplier || supplier;
      const eligible = eligibility(identity, mappings, identitySupplier);
      const matching = await findMatchingColour(strapi, identity, { colourRows });
      const scopeReasons = [
        ...(validation.reasonsByIdentity.get(identityDocumentId(identity)) || []),
        ...existingColourScopeReasons(matching),
      ];
      results.push(buildPlan(identity, matching, eligible, scopeReasons));
    } catch (error) {
      results.push({ identityDocumentId: identityDocumentId(identity), eligible: false, action: 'blocked', colourDecision: null, skippedReasons: [error.message] });
    }
  }
  const orderedResults = results.sort((a, b) => String(a.identityDocumentId).localeCompare(String(b.identityDocumentId)));
  const summary = {
    identitiesFound: allIdentities?.length || 0,
    verifiedCandidates: candidateIdentities.length,
    mappingMatchedCandidates: identities.filter((identity) => mappingsByIdentityId.get(identityDocumentId(identity))).length,
    eligible: orderedResults.filter((item) => item.eligible).length,
    blocked: orderedResults.filter((item) => !item.eligible).length,
    existingColoursToReuse: orderedResults.filter((item) => item.eligible && item.colourDecision === 'reuse_existing_colour').length,
    newColours: orderedResults.filter((item) => item.eligible && item.colourDecision === 'create_new_colour').length,
    mediaToReuse: orderedResults.filter((item) => item.eligible && item.assetDecision === 'reuse_staged_media').length,
    conflicts: orderedResults.filter((item) => item.skippedReasons?.includes('existing_colour_identity_conflict') || item.skippedReasons?.includes('unresolved_asset_conflict')).length,
    skippedExistingColours: orderedResults.filter((item) => item.skippedReasons?.includes('colour_already_exists_for_fabric')).length,
    skippedExistingFabrics: new Set(orderedResults.filter((item) => item.skippedReasons?.includes('colour_already_exists_for_fabric')).map((item) => item.fabricDocumentId)).size,
    duplicateFabricColourCodes: validation.duplicateFabricColourCodes,
    duplicateIdentityScopes: validation.duplicateIdentityScopes,
    internalCodeCollisions: validation.internalCodeCollisions,
  };
  const expiresAt = new Date(Date.now() + PLAN_TTL_MS).toISOString();
  const snapshot = (allIdentities || []).map((identity) => identitySnapshot(reconciledById.get(identityDocumentId(identity)) || identity)).sort((a, b) => String(a.identityDocumentId).localeCompare(String(b.identityDocumentId)));
  const scope = { supplier, supplierProductCode: options.supplierProductCode || null, fabricName: options.fabricName || null, identityDocumentIds: Array.isArray(options.identityDocumentIds) ? [...options.identityDocumentIds].sort() : null };
  const planFingerprint = stableFingerprint({ scope, mappingVersions: mappingMetadata, snapshot, results: orderedResults });
  const singleMapping = mappingScope.allSuppliers ? null : mappingScope.mappings;
  const totalMappingRows = mappingMetadata.reduce((total, item) => total + Number(item.mappingRowCount || 0), 0);
  const diagnostics = {
    diagnosticRequestId,
    selectedSupplier: promotionScopeLabel(supplier),
    mappingSupplier: mappingScope.allSuppliers ? 'All brands' : singleMapping.supplier || supplier,
    mappingVersion: singleMapping?.mappingVersion || null,
    mappingVersionDocumentId: singleMapping?.mappingDocumentId || null,
    mappingRowCount: mappingScope.allSuppliers ? totalMappingRows : singleMapping?.mappingRowCount || null,
    activeVersionsFound: mappingScope.allSuppliers ? mappingMetadata.length : singleMapping?.activeVersionsFound ?? null,
    mappingSuppliers: mappingMetadata,
    statusBreakdown: [...statusBreakdown.values()].sort((left, right) => left.supplier.localeCompare(right.supplier)),
    firstIdentity: candidateIdentities[0] ? {
      identityDocumentId: identityDocumentId(candidateIdentities[0]),
      supplier: candidateIdentities[0].supplier || null,
      supplierProductCode: candidateIdentities[0].supplierProductCode || null,
      supplierColourCode: candidateIdentities[0].supplierColourCode || null,
      fabricColourCode: candidateIdentities[0].fabricColourCode || null,
      fabricDocumentId: candidateIdentities[0].fabricDocumentId || null,
      fabricName: first(candidateIdentities[0].fabric)?.name || null,
      brandName: first(candidateIdentities[0].fabric)?.brand?.name || first(candidateIdentities[0].fabric)?.brand?.[0]?.name || null,
    } : null,
  };
  logColourDiagnostic(strapi, 'colour-preview-complete', {
    diagnosticRequestId,
    supplier: promotionScopeLabel(supplier),
    identityCount: candidateIdentities.length,
    eligible: summary.eligible,
    blocked: summary.blocked,
    mappingVersions: mappingMetadata,
  });
  return { planFingerprint, planExpiresAt: expiresAt, scope, mappingVersion: singleMapping?.mappingVersion || null, mappingSource: mappingScope.allSuppliers ? 'multiple-strapi-active-versions' : singleMapping?.mappingSource || null, mappingSuppliers: mappingMetadata, identityDocumentIds: candidateIdentities.map(identityDocumentId), snapshot, summary, results: orderedResults, diagnostics, committed: false };
}

async function inTransaction(strapi, callback) {
  if (!strapi.db?.transaction) throw new Error('Promotion requires the Strapi database transaction service.');
  return strapi.db.transaction(({ trx }) => callback(trx));
}

async function promoteIdentity(strapi, identityId, options = {}) {
  const supplier = supplierFromOptions(options);
  const mappings = options.mappings || await loadPromotionMappings(strapi, supplier);
  const identity = reconcileIdentityInternalCode(await loadIdentity(strapi, identityId), mappings);
  const eligible = eligibility(identity, mappings, supplier);
  const matching = await findMatchingColour(strapi, identity, { colourRows: options.colourRows });
  const scopeReasons = [...(options.scopeReasons || []), ...existingColourScopeReasons(matching)];
  const plan = buildPlan(identity, matching, eligible, scopeReasons);
  if (options.commit !== true || !plan.eligible) return { ...plan, committed: false };
  const result = await inTransaction(strapi, async (trx) => {
    const latest = reconcileIdentityInternalCode(await loadIdentity(strapi, identity.id), mappings);
    const latestEligible = eligibility(latest, mappings, supplier);
    if (!latestEligible.eligible) throw new Error(`Promotion eligibility changed: ${latestEligible.reasons.join(', ')}`);
    const latestMatching = await findMatchingColour(strapi, latest, { colourRows: options.colourRows });
    if (latestMatching.conflict) throw new Error('Existing Colour identity conflicts with the staged identity.');
    if (existingColourScopeReasons(latestMatching).length) throw new Error('colour_already_exists_for_fabric');
    const asset = latestEligible.approvedAssets[0];
    const fabricId = entityRelationId(latest.fabric);
    const mediaId = entityRelationId(asset.media) || entityRelationId(asset.existingMedia);
    let colour = latestMatching.colour;
    let colourWasCreated = false;
    if (!colour) {
      colour = await strapi.entityService.create(COLOUR_UID, { data: { name: latest.officialColourName, thumbnail: mediaId, fabrics: fabricId ? [fabricId] : undefined, publishedAt: new Date() }, transacting: trx });
      colourWasCreated = true;
    } else {
      const update = {};
      if (!hasFabric(colour, latest.fabric) && fabricId) update.fabrics = { connect: [fabricId] };
      if (Object.keys(update).length) colour = await strapi.entityService.update(COLOUR_UID, colour.id, { data: update, transacting: trx });
    }
    const promotedRelationId = entityRelationId(colour);
    const promotedId = colour.documentId || colour.id;
    await strapi.entityService.update(IDENTITY_UID, latest.id, { data: {
      mappingStatus: 'promoted',
      promotedColour: { connect: [promotedRelationId] },
      ...(latest.internalCodeReconciled ? { internalColourCode: latest.internalColourCode } : {}),
    }, transacting: trx });
    for (const assetItem of latestEligible.approvedAssets) await strapi.entityService.update(ASSET_UID, assetItem.id, { data: { importStatus: 'promoted' }, transacting: trx });
    return { colour, colourWasCreated, promotedId, latest };
  });
  const committedPlan = buildPlan(result.latest, { colour: result.colour, conflict: false, priority: matching.priority || 'created_colour', alreadyLinkedToFabric: true }, eligibility(result.latest, mappings, supplier), options.scopeReasons || []);
  return {
    ...committedPlan,
    action: result.colourWasCreated ? 'create_colour' : 'match_existing_colour',
    colourDecision: result.colourWasCreated ? 'create_new_colour' : 'reuse_existing_colour',
    committed: true,
    promotedColourDocumentId: result.promotedId,
  };
}

async function promoteVerified(strapi, options = {}) {
  const diagnosticRequestId = ensureColourDiagnosticId(options.diagnosticRequestId);
  const supplier = supplierFromOptions(options);
  logColourDiagnostic(strapi, 'colour-promote-request', {
    diagnosticRequestId,
    route: '/order-management/ashley-wilde/promote/apply',
    supplier: promotionScopeLabel(supplier),
    hasPlanFingerprint: Boolean(options.planFingerprint),
    identityDocumentIdCount: Array.isArray(options.identityDocumentIds) ? options.identityDocumentIds.length : 0,
  });
  const mappingScope = await loadPromotionMappingScope(strapi, supplier);
  const singleMappings = mappingScope.allSuppliers ? null : mappingScope.mappings;
  if (options.commit === true && options.planFingerprint) {
    if (options.planExpiresAt && Date.parse(options.planExpiresAt) <= Date.now()) throw new Error('The promotion preview has expired. Run Preview promotion again.');
    const previewOptions = { ...options, supplier, identityDocumentIds: undefined, commit: false, diagnosticRequestId };
    if (singleMappings) previewOptions.mappings = singleMappings;
    else delete previewOptions.mappings;
    const current = await previewPromotion(strapi, previewOptions);
    if (current.planFingerprint !== options.planFingerprint) throw new Error('The promotion preview is stale because staging, mapping, scope, or eligibility changed. Run Preview promotion again.');
    const expected = [...(options.identityDocumentIds || [])].sort().join('|');
    if (expected !== current.identityDocumentIds.slice().sort().join('|')) throw new Error('The promotion scope no longer matches the approved preview. Run Preview promotion again.');
  }
  const identities = await scopedIdentities(strapi, { ...options, supplier });
  const verifiedEntries = (identities || [])
    .filter((identity) => identity.mappingStatus === 'verified')
    .map((identity) => {
      const mappings = mappingForIdentity(mappingScope, identity);
      return { identity: mappings ? reconcileIdentityInternalCode(identity, mappings) : identity, mappings };
    });
  const mappingsByIdentityId = new Map(verifiedEntries.map((entry) => [identityDocumentId(entry.identity), entry.mappings]));
  const verified = repairSharedInternalCodeCollisions(verifiedEntries.map((entry) => entry.identity), mappingsByIdentityId);
  const validation = validateIdentitySet(verified);
  const colourRows = verified.length ? await loadColourRows(strapi) : [];
  const results = [];
  for (const identity of verified) {
    const mappings = mappingsByIdentityId.get(identityDocumentId(identity));
    if (!mappings) {
      results.push({ identityDocumentId: identityDocumentId(identity), committed: false, eligible: false, skippedReasons: ['active_mapping_missing_for_supplier'] });
      continue;
    }
    const scopeReasons = [...(validation.reasonsByIdentity.get(identityDocumentId(identity)) || [])];
    try { results.push(await promoteIdentity(strapi, identity.id, { ...options, supplier: identity.supplier || mappings.supplier, mappings, colourRows, scopeReasons })); }
    catch (error) { results.push({ identityDocumentId: identityDocumentId(identity), committed: false, eligible: false, skippedReasons: [error.message] }); }
  }
  const mappingMetadata = mappingScopeMetadata(mappingScope);
  const totalMappingRows = mappingMetadata.reduce((total, item) => total + Number(item.mappingRowCount || 0), 0);
  const result = {
    committed: options.commit === true,
    total: results.length,
    summary: {
      identitiesFound: identities?.length || 0,
      verifiedCandidates: verified.length,
      eligible: results.filter((item) => item.eligible).length,
      blocked: results.filter((item) => !item.eligible).length,
      skippedExistingColours: results.filter((item) => item.skippedReasons?.includes('colour_already_exists_for_fabric')).length,
      existingColoursToReuse: results.filter((item) => item.eligible && item.colourDecision === 'reuse_existing_colour').length,
      newColours: results.filter((item) => item.committed && item.colourDecision === 'create_new_colour').length,
      mediaToReuse: results.filter((item) => item.committed && item.assetDecision === 'reuse_staged_media').length,
    },
    validation: { duplicateFabricColourCodes: validation.duplicateFabricColourCodes, duplicateIdentityScopes: validation.duplicateIdentityScopes, internalCodeCollisions: validation.internalCodeCollisions },
    results,
    diagnostics: {
      diagnosticRequestId,
      selectedSupplier: promotionScopeLabel(supplier),
      mappingSupplier: mappingScope.allSuppliers ? 'All brands' : singleMappings.supplier || supplier,
      mappingVersion: singleMappings?.mappingVersion || null,
      mappingVersionDocumentId: singleMappings?.mappingDocumentId || null,
      mappingRowCount: mappingScope.allSuppliers ? totalMappingRows : singleMappings?.mappingRowCount || null,
      activeVersionsFound: mappingScope.allSuppliers ? mappingMetadata.length : singleMappings?.activeVersionsFound ?? null,
      mappingSuppliers: mappingMetadata,
      committed: options.commit === true,
    },
  };
  logColourDiagnostic(strapi, options.commit === true ? 'colour-promote-complete' : 'colour-promote-preview-complete', {
    diagnosticRequestId,
    supplier: promotionScopeLabel(supplier),
    committed: options.commit === true,
    total: result.total,
    eligible: result.summary.eligible,
    blocked: result.summary.blocked,
  });
  return result;
}

module.exports = { buildPlan, eligibility, existingColourScopeReasons, existingFabricColour, findMatchingColour, previewPromotion, promoteIdentity, promoteVerified, validateIdentitySet };
