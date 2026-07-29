'use strict';

const crypto = require('node:crypto');
const { loadProductionMappings, normalizeCanonicalColourName, normalizeToken } = require('../../shared/ashley-wilde-mapping');
const supplierMappings = require('./supplier-mapping');

const IDENTITY_UID = 'api::fabric-colour-identity.fabric-colour-identity';
const ASSET_UID = 'api::fabric-colour-asset.fabric-colour-asset';
const COLOUR_UID = 'api::colour.colour';
const SUPPLIER = 'Ashley Wilde';
const PROMOTABLE_ASSET_TYPES = new Set(['ordinary_colour', 'full_colour_name', 'numbered_alternate']);
const PLAN_TTL_MS = 10 * 60 * 1000;

function key(value) { return String(value || '').normalize('NFKC').trim().toUpperCase(); }
function relationKey(value) { return value?.documentId || value?.id || value; }
function entityRelationId(value) { return value?.id || value?.documentId || value; }
function first(value) { return Array.isArray(value) ? value[0] : value; }
function identityDocumentId(identity) { return identity.documentId || identity.id; }
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

async function findMatchingColour(strapi, identity) {
  if (identity.promotedColour) return { colour: identity.promotedColour, conflict: false, priority: 'promoted_relation' };
  const rows = await strapi.entityService.findMany(COLOUR_UID, { populate: ['fabrics', 'thumbnail'], limit: 1000 });
  for (const row of rows || []) {
    if (exactLegacyIdentity(row, identity).exact) return { colour: row, conflict: false, priority: 'exact_legacy_identity' };
  }
  // Colour records without the complete legacy identity are not evidence of a conflict.
  // Names, internal codes, suffixes, and filenames are deliberately not match keys.
  return { colour: null, conflict: false, priority: null };
}

async function loadIdentity(strapi, identityId) {
  const populate = { populate: ['fabric', 'assets', 'assets.media', 'assets.existingMedia', 'promotedColour'] };
  let identity = await strapi.entityService.findOne(IDENTITY_UID, identityId, populate);
  if (!identity) {
    const matches = await strapi.entityService.findMany(IDENTITY_UID, { filters: { documentId: { $eq: identityId } }, ...populate, limit: 1 });
    identity = matches?.[0] || null;
  }
  if (!identity) throw new Error('Fabric colour identity was not found');
  return identity;
}

async function loadPromotionMappings(strapi) {
  const active = await supplierMappings.getActiveImporterMappings(strapi, SUPPLIER);
  if (active) {
    const registry = await supplierMappings.loadRegistry(strapi, SUPPLIER);
    const codes = {};
    for (const [code, entry] of registry.byCode.entries()) codes[code] = { colourName: entry.canonicalColourName || entry.normalizedColourName || entry.colourName };
    return { codeRegistry: { codes }, mappingVersion: active.version.documentId || active.version.version, mappingSource: 'strapi-active-version' };
  }
  const fallback = loadProductionMappings({ mode: 'production' });
  return { ...fallback, mappingVersion: fallback.colourMap.generatedAt || null, mappingSource: 'repository-fallback' };
}

function eligibility(identity, mappings) {
  const reasons = [];
  if (identity.mappingStatus !== 'verified') reasons.push('mapping_status_not_verified');
  if (!['verified_manual', 'verified_official'].includes(identity.evidenceStatus)) reasons.push('evidence_not_acceptable');
  if (!identity.supplier) reasons.push('supplier_missing');
  if (key(identity.supplier) !== key(SUPPLIER)) reasons.push('supplier_mismatch');
  if (!identity.supplierProductCode) reasons.push('supplier_product_code_missing');
  if (!identity.supplierColourCode) reasons.push('supplier_colour_code_missing');
  if (!identity.fabricColourCode || normalizeToken(identity.fabricColourCode) !== normalizeToken(`${identity.supplierProductCode}${identity.supplierColourCode}`)) reasons.push('fabric_colour_code_invalid');
  if (!identity.officialColourName) reasons.push('official_colour_name_missing');
  const registryEntry = mappings.codeRegistry.codes[normalizeToken(identity.internalColourCode)];
  if (!identity.internalColourCode || !registryEntry || normalizeCanonicalColourName(registryEntry.colourName) !== normalizeCanonicalColourName(identity.officialColourName)) reasons.push('internal_code_invalid_or_semantic_collision');
  const fabric = first(identity.fabric);
  if (!fabric || !fabric.documentId || String(fabric.documentId) !== String(identity.fabricDocumentId)) reasons.push('fabric_relation_not_unique_or_scalar_disagrees');
  const assets = Array.isArray(identity.assets) ? identity.assets : [];
  if (assets.some((asset) => asset.duplicateStatus === 'conflicting_image' || asset.conflictGroup)) reasons.push('unresolved_asset_conflict');
  const approvedAssets = assets.filter((asset) => asset.importStatus === 'staged' && PROMOTABLE_ASSET_TYPES.has(asset.assetType) && (asset.media || asset.existingMedia));
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
    internalColourCode: identity.internalColourCode || null,
    promotedColour: relationKey(identity.promotedColour) || null,
    assets: (identity.assets || []).map((asset) => ({ documentId: asset.documentId || asset.id, updatedAt: asset.updatedAt || null, sha256: asset.sha256 || null, importStatus: asset.importStatus || null, duplicateStatus: asset.duplicateStatus || null, media: relationKey(asset.media) || relationKey(asset.existingMedia) || null })).sort((a, b) => String(a.documentId).localeCompare(String(b.documentId))),
  };
}

function stableFingerprint(value) { return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }

function scopeFilters(options = {}) {
  if (options.supplier && key(options.supplier) !== key(SUPPLIER)) throw new Error(`Promotion is restricted to supplier ${SUPPLIER}.`);
  const filters = { supplier: SUPPLIER };
  if (options.supplierProductCode) filters.supplierProductCode = { $eq: options.supplierProductCode };
  if (options.fabricName) filters.fabric = { name: { $eqi: options.fabricName } };
  if (Array.isArray(options.identityDocumentIds) && options.identityDocumentIds.length) filters.documentId = { $in: options.identityDocumentIds };
  return filters;
}

async function scopedIdentities(strapi, options = {}) {
  return strapi.entityService.findMany(IDENTITY_UID, {
    filters: scopeFilters(options),
    populate: ['fabric', 'assets', 'assets.media', 'assets.existingMedia', 'promotedColour'],
    sort: ['documentId:asc'],
    limit: options.limit || 1000,
  });
}

async function previewPromotion(strapi, options = {}) {
  const allIdentities = await scopedIdentities(strapi, options);
  const identities = (allIdentities || []).filter((identity) => identity.mappingStatus === 'verified');
  const mappings = options.mappings || await loadPromotionMappings(strapi);
  const validation = validateIdentitySet(identities);
  const results = [];
  for (const identity of identities) {
    const scopeReasons = [...(validation.reasonsByIdentity.get(identityDocumentId(identity)) || [])];
    try {
      const eligible = eligibility(identity, mappings);
      const matching = await findMatchingColour(strapi, identity);
      results.push(buildPlan(identity, matching, eligible, scopeReasons));
    } catch (error) {
      results.push({ identityDocumentId: identityDocumentId(identity), eligible: false, action: 'blocked', colourDecision: null, skippedReasons: [error.message] });
    }
  }
  const orderedResults = results.sort((a, b) => String(a.identityDocumentId).localeCompare(String(b.identityDocumentId)));
  const summary = {
    identitiesFound: allIdentities?.length || 0,
    verifiedCandidates: identities.length,
    eligible: orderedResults.filter((item) => item.eligible).length,
    blocked: orderedResults.filter((item) => !item.eligible).length,
    existingColoursToReuse: orderedResults.filter((item) => item.eligible && item.colourDecision === 'reuse_existing_colour').length,
    newColours: orderedResults.filter((item) => item.eligible && item.colourDecision === 'create_new_colour').length,
    mediaToReuse: orderedResults.filter((item) => item.eligible && item.assetDecision === 'reuse_staged_media').length,
    conflicts: orderedResults.filter((item) => item.skippedReasons?.includes('existing_colour_identity_conflict') || item.skippedReasons?.includes('unresolved_asset_conflict')).length,
    duplicateFabricColourCodes: validation.duplicateFabricColourCodes,
    duplicateIdentityScopes: validation.duplicateIdentityScopes,
    internalCodeCollisions: validation.internalCodeCollisions,
  };
  const expiresAt = new Date(Date.now() + PLAN_TTL_MS).toISOString();
  const snapshot = (allIdentities || []).map(identitySnapshot).sort((a, b) => String(a.identityDocumentId).localeCompare(String(b.identityDocumentId)));
  const scope = { supplier: SUPPLIER, supplierProductCode: options.supplierProductCode || null, fabricName: options.fabricName || null, identityDocumentIds: Array.isArray(options.identityDocumentIds) ? [...options.identityDocumentIds].sort() : null };
  const planFingerprint = stableFingerprint({ scope, mappingVersion: mappings.mappingVersion || null, snapshot, results: orderedResults });
  return { planFingerprint, planExpiresAt: expiresAt, scope, mappingVersion: mappings.mappingVersion || null, mappingSource: mappings.mappingSource || null, identityDocumentIds: identities.map(identityDocumentId), snapshot, summary, results: orderedResults, committed: false };
}

async function inTransaction(strapi, callback) {
  if (!strapi.db?.transaction) throw new Error('Promotion requires the Strapi database transaction service.');
  return strapi.db.transaction(({ trx }) => callback(trx));
}

async function promoteIdentity(strapi, identityId, options = {}) {
  const identity = await loadIdentity(strapi, identityId);
  const mappings = options.mappings || await loadPromotionMappings(strapi);
  const eligible = eligibility(identity, mappings);
  const matching = await findMatchingColour(strapi, identity);
  const plan = buildPlan(identity, matching, eligible, options.scopeReasons || []);
  if (options.commit !== true || !plan.eligible) return { ...plan, committed: false };
  const result = await inTransaction(strapi, async (trx) => {
    const latest = await loadIdentity(strapi, identity.id);
    const latestEligible = eligibility(latest, mappings);
    if (!latestEligible.eligible) throw new Error(`Promotion eligibility changed: ${latestEligible.reasons.join(', ')}`);
    const latestMatching = await findMatchingColour(strapi, latest);
    if (latestMatching.conflict) throw new Error('Existing Colour identity conflicts with the staged identity.');
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
    await strapi.entityService.update(IDENTITY_UID, latest.id, { data: { mappingStatus: 'promoted', promotedColour: { connect: [promotedRelationId] } }, transacting: trx });
    for (const assetItem of latestEligible.approvedAssets) await strapi.entityService.update(ASSET_UID, assetItem.id, { data: { importStatus: 'promoted' }, transacting: trx });
    return { colour, colourWasCreated, promotedId, latest };
  });
  const committedPlan = buildPlan(result.latest, { colour: result.colour, conflict: false, priority: matching.priority || 'created_colour' }, eligibility(result.latest, mappings), options.scopeReasons || []);
  return {
    ...committedPlan,
    action: result.colourWasCreated ? 'create_colour' : 'match_existing_colour',
    colourDecision: result.colourWasCreated ? 'create_new_colour' : 'reuse_existing_colour',
    committed: true,
    promotedColourDocumentId: result.promotedId,
  };
}

async function promoteVerified(strapi, options = {}) {
  const mappings = await loadPromotionMappings(strapi);
  if (options.commit === true && options.planFingerprint) {
    if (options.planExpiresAt && Date.parse(options.planExpiresAt) <= Date.now()) throw new Error('The promotion preview has expired. Run Preview promotion again.');
    const current = await previewPromotion(strapi, { ...options, identityDocumentIds: undefined, commit: false, mappings });
    if (current.planFingerprint !== options.planFingerprint) throw new Error('The promotion preview is stale because staging, mapping, scope, or eligibility changed. Run Preview promotion again.');
    const expected = [...(options.identityDocumentIds || [])].sort().join('|');
    if (expected !== current.identityDocumentIds.slice().sort().join('|')) throw new Error('The promotion scope no longer matches the approved preview. Run Preview promotion again.');
  }
  const identities = await scopedIdentities(strapi, options);
  const verified = (identities || []).filter((identity) => identity.mappingStatus === 'verified');
  const validation = validateIdentitySet(verified);
  const results = [];
  for (const identity of verified) {
    const scopeReasons = [...(validation.reasonsByIdentity.get(identityDocumentId(identity)) || [])];
    try { results.push(await promoteIdentity(strapi, identity.id, { ...options, mappings, scopeReasons })); }
    catch (error) { results.push({ identityDocumentId: identityDocumentId(identity), committed: false, eligible: false, skippedReasons: [error.message] }); }
  }
  return {
    committed: options.commit === true,
    total: results.length,
    summary: {
      identitiesFound: identities?.length || 0,
      verifiedCandidates: verified.length,
      eligible: results.filter((item) => item.eligible).length,
      blocked: results.filter((item) => !item.eligible).length,
      existingColoursToReuse: results.filter((item) => item.eligible && item.colourDecision === 'reuse_existing_colour').length,
      newColours: results.filter((item) => item.committed && item.colourDecision === 'create_new_colour').length,
      mediaToReuse: results.filter((item) => item.committed && item.assetDecision === 'reuse_staged_media').length,
    },
    validation: { duplicateFabricColourCodes: validation.duplicateFabricColourCodes, duplicateIdentityScopes: validation.duplicateIdentityScopes, internalCodeCollisions: validation.internalCodeCollisions },
    results,
  };
}

module.exports = { buildPlan, eligibility, findMatchingColour, previewPromotion, promoteIdentity, promoteVerified, validateIdentitySet };
