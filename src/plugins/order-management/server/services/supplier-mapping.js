'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  AshleyWildeMappingError, KIELDER_NATURAL_FABRIC_NAME, KIELDER_OTHER_COLOURS_FABRIC_NAME, KIELDER_SUPPLIER_PRODUCT_CODE,
  SUPPLIER, loadProductionMappings, normalizeCanonicalColourName, normalizeToken, validateColourMap,
} = require('../../shared/ashley-wilde-mapping');

const IMPORT_UID = 'api::supplier-mapping-import.supplier-mapping-import';
const MAPPING_UID = 'api::supplier-fabric-colour-mapping.supplier-fabric-colour-mapping';
const REGISTRY_UID = 'api::canonical-colour-registry.canonical-colour-registry';
const COLOR_CODE_UID = 'api::color-code.color-code';
const FABRIC_UID = 'api::fabric.fabric';
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const EVIDENCE_STATUSES = new Set(['pending_manual', 'verified_manual', 'verified_official', 'unresolved']);
const APPROVED_CATALOGUE_ALIASES = Object.freeze([
  // Read-only catalogue evidence: input "Colette" maps to the unique
  // Ashley Wilde product-id family COLLETTE (FAB-COLLETTE-8936).
  { supplier: 'Ashley Wilde', alias: 'Colette', catalogueProductCode: 'COLLETTE' },
]);

function clean(value) { return String(value || '').normalize('NFKC').trim(); }
function supplierMappingLog(event, details = {}) {
  try { console.info(`[supplier-mapping] ${event}`, details); } catch { /* diagnostics must never affect validation */ }
}
function requireDocumentId(value, field = 'documentId') {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty Strapi documentId.`);
  return value.trim();
}
function requireNumericId(value, field = 'rowId') {
  if (!Number.isInteger(value)) throw new Error(`${field} must be an integer SQL row ID.`);
  return value;
}
function nameKey(value) { return clean(value).replace(/\s+/g, ' ').toLocaleLowerCase(); }
function normalizedNameKey(value) { return clean(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }
function compactNameKey(value) { return normalizedNameKey(value); }
function codeKey(value) { return normalizeToken(value); }
function relationId(value) { return value?.documentId || value?.id || value; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function scopeKey(row) { return [clean(row.supplier), String(row.fabricDocumentId || ''), codeKey(row.supplierProductCode), codeKey(row.supplierColourCode)].join('|'); }
function canonicalMappingKey(row) {
  return [
    clean(row.supplier),
    String(row.fabricDocumentId || ''),
    codeKey(row.supplierProductCode),
    codeKey(row.supplierColourCode),
    codeKey(row.fabricColourCode),
    normalizeCanonicalColourName(row.officialColourName),
    codeKey(row.internalColourCode),
  ].join('|');
}
function hashJson(value) { return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }

function normalizeActiveSupplier(value, file = 'active Ashley Wilde mapping') {
  const normalized = clean(value).replace(/\s+/g, ' ');
  if (normalized.toLocaleLowerCase() !== SUPPLIER.toLocaleLowerCase()) {
    throw new AshleyWildeMappingError(`supplier must be "${SUPPLIER}"`, file);
  }
  return SUPPLIER;
}

function assertJsonSize(value) {
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > MAX_JSON_BYTES) throw new Error(`Mapping JSON exceeds the ${MAX_JSON_BYTES} byte limit.`);
}

function legacyToGeneric(input) {
  if (!input?.products || Array.isArray(input.fabrics)) return input;
  const fabrics = Object.values(input.products).map((product) => ({
    fabricName: product.fabricName || product.productName,
    fabricDocumentId: product.fabricDocumentId,
    supplierProductCode: product.supplierProductCode,
    colours: Object.values(product.colours || {}).map((colour) => ({
      supplierColourCode: colour.supplierColourCode,
      fabricColourCode: colour.fabricColourCode,
      officialColourName: colour.resolved === false ? null : (colour.officialColourName || colour.supplierColourName),
      internalColourCode: colour.resolved === false ? null : colour.internalColourCode,
      submittedInternalColourCode: colour.submittedInternalColourCode,
      reconciliationReason: colour.reconciliationReason,
      reconciliationEvidence: colour.reconciliationEvidence,
      evidenceStatus: colour.evidenceStatus || (colour.resolved === false ? 'pending_manual' : 'verified_official'),
      source: colour.source || colour.evidence?.source,
      notes: colour.reason || null,
    })),
  }));
  return {
    schemaVersion: 1,
    supplier: input.supplier || 'Ashley Wilde',
    mappingVersion: input.mappingVersion || input.version || input.generatedAt || new Date().toISOString().slice(0, 10),
    source: input.source || 'Repository-approved mapping export',
    fabrics,
  };
}

function normalizeDocument(input) {
  const document = legacyToGeneric(input);
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('Mapping JSON root must be an object.');
  const fabrics = Array.isArray(document.fabrics) ? document.fabrics : [];
  return {
    schemaVersion: Number(document.schemaVersion),
    supplier: clean(document.supplier),
    mappingVersion: clean(document.mappingVersion || document.version),
    source: clean(document.source),
    notes: clean(document.notes),
    fabrics: fabrics.map((fabric) => ({
      fabricName: clean(fabric?.fabricName || fabric?.name),
      fabricDocumentId: clean(fabric?.fabricDocumentId),
      supplierProductCode: clean(fabric?.supplierProductCode || fabric?.productCode),
      colours: (Array.isArray(fabric?.colours) ? fabric.colours : []).map((colour) => ({
        supplierColourCode: clean(colour?.supplierColourCode || colour?.code),
        fabricColourCode: clean(colour?.fabricColourCode),
        officialColourName: clean(colour?.officialColourName || colour?.supplierColourName),
        internalColourCode: clean(colour?.internalColourCode),
        submittedInternalColourCode: clean(colour?.submittedInternalColourCode),
        reconciliationReason: clean(colour?.reconciliationReason),
        reconciliationEvidence: colour?.reconciliationEvidence || null,
        evidenceStatus: clean(colour?.evidenceStatus || (colour?.officialColourName ? 'verified_manual' : 'pending_manual')),
        source: clean(colour?.source),
        notes: clean(colour?.notes),
      })),
    })),
  };
}

function logicalRows(rows) {
  const byDocument = new Map();
  for (const row of rows || []) {
    const key = row.documentId || row.id;
    if (!key) continue;
    const current = byDocument.get(key);
    if (!current || (current.publishedAt && !row.publishedAt)) byDocument.set(key, row);
  }
  return [...byDocument.values()];
}

function relationItems(value) {
  const unwrapped = value?.data ?? value;
  if (Array.isArray(unwrapped)) return unwrapped;
  return unwrapped ? [unwrapped] : [];
}

function belongsToSupplier(fabric, supplier) {
  return relationItems(fabric?.brand).some((brand) => normalizedNameKey(brand?.name || brand?.attributes?.name) === normalizedNameKey(supplier));
}

function productIdDerivedCodes(fabric) {
  const productId = clean(fabric?.productId);
  if (!productId) return [];
  const withoutPrefix = productId.replace(/^FAB[-_]/i, '');
  return unique([productId, withoutPrefix, withoutPrefix.replace(/[-_]\d+$/i, '')].map(codeKey));
}

function approvedFabricAliases(supplier) {
  if (nameKey(supplier) !== nameKey('Ashley Wilde')) return new Map();
  const aliases = new Map();
  try {
    const products = loadProductionMappings({ mode: 'production' }).colourMap.products || {};
    for (const product of Object.values(products)) {
      const productCode = codeKey(product.supplierProductCode);
      for (const alias of [product.fabricName, ...(product.approvedAliases || [])]) {
        const key = compactNameKey(alias);
        if (!key || !productCode) continue;
        const owners = aliases.get(key) || new Set();
        owners.add(productCode);
        aliases.set(key, owners);
      }
    }
  } catch { /* The live catalogue remains authoritative if the optional repository map is unavailable. */ }
  for (const entry of APPROVED_CATALOGUE_ALIASES) {
    if (nameKey(entry.supplier) !== nameKey(supplier)) continue;
    const key = compactNameKey(entry.alias);
    const owners = aliases.get(key) || new Set();
    owners.add(codeKey(entry.catalogueProductCode));
    aliases.set(key, owners);
  }
  return aliases;
}

async function fabricCatalogue(strapi, supplier) {
  const schema = typeof strapi.contentType === 'function' ? strapi.contentType(FABRIC_UID) : null;
  const supportsSupplierProductCode = Boolean(schema?.attributes?.supplierProductCode);
  const query = {
    filters: {},
    populate: { brand: true },
  };

  let rows = null;
  if (typeof strapi.documents === 'function') {
    try {
      const documents = strapi.documents(FABRIC_UID);
      supplierMappingLog('fabric-catalogue.documents-start', {
        supplier,
        status: ['draft', 'published'],
        pageSize: 100,
        supportsSupplierProductCode,
      });
      const findAll = async (status) => {
        const pageSize = 100;
        let total = null;
        if (typeof documents.count === 'function') {
          total = await documents.count({ filters: query.filters, status }).catch((error) => {
            supplierMappingLog('fabric-catalogue.count-failed', { supplier, status, message: error.message });
            return null;
          });
        }
        const found = [];
        for (let start = 0; start <= 10000; ) {
          // Document Service pagination uses limit/start. The page/pageSize
          // shape belongs to the REST API and is rejected by strictParams.
          const pageRows = await documents.findMany({ ...query, status, limit: pageSize, start });
          supplierMappingLog('fabric-catalogue.page', {
            supplier,
            status,
            start,
            limit: pageSize,
            returned: Array.isArray(pageRows) ? pageRows.length : null,
            total,
          });
          if (!Array.isArray(pageRows) || !pageRows.length) break;
          found.push(...pageRows);
          if ((total !== null && found.length >= total) || (total === null && pageRows.length < pageSize)) break;
          start += pageRows.length;
        }
        return found;
      };
      const [draftRows, publishedRows] = await Promise.all([findAll('draft'), findAll('published')]);
      rows = logicalRows([...(draftRows || []), ...(publishedRows || [])]);
    } catch (error) {
      // Keep a compatibility fallback for older Strapi runtimes and focused test harnesses.
      supplierMappingLog('fabric-catalogue.documents-failed', { supplier, message: error.message });
      rows = null;
    }
  }

  if (!rows) {
    rows = await strapi.entityService.findMany(FABRIC_UID, {
      filters: {},
      populate: ['brand'],
      publicationState: 'preview',
      limit: 10000,
    });
    rows = logicalRows(rows);
    supplierMappingLog('fabric-catalogue.entity-service-fallback', { supplier, returned: rows.length });
  }

  const supplierRows = rows.filter((fabric) => belongsToSupplier(fabric, supplier));
  supplierMappingLog('fabric-catalogue.loaded', {
    supplier,
    totalRows: rows.length,
    supplierRows: supplierRows.length,
    supportsSupplierProductCode,
    sampleRows: rows.slice(0, 8).map((fabric) => ({
      documentId: fabric.documentId || null,
      name: fabric.name || null,
      brand: relationItems(fabric.brand).map((brand) => brand?.name || brand?.attributes?.name || null),
    })),
  });

  return {
    fabrics: supplierRows,
    supportsSupplierProductCode,
  };
}

function exactOne(candidates, method) {
  if (candidates.length === 1) return { status: 'resolved', fabric: candidates[0], method };
  if (candidates.length > 1) return { status: 'ambiguous', candidates, method };
  return null;
}

function resolveFabricFromCatalogue(catalogue, row, aliases = new Map(), options = {}) {
  const supplierCatalogue = catalogue.filter((fabric) => belongsToSupplier(fabric, row.supplier));
  const supplierCode = codeKey(row.supplierProductCode);
  supplierMappingLog('fabric-resolve.start', {
    supplier: row.supplier,
    fabricName: row.fabricName,
    catalogueRows: catalogue.length,
    supplierRows: supplierCatalogue.length,
    supplierProductCodePresent: Boolean(supplierCode),
    supportsSupplierProductCode: Boolean(options.supportsSupplierProductCode),
  });

  // Generic suppliers are resolved by their exact Brand and exact normalized
  // Fabric name. A Fabric-level supplierProductCode is not part of the schema,
  // so supplier codes can never be a prerequisite for this branch.
  if (nameKey(row.supplier) !== nameKey(SUPPLIER)) {
    const exactNameCandidates = supplierCatalogue.filter((fabric) => normalizedNameKey(fabric.name) === normalizedNameKey(row.fabricName));
    supplierMappingLog('fabric-resolve.generic-candidates', {
      supplier: row.supplier,
      fabricName: row.fabricName,
      exactNameCandidates: exactNameCandidates.length,
      candidates: exactNameCandidates.map((fabric) => ({ documentId: fabric.documentId || null, name: fabric.name || null })),
    });
    const byBrandAndName = exactOne(
      exactNameCandidates,
      'supplier_brand_and_normalized_fabric_name',
    );
    if (!byBrandAndName) {
      supplierMappingLog('fabric-resolve.result', { supplier: row.supplier, fabricName: row.fabricName, status: 'missing', method: null });
      return { status: 'missing', candidates: [] };
    }
    if (options.supportsSupplierProductCode && supplierCode && byBrandAndName.fabric) {
      supplierMappingLog('fabric-resolve.result', {
        supplier: row.supplier,
        fabricName: row.fabricName,
        status: byBrandAndName.status,
        method: byBrandAndName.method,
        documentId: byBrandAndName.fabric.documentId || null,
        supplierProductCodeEvidence: codeKey(byBrandAndName.fabric.supplierProductCode) === supplierCode
          || productIdDerivedCodes(byBrandAndName.fabric).includes(supplierCode),
      });
      return {
        ...byBrandAndName,
        supplierProductCodeEvidence: {
          provided: row.supplierProductCode,
          matched: codeKey(byBrandAndName.fabric.supplierProductCode) === supplierCode
            || productIdDerivedCodes(byBrandAndName.fabric).includes(supplierCode),
        },
      };
    }
    supplierMappingLog('fabric-resolve.result', {
      supplier: row.supplier,
      fabricName: row.fabricName,
      status: byBrandAndName.status,
      method: byBrandAndName.method,
      documentId: byBrandAndName.fabric?.documentId || null,
    });
    return byBrandAndName;
  }

  if (supplierCode === KIELDER_SUPPLIER_PRODUCT_CODE
    && [KIELDER_NATURAL_FABRIC_NAME, KIELDER_OTHER_COLOURS_FABRIC_NAME].some((name) => nameKey(row.fabricName) === nameKey(name))) {
    const byKielderFabricName = exactOne(
      supplierCatalogue.filter((fabric) => nameKey(fabric.name) === nameKey(row.fabricName)),
      'kielder_exact_fabric_name',
    );
    if (byKielderFabricName) return byKielderFabricName;
  }

  const byDocumentId = exactOne(
    row.fabricDocumentId ? supplierCatalogue.filter((fabric) => String(fabric.documentId) === String(row.fabricDocumentId)) : [],
    'existing_fabric_document_id',
  );
  if (byDocumentId) return byDocumentId;

  const bySchemaSupplierCode = exactOne(
    supplierCode ? supplierCatalogue.filter((fabric) => codeKey(fabric.supplierProductCode) === supplierCode) : [],
    'fabric_supplier_product_code',
  );
  if (bySchemaSupplierCode) return bySchemaSupplierCode;

  const byProductId = exactOne(
    supplierCode ? supplierCatalogue.filter((fabric) => productIdDerivedCodes(fabric).includes(supplierCode)) : [],
    'fabric_product_id_derived_supplier_code',
  );
  if (byProductId) return byProductId;

  const byName = exactOne(supplierCatalogue.filter((fabric) => nameKey(fabric.name) === nameKey(row.fabricName)), 'normalized_fabric_name');
  if (byName) return byName;

  const byCompactName = exactOne(supplierCatalogue.filter((fabric) => compactNameKey(fabric.name) === compactNameKey(row.fabricName)), 'compact_fabric_name');
  if (byCompactName) return byCompactName;

  const aliasOwners = aliases.get(compactNameKey(row.fabricName));
  const byAlias = exactOne(
    aliasOwners?.size ? supplierCatalogue.filter((fabric) => productIdDerivedCodes(fabric).some((code) => aliasOwners.has(code)) || aliasOwners.has(codeKey(fabric.supplierProductCode))) : [],
    'approved_fabric_alias',
  );
  if (byAlias) return { ...byAlias, alias: row.fabricName };

  return { status: 'missing', candidates: [] };
}

async function loadRegistry(strapi, supplier) {
  const registryRows = await strapi.entityService.findMany(REGISTRY_UID, { filters: { status: 'approved' }, limit: 10000 });
  const colourCodeRows = await strapi.entityService.findMany(COLOR_CODE_UID, { filters: {}, publicationState: 'preview', limit: 10000 });
  const byCode = new Map();
  const byName = new Map();
  const conflicts = [];
  const add = (entry) => {
    const code = codeKey(entry.internalColourCode);
    const name = normalizeCanonicalColourName(entry.canonicalColourName);
    if (!code || !name) return;
    const codeOwner = byCode.get(code);
    const nameOwner = byName.get(name);
    const codeOwnerName = normalizeCanonicalColourName(codeOwner?.canonicalColourName);
    const nameOwnerCode = codeKey(nameOwner?.internalColourCode);
    if ((codeOwner && codeOwnerName !== name) || (nameOwner && nameOwnerCode !== code)) {
      conflicts.push({ rejected: entry, codeOwner: codeOwner || null, nameOwner: nameOwner || null });
      return;
    }
    if (!codeOwner) byCode.set(code, entry);
    if (!nameOwner) byName.set(name, entry);
  };

  // The checked-in Ashley Wilde registry is the stable global namespace.
  // Database rows may add colours, but cannot redefine an existing name or code.
  if (nameKey(supplier) === nameKey('Ashley Wilde')) {
    try {
      const fallback = loadProductionMappings({ mode: 'production' }).codeRegistry.codes || {};
      for (const [code, entry] of Object.entries(fallback)) add({ internalColourCode: code, canonicalColourName: entry.colourName, source: 'approved repository registry', locked: true });
    } catch { /* repository fallback is optional for non-Ashley or incomplete installs */ }
  }
  const orderedRegistryRows = [...(registryRows || [])].sort((left, right) => [
    normalizeCanonicalColourName(left.normalizedColourName || left.canonicalColourName),
    codeKey(left.normalizedInternalCode || left.internalColourCode),
    String(left.documentId || left.id || ''),
  ].join('|').localeCompare([
    normalizeCanonicalColourName(right.normalizedColourName || right.canonicalColourName),
    codeKey(right.normalizedInternalCode || right.internalColourCode),
    String(right.documentId || right.id || ''),
  ].join('|')));
  for (const row of orderedRegistryRows) add({ internalColourCode: row.normalizedInternalCode || row.internalColourCode, canonicalColourName: row.normalizedColourName || row.canonicalColourName, displayColourName: row.canonicalColourName, source: row.source || 'approved Strapi canonical colour registry', locked: true, registry: row });
  const orderedColourCodeRows = [...(colourCodeRows || [])].sort((left, right) => `${codeKey(left.code)}|${normalizeCanonicalColourName(left.name)}`.localeCompare(`${codeKey(right.code)}|${normalizeCanonicalColourName(right.name)}`));
  for (const row of orderedColourCodeRows) add({ internalColourCode: row.code, canonicalColourName: row.name, source: 'Strapi ColorCode collection', locked: false });
  return { byCode, byName, registryRows: registryRows || [], conflicts };
}

function addIssue(issues, type, message, rowIndex = null, details = null) {
  issues.push({ type, message, rowIndex, ...(details ? { details } : {}) });
}

function pushCandidate(candidates, value) {
  const code = codeKey(value);
  if (code && !candidates.includes(code)) candidates.push(code);
}

function internalCodeCandidates(colourName, supplierColourCode) {
  const compact = codeKey(colourName);
  const words = clean(colourName).split(/\s+/).filter(Boolean);
  const candidates = [];
  pushCandidate(candidates, supplierColourCode);
  if (words.length > 1) {
    pushCandidate(candidates, words.map((word) => word[0]).join(''));
    pushCandidate(candidates, `${words[0]}${words.slice(1).map((word) => word[0]).join('')}`);
  }
  pushCandidate(candidates, compact.slice(0, 2));
  if (compact) {
    const first = compact[0];
    for (const character of compact.slice(1)) pushCandidate(candidates, `${first}${character}`);
  }
  pushCandidate(candidates, compact.slice(0, 3));
  pushCandidate(candidates, compact.slice(0, 4));
  for (let length = 5; length <= compact.length; length += 1) pushCandidate(candidates, compact.slice(0, length));
  return candidates;
}

function allocateInternalCode(colourName, supplierColourCode, usedCodes, codeToName) {
  const canonicalName = normalizeCanonicalColourName(colourName);
  const candidates = internalCodeCandidates(colourName, supplierColourCode);
  for (const candidate of candidates) {
    const owner = codeToName.get(candidate);
    if (!owner || owner === canonicalName) return candidate;
  }
  const base = candidates[0] || codeKey(colourName).slice(0, 2) || 'C';
  for (let suffix = 2; suffix < 100000; suffix += 1) {
    const candidate = `${base}${suffix}`;
    const owner = codeToName.get(candidate);
    if (!owner || owner === canonicalName) return candidate;
  }
  throw new Error(`Unable to allocate a deterministic internal colour code for ${colourName}`);
}

function reconcileInternalCodes(rows, registry) {
  const byName = new Map(registry.byName);
  const byCode = new Map(registry.byCode);
  const groups = new Map();
  for (const row of rows) {
    const name = normalizeCanonicalColourName(row.officialColourName);
    if (!name) continue;
    const group = groups.get(name) || [];
    group.push(row);
    groups.set(name, group);
  }
  const orderedGroups = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  const reconciliations = [];
  for (const [canonicalName, group] of orderedGroups) {
    const representative = group.slice().sort((left, right) => `${codeKey(left.supplierProductCode)}|${codeKey(left.supplierColourCode)}|${left.rowIndex}`.localeCompare(`${codeKey(right.supplierProductCode)}|${codeKey(right.supplierColourCode)}|${right.rowIndex}`))[0];
    const existing = byName.get(canonicalName);
    const submittedCode = codeKey(representative.incomingInternalColourCode);
    const existingCode = codeKey(existing?.internalColourCode);
    const existingCodeOwner = existingCode ? byCode.get(existingCode) : null;
    const existingIsSafe = Boolean(existingCode) && (!existingCodeOwner || normalizeCanonicalColourName(existingCodeOwner.canonicalColourName) === canonicalName);
    const safeExisting = existingIsSafe ? existing : null;
    let resolvedCode = safeExisting ? existingCode : null;
    let allocationReason = safeExisting ? 'approved_registry_code_reused' : null;
    if (!resolvedCode && submittedCode) {
      const submittedOwner = byCode.get(submittedCode);
      if (!submittedOwner || normalizeCanonicalColourName(submittedOwner.canonicalColourName) === canonicalName) {
        resolvedCode = submittedCode;
        allocationReason = existing ? 'approved_registry_collision_repaired' : 'submitted_code_reused';
      }
    }
    if (!resolvedCode) {
      const supplierCode = codeKey(representative.supplierColourCode);
      const supplierOwner = supplierCode ? byCode.get(supplierCode) : null;
      if (!supplierOwner || normalizeCanonicalColourName(supplierOwner.canonicalColourName) === canonicalName) {
        resolvedCode = supplierCode;
        allocationReason = existing ? 'approved_registry_collision_repaired' : (supplierCode ? 'supplier_code_reused' : null);
      }
    }
    if (!resolvedCode) {
      resolvedCode = allocateInternalCode(representative.officialColourName, representative.supplierColourCode, new Set(byCode.keys()), new Map([...byCode.entries()].map(([code, entry]) => [code, normalizeCanonicalColourName(entry.canonicalColourName)])));
      allocationReason = existing ? 'approved_registry_collision_repaired' : 'deterministic_internal_code_allocated';
    }
    const resolvedEntry = { internalColourCode: resolvedCode, canonicalColourName: representative.officialColourName, source: safeExisting?.source || 'mapping preview allocation', locked: Boolean(safeExisting?.locked) };
    byName.set(canonicalName, resolvedEntry);
    byCode.set(resolvedCode, resolvedEntry);
    for (const row of group) {
      row.internalColourCode = resolvedCode;
      const incoming = codeKey(row.incomingInternalColourCode);
      const submittedOwner = incoming ? byCode.get(incoming) : null;
      const submittedName = submittedOwner ? normalizeCanonicalColourName(submittedOwner.canonicalColourName) : null;
      let reason = null;
      if (existing && !existingIsSafe) {
        reason = 'approved_registry_collision_repaired';
      } else if (incoming !== resolvedCode) {
        if (submittedOwner && submittedName !== canonicalName) reason = 'submitted_code_belongs_to_different_canonical_colour';
        else if (safeExisting) reason = 'approved_registry_code_reused';
        else if (allocationReason === 'deterministic_internal_code_allocated') reason = 'deterministic_internal_code_allocated';
        else reason = 'internal_code_reconciled';
      } else if (!incoming && allocationReason === 'deterministic_internal_code_allocated') {
        reason = 'deterministic_internal_code_allocated';
      }
      row.reconciliationReason = reason;
      row.reconciliationEvidence = {
        submittedInternalColourCode: row.incomingInternalColourCode || null,
        resolvedInternalColourCode: resolvedCode,
        canonicalColourName: row.officialColourName,
        submittedCodeOwner: submittedOwner ? { internalColourCode: submittedOwner.internalColourCode, canonicalColourName: submittedOwner.canonicalColourName, source: submittedOwner.source } : null,
        resolvedFrom: safeExisting ? safeExisting.source : allocationReason,
        rejectedRegistryAssignment: existing && !existingIsSafe ? { internalColourCode: existing.internalColourCode, canonicalColourName: existing.canonicalColourName, source: existing.source } : null,
        submittedEvidence: row.submittedReconciliationEvidence || null,
      };
      row.reusedExistingGlobalColour = Boolean(safeExisting);
      if (reason) reconciliations.push({
        rowIndex: row.rowIndex,
        supplierProductCode: row.supplierProductCode,
        supplierColourCode: row.supplierColourCode,
        officialColourName: row.officialColourName,
        submittedInternalColourCode: row.incomingInternalColourCode || null,
        resolvedInternalColourCode: resolvedCode,
        reason,
        evidence: row.reconciliationEvidence,
      });
    }
  }
  return reconciliations;
}

function stableJson(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function mergedEvidence(rows) {
  const entries = rows.map((row) => row.reconciliationEvidence).filter(Boolean)
    .map((entry) => ({ value: entry, sortKey: stableJson(entry) }))
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  const uniqueEntries = entries.filter((entry, index) => index === 0 || entry.sortKey !== entries[index - 1].sortKey).map((entry) => entry.value);
  if (!uniqueEntries.length) return null;
  return uniqueEntries.length === 1 ? uniqueEntries[0] : { merged: true, entries: uniqueEntries };
}

function mergedText(rows, property) {
  const values = unique(rows.map((row) => clean(row[property])).filter(Boolean)).sort((left, right) => left.localeCompare(right));
  return values.length ? values.join(' | ') : null;
}

function collapseExactDuplicates(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = scopeKey(row);
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  const retained = [];
  const exactDuplicateGroups = [];
  const contradictoryGroups = [];
  for (const [value, grouped] of groups.entries()) {
    const variants = new Map();
    for (const row of grouped) {
      const variant = canonicalMappingKey(row);
      const rowsForVariant = variants.get(variant) || [];
      rowsForVariant.push(row);
      variants.set(variant, rowsForVariant);
    }
    if (grouped.length > 1 && variants.size === 1) {
      const ordered = grouped.slice().sort((left, right) => left.rowIndex - right.rowIndex);
      const representative = { ...ordered[0] };
      representative.source = mergedText(ordered, 'source');
      representative.notes = mergedText(ordered, 'notes');
      representative.reconciliationEvidence = mergedEvidence(ordered);
      representative.reusedExistingGlobalColour = ordered.some((row) => row.reusedExistingGlobalColour);
      representative.collapsedDuplicateRowIndexes = ordered.slice(1).map((row) => row.rowIndex);
      retained.push(representative);
      exactDuplicateGroups.push({ value, rowIndexes: ordered.map((row) => row.rowIndex), keptRowIndex: representative.rowIndex, collapsedRows: ordered.length - 1 });
    } else {
      retained.push(...grouped);
      if (grouped.length > 1 && variants.size > 1) contradictoryGroups.push({ value, rows: grouped, variants: [...variants.keys()] });
    }
  }
  retained.sort((left, right) => left.rowIndex - right.rowIndex);
  return { rows: retained, exactDuplicateGroups, contradictoryGroups };
}

async function validateDocument(strapi, input) {
  const document = normalizeDocument(input);
  const issues = [];
  if (document.schemaVersion !== 1) addIssue(issues, 'schema_version', 'schemaVersion must be 1');
  if (!document.supplier) addIssue(issues, 'supplier_missing', 'supplier is required');
  if (!document.mappingVersion) addIssue(issues, 'mapping_version_missing', 'mappingVersion is required');
  if (!document.fabrics.length) addIssue(issues, 'fabrics_missing', 'fabrics must contain at least one Fabric');
  const registry = await loadRegistry(strapi, document.supplier);
  const catalogueResult = await fabricCatalogue(strapi, document.supplier);
  const catalogue = catalogueResult.fabrics;
  const aliases = approvedFabricAliases(document.supplier);
  const rows = [];
  const resolvedFabrics = new Map();

  for (let fabricIndex = 0; fabricIndex < document.fabrics.length; fabricIndex += 1) {
    const fabricInput = document.fabrics[fabricIndex];
    if (!fabricInput.fabricName) addIssue(issues, 'fabric_name_missing', `Fabric ${fabricIndex + 1} has no fabricName`, fabricIndex);
    if (!fabricInput.supplierProductCode) addIssue(issues, 'product_code_missing', `Fabric ${fabricInput.fabricName || fabricIndex + 1} has no supplierProductCode`, fabricIndex);
    const resolution = fabricInput.fabricName && fabricInput.supplierProductCode
      ? resolveFabricFromCatalogue(catalogue, { ...fabricInput, supplier: document.supplier }, aliases, catalogueResult)
      : { status: 'missing', candidates: [] };
    const fabric = resolution.fabric;
    const fabricResolution = {
      status: resolution.status,
      method: resolution.method || null,
      alias: resolution.alias || null,
      inputFabricName: fabricInput.fabricName,
      inputSupplierProductCode: fabricInput.supplierProductCode,
      fabricDocumentId: fabric?.documentId || null,
      fabricName: fabric?.name || fabricInput.fabricName,
      supplierProductCode: fabric?.supplierProductCode || fabricInput.supplierProductCode,
      supplierProductCodeEvidence: resolution.supplierProductCodeEvidence || null,
      catalogueEvidence: fabric ? { name: fabric.name || null, productId: fabric.productId || null, collection: fabric.collection || null, documentId: fabric.documentId || null } : null,
      candidates: (resolution.candidates || []).map((item) => ({ documentId: item.documentId || null, name: item.name || null, productId: item.productId || null })),
    };
    resolvedFabrics.set(fabricIndex, fabricResolution);
    if (resolution.status === 'missing') addIssue(issues, 'fabric_missing', `No ${document.supplier} Fabric could be resolved for ${fabricInput.fabricName} (${fabricInput.supplierProductCode})`, fabricIndex);
    if (resolution.status === 'ambiguous') addIssue(issues, 'fabric_ambiguous', `Fabric ${fabricInput.fabricName} (${fabricInput.supplierProductCode}) resolves to multiple catalogue records`, fabricIndex);
    for (let colourIndex = 0; colourIndex < fabricInput.colours.length; colourIndex += 1) {
      const colour = fabricInput.colours[colourIndex];
      const rowIndex = rows.length;
      const expectedFabricColourCode = `${fabricInput.supplierProductCode}${colour.supplierColourCode}`;
      const normalized = {
        rowIndex,
        fabricIndex,
        colourIndex,
        fabricName: fabric?.name || fabricInput.fabricName,
        fabricDocumentId: fabric?.documentId || null,
        supplier: document.supplier,
        supplierProductCode: fabricInput.supplierProductCode,
        supplierColourCode: colour.supplierColourCode,
        fabricColourCode: colour.fabricColourCode || expectedFabricColourCode,
        officialColourName: colour.officialColourName || null,
        internalColourCode: colour.internalColourCode || null,
        incomingInternalColourCode: colour.submittedInternalColourCode || colour.internalColourCode || null,
        submittedReconciliationEvidence: colour.reconciliationEvidence || null,
        evidenceStatus: colour.evidenceStatus || 'pending_manual',
        source: colour.source || document.source || null,
        notes: colour.notes || null,
        fabricResolution,
      };
      rows.push(normalized);
    }
  }

  const codeReconciliations = reconcileInternalCodes(rows, registry);
  const collapsed = collapseExactDuplicates(rows);
  const effectiveRows = collapsed.rows;
  const identityGroups = new Map();
  const codeGroups = new Map();
  for (const row of effectiveRows) {
    if (!EVIDENCE_STATUSES.has(row.evidenceStatus)) addIssue(issues, 'unknown_evidence_status', `Unknown evidenceStatus ${row.evidenceStatus}`, row.rowIndex);
    if (!row.supplierColourCode) addIssue(issues, 'supplier_colour_code_missing', 'supplierColourCode is required', row.rowIndex);
    if (!row.officialColourName) addIssue(issues, 'official_colour_name_missing', 'officialColourName is required for an activated mapping', row.rowIndex);
    if (!row.internalColourCode) addIssue(issues, 'internal_code_missing', 'internalColourCode is required for an activated mapping', row.rowIndex);
    const expected = `${row.supplierProductCode}${row.supplierColourCode}`;
    if (!row.supplierColourCode || codeKey(row.fabricColourCode) !== codeKey(expected)) addIssue(issues, 'fabric_colour_code_invalid', 'fabricColourCode does not equal supplierProductCode + supplierColourCode', row.rowIndex);
    const identity = scopeKey(row);
    const identityRows = identityGroups.get(identity) || [];
    identityRows.push(row);
    identityGroups.set(identity, identityRows);
    const fabricCode = `${row.supplier}|${String(row.fabricDocumentId || '')}|${codeKey(row.fabricColourCode)}`;
    const codeRows = codeGroups.get(fabricCode) || [];
    codeRows.push(row);
    codeGroups.set(fabricCode, codeRows);
  }

  const duplicateRows = [...identityGroups.entries()].filter(([, grouped]) => grouped.length > 1);
  const contradictoryRows = duplicateRows.filter(([, grouped]) => new Set(grouped.map(canonicalMappingKey)).size > 1);
  const duplicateFabricColourCodes = [...codeGroups.entries()].filter(([, grouped]) => grouped.length > 1);
  contradictoryRows.forEach(([value, grouped]) => {
    const details = grouped.map((row) => ({
      rowIndex: row.rowIndex,
      supplierProductCode: row.supplierProductCode,
      supplierColourCode: row.supplierColourCode,
      officialColourName: row.officialColourName,
      resolvedInternalColourCode: row.internalColourCode,
      source: row.source,
      evidence: row.reconciliationEvidence,
    }));
    addIssue(issues, 'mapping_identity_conflict', `Mapping identity ${value} has contradictory canonical mappings: ${unique(grouped.map((row) => `${row.officialColourName || '(missing)'} (${row.internalColourCode || '(missing)'})`)).join(', ')}`, grouped[0].rowIndex, details);
  });
  duplicateRows.filter(([value]) => !contradictoryRows.some(([conflictValue]) => conflictValue === value)).forEach(([value, grouped]) => addIssue(issues, 'duplicate_row', `Duplicate mapping identity ${value}`, grouped[0].rowIndex));
  const exactDuplicateRowsCollapsed = collapsed.exactDuplicateGroups.reduce((total, group) => total + group.collapsedRows, 0);
  const existingGlobalColoursReused = unique(effectiveRows.filter((row) => row.reusedExistingGlobalColour).map((row) => `${normalizeCanonicalColourName(row.officialColourName)}|${codeKey(row.internalColourCode)}`)).map((value) => {
    const [canonicalColourName, internalColourCode] = value.split('|');
    const row = effectiveRows.find((candidate) => normalizeCanonicalColourName(candidate.officialColourName) === canonicalColourName && codeKey(candidate.internalColourCode) === internalColourCode);
    return { canonicalColourName: row?.officialColourName || canonicalColourName, internalColourCode, source: row?.reconciliationEvidence?.resolvedFrom || null };
  });
  const productScopedSupplierCodeReuse = [...new Map(effectiveRows.map((row) => [codeKey(row.supplierColourCode), []])).keys()]
    .map((supplierColourCode) => effectiveRows.filter((row) => codeKey(row.supplierColourCode) === supplierColourCode))
    .filter((group) => new Set(group.map((row) => `${row.fabricDocumentId}|${codeKey(row.supplierProductCode)}`)).size > 1)
    .map((group) => ({ supplierColourCode: group[0].supplierColourCode, mappings: group.map((row) => ({ fabricDocumentId: row.fabricDocumentId, supplierProductCode: row.supplierProductCode, officialColourName: row.officialColourName, internalColourCode: row.internalColourCode })) }));
  duplicateFabricColourCodes.forEach(([value, grouped]) => addIssue(issues, 'duplicate_fabric_colour_code', `Duplicate fabricColourCode ${value}`, grouped[0].rowIndex));
  const validationSummary = {
    totalFabrics: document.fabrics.length,
    inputRows: rows.length,
    totalRows: effectiveRows.length,
    resolvedFabrics: [...resolvedFabrics.values()].filter((item) => item.status === 'resolved').length,
    missingFabrics: [...resolvedFabrics.values()].filter((item) => item.status === 'missing').length,
    ambiguousFabrics: [...resolvedFabrics.values()].filter((item) => item.status === 'ambiguous').length,
    missingFabricDetails: [...resolvedFabrics.entries()].filter(([, item]) => item.status === 'missing').map(([fabricIndex, item]) => ({ fabricIndex, fabricName: item.inputFabricName, supplierProductCode: item.inputSupplierProductCode })),
    ambiguousFabricDetails: [...resolvedFabrics.entries()].filter(([, item]) => item.status === 'ambiguous').map(([fabricIndex, item]) => ({ fabricIndex, fabricName: item.inputFabricName, supplierProductCode: item.inputSupplierProductCode, candidates: item.candidates })),
    duplicateFabricColourCodes: duplicateFabricColourCodes.map(([value, grouped]) => ({ value, rowIndexes: grouped.map((row) => row.rowIndex) })),
    duplicateRows: duplicateRows.map(([value, grouped]) => ({ value, rowIndexes: grouped.map((row) => row.rowIndex) })),
    exactDuplicateGroups: collapsed.exactDuplicateGroups,
    exactDuplicateRowsCollapsed,
    contradictoryDuplicateGroups: collapsed.contradictoryGroups.map(({ value, rows: grouped }) => ({ value, rowIndexes: grouped.map((row) => row.rowIndex) })),
    contradictoryDuplicates: contradictoryRows.map(([value, grouped]) => ({ value, rowIndexes: grouped.map((row) => row.rowIndex) })),
    existingGlobalColoursReused,
    globalColoursReused: existingGlobalColoursReused.length,
    productScopedSupplierCodeReuse,
    unknownEvidenceStatuses: issues.filter((issue) => issue.type === 'unknown_evidence_status').length,
    missingOfficialColourNames: issues.filter((issue) => issue.type === 'official_colour_name_missing').length,
    missingInternalCodes: issues.filter((issue) => issue.type === 'internal_code_missing').length,
    canonicalNameCodeCollisions: 0,
    internalCodeCanonicalNameCollisions: issues.filter((issue) => issue.type === 'mapping_identity_conflict').length,
    codeReconciliations,
    convertedBlockingErrors: codeReconciliations.length,
    approvedCodeReconciliations: codeReconciliations.filter((item) => item.reason === 'approved_registry_code_reused' || item.reason === 'submitted_code_belongs_to_different_canonical_colour').length,
    automaticallyCorrectedInternalCodes: codeReconciliations.filter((item) => codeKey(item.incomingInternalColourCode) !== codeKey(item.resolvedInternalColourCode)).length,
    resolvedFabricDetails: Object.fromEntries(resolvedFabrics.entries()),
    issueCount: issues.length,
    valid: issues.length === 0,
  };
  supplierMappingLog('validation.summary', {
    supplier: document.supplier,
    totalFabrics: validationSummary.totalFabrics,
    inputRows: validationSummary.inputRows,
    resolvedFabrics: validationSummary.resolvedFabrics,
    missingFabrics: validationSummary.missingFabrics,
    ambiguousFabrics: validationSummary.ambiguousFabrics,
    issueCount: validationSummary.issueCount,
    valid: validationSummary.valid,
  });
  return { document, rows: effectiveRows, issues, validationSummary };
}

async function getActiveVersion(strapi, supplier) {
  const versions = await strapi.entityService.findMany(IMPORT_UID, { filters: { supplier, status: 'active', isActive: true }, sort: ['updatedAt:desc'], limit: 1 });
  const version = versions?.[0] || null;
  if (version) requireDocumentId(version.documentId, 'active mapping import documentId');
  return version;
}

async function mappingsForVersion(strapi, version) {
  if (!version) return [];
  const importDocumentId = requireDocumentId(version.documentId, 'mapping import documentId');
  return strapi.documents(MAPPING_UID).findMany({ filters: { mappingImport: { documentId: importDocumentId }, isActive: true }, populate: ['fabric'], limit: 10000 });
}

function importerColourMap(version, rows) {
  const products = {};
  for (const fabric of version.sourcePayload?.fabrics || []) {
    const productKey = `${codeKey(fabric.supplierProductCode)}|${fabric.fabricDocumentId || fabric.fabricName}`;
      products[productKey] = {
        productName: fabric.fabricName,
        fabricName: fabric.fabricName,
        ...(fabric.fabricDocumentId ? { fabricDocumentId: fabric.fabricDocumentId } : {}),
      supplierProductCode: fabric.supplierProductCode,
      mappingVersion: version.version,
      filenamePrefixes: [fabric.supplierProductCode],
      approvedAliases: [],
      colours: {},
    };
  }
  for (const row of rows || []) {
    const productKey = `${codeKey(row.supplierProductCode)}|${row.fabricDocumentId || row.fabricName}`;
    if (!products[productKey]) {
      products[productKey] = {
        productName: row.fabricName,
        fabricName: row.fabricName,
        ...(row.fabricDocumentId ? { fabricDocumentId: row.fabricDocumentId } : {}),
        supplierProductCode: row.supplierProductCode,
        mappingVersion: version.version,
        filenamePrefixes: [row.supplierProductCode],
        approvedAliases: [],
        colours: {},
      };
    }
    products[productKey].colours[row.supplierColourCode] = {
      supplierColourCode: row.supplierColourCode,
      supplierColourName: row.officialColourName,
      internalColourCode: row.internalColourCode,
      resolved: Boolean(row.officialColourName && row.internalColourCode),
      ...(row.officialColourName && row.internalColourCode ? {} : { reason: row.reconciliationReason || 'Active mapping row is unresolved.' }),
      evidenceStatus: row.evidenceStatus,
      evidence: { source: `${row.source || 'Strapi supplier mapping'} (mapping version ${version.version})` },
    };
  }
  return { schemaVersion: version.schemaVersion || 1, supplier: SUPPLIER, mappingVersion: version.version, generatedAt: version.importedAt, products };
}

function normalizeActiveImporterMapping(payload) {
  const version = payload?.version;
  const file = 'active Ashley Wilde mapping';
  const versionSupplier = normalizeActiveSupplier(version?.supplier, file);
  const sourceSupplier = normalizeActiveSupplier(version?.sourcePayload?.supplier || versionSupplier, file);
  const rawColourMap = payload?.colourMap || importerColourMap(version, payload?.rows || []);
  normalizeActiveSupplier(rawColourMap?.supplier || versionSupplier, file);
  const colourMap = { ...rawColourMap, supplier: SUPPLIER };
  validateColourMap(colourMap, file);
  return { version, rows: payload?.rows || [], colourMap, source: 'strapi-active-version' };
}

async function getActiveImporterMappings(strapi, supplier) {
  const canonicalSupplier = normalizeActiveSupplier(supplier, 'Ashley Wilde importer request');
  const version = await getActiveVersion(strapi, canonicalSupplier);
  if (!version) return null;
  const rows = await mappingsForVersion(strapi, version);
  return normalizeActiveImporterMapping({ version, rows });
}

function compareRows(rows, activeRows) {
  const incoming = new Map(rows.map((row) => [scopeKey(row), row]));
  const current = new Map((activeRows || []).map((row) => [scopeKey(row), row]));
  const unchanged = [], added = [], changed = [], removed = [];
  for (const [key, row] of incoming.entries()) {
    const previous = current.get(key);
    if (!previous) added.push(row);
    else if (codeKey(previous.internalColourCode) === codeKey(row.internalColourCode) && normalizeCanonicalColourName(previous.officialColourName) === normalizeCanonicalColourName(row.officialColourName) && previous.evidenceStatus === row.evidenceStatus) unchanged.push(row);
    else changed.push({ previous, next: row });
  }
  for (const [key, row] of current.entries()) if (!incoming.has(key)) removed.push(row);
  return { unchanged, added, changed, removed };
}

function canonicalSourceDocument(preview) {
  const fabrics = preview.document.fabrics.map((fabric, fabricIndex) => {
    const resolution = preview.validationSummary.resolvedFabricDetails?.[fabricIndex] || null;
    const fabricRows = preview.rows.filter((row) => row.fabricIndex === fabricIndex);
    return {
      ...fabric,
      fabricName: fabricRows[0]?.fabricName || resolution?.fabricName || fabric.fabricName,
      fabricDocumentId: resolution?.fabricDocumentId || fabricRows[0]?.fabricDocumentId || null,
      supplierProductCode: fabricRows[0]?.supplierProductCode || resolution?.supplierProductCode || fabric.supplierProductCode,
      colours: fabricRows.map((row) => ({
        supplierColourCode: row.supplierColourCode,
        fabricColourCode: row.fabricColourCode,
        officialColourName: row.officialColourName,
        internalColourCode: row.internalColourCode,
        submittedInternalColourCode: row.incomingInternalColourCode,
        reconciliationReason: row.reconciliationReason || null,
        reconciliationEvidence: row.reconciliationEvidence || null,
        evidenceStatus: row.evidenceStatus,
        source: row.source,
        notes: row.notes,
      })),
    };
  });
  return { ...preview.document, fabrics };
}

async function buildPreview(strapi, input) {
  const validated = await validateDocument(strapi, input);
  const active = await getActiveVersion(strapi, validated.document.supplier);
  const activeRows = await mappingsForVersion(strapi, active);
  const comparison = compareRows(validated.rows, activeRows);
  validated.validationSummary = {
    ...validated.validationSummary,
    unchangedMappings: comparison.unchanged.length,
    newMappings: comparison.added.length,
    changedMappings: comparison.changed.length,
    removedMappings: comparison.removed.length,
    blockingErrors: validated.issues.length,
  };
  const preview = { ...validated, activeVersion: active ? { documentId: active.documentId, version: active.version, status: active.status } : null, comparison };
  preview.canonicalDocument = canonicalSourceDocument(preview);
  return preview;
}

function adminAudit(ctx) {
  const user = ctx?.state?.user;
  return user ? { id: user.id, documentId: user.documentId, username: user.username, email: user.email } : null;
}

function safeImportRecord(record) {
  if (!record) return null;
  const { sourcePayload, ...safe } = record;
  return safe;
}

async function uploadMapping(strapi, ctx) {
  const upload = Array.isArray(ctx.request.files?.file) ? ctx.request.files.file[0] : ctx.request.files?.file;
  let text;
  let originalFilename = 'mapping.json';
  if (upload) {
    originalFilename = upload.originalFilename || upload.name || originalFilename;
    if (path.extname(originalFilename).toLowerCase() !== '.json') throw new Error('Only .json mapping files are accepted.');
    const size = Number(upload.size || 0);
    if (size > MAX_JSON_BYTES) throw new Error(`Mapping JSON exceeds the ${MAX_JSON_BYTES} byte limit.`);
    text = await fs.promises.readFile(upload.filepath || upload.path);
  } else {
    text = String(ctx.request.body?.json || ctx.request.body?.payload || '');
    originalFilename = String(ctx.request.body?.originalFilename || originalFilename);
  }
  assertJsonSize(text);
  let parsed;
  try { parsed = JSON.parse(text.toString('utf8')); } catch { throw new Error('Mapping upload is not valid JSON.'); }
  const preview = await buildPreview(strapi, parsed);
  const record = await strapi.entityService.create(IMPORT_UID, { data: {
    supplier: preview.document.supplier || 'Unknown', name: preview.document.source || preview.document.supplier || 'Supplier mapping', version: preview.document.mappingVersion || 'unversioned', schemaVersion: preview.document.schemaVersion || 1,
    status: preview.validationSummary.valid ? 'ready' : 'invalid', originalFilename, sha256: hashJson(preview.canonicalDocument), importedAt: new Date().toISOString(), importedBy: adminAudit(ctx), mappingCount: preview.rows.length, fabricCount: preview.document.fabrics.length, validationSummary: { ...preview.validationSummary, issues: preview.issues }, notes: preview.document.notes, isActive: false, sourceType: 'json_upload', sourceReference: preview.document.source, sourcePayload: preview.canonicalDocument,
  } });
  if (!record?.documentId) throw new Error('Validated mapping import did not return a Strapi documentId.');
  return { import: safeImportRecord(record), preview: { ...preview, document: undefined, importDocumentId: record.documentId } };
}

async function applyMapping(strapi, ctx) {
  const importDocumentId = requireDocumentId(ctx.request.body?.importDocumentId || ctx.request.body?.documentId, 'importDocumentId');
  if (!(ctx.request.body?.confirm === true || ctx.request.body?.confirm === 'true')) throw new Error('Explicit confirmation is required to activate a mapping version.');
  const record = await strapi.documents(IMPORT_UID).findOne({ documentId: importDocumentId, populate: ['mappings'] });
  if (!record) throw new Error('Mapping import version was not found.');
  const recordDocumentId = requireDocumentId(record.documentId, 'mapping import documentId');
  const importRowId = requireNumericId(record.id, 'mapping import row ID');
  if (record.status === 'active' && record.isActive) return { import: safeImportRecord(record), activated: false, alreadyActive: true };
  const preview = await buildPreview(strapi, record.sourcePayload);
  if (!preview.validationSummary.valid) {
    await strapi.entityService.update(IMPORT_UID, record.id, { data: { status: 'invalid', validationSummary: { ...preview.validationSummary, issues: preview.issues } } });
    throw new Error(`Mapping version is invalid and cannot be activated (${preview.issues.length} issue(s)).`);
  }
  const mappings = preview.rows;
  const active = await getActiveVersion(strapi, preview.document.supplier);
  const result = await strapi.db.transaction(async ({ trx }) => {
    if (active && active.documentId !== record.documentId) {
      const activeImportRowId = requireNumericId(active.id, 'active mapping import row ID');
      await strapi.entityService.update(IMPORT_UID, activeImportRowId, { data: { status: 'superseded', isActive: false }, transacting: trx });
    }
    for (const row of mappings) {
      await strapi.entityService.create(MAPPING_UID, { data: {
        mappingImport: recordDocumentId, supplier: row.supplier, fabric: row.fabricDocumentId, fabricDocumentId: row.fabricDocumentId, fabricName: row.fabricName, supplierProductCode: row.supplierProductCode, supplierColourCode: row.supplierColourCode, fabricColourCode: row.fabricColourCode, officialColourName: row.officialColourName, internalColourCode: row.internalColourCode, submittedInternalColourCode: row.incomingInternalColourCode, reconciliationReason: row.reconciliationReason, reconciliationEvidence: row.reconciliationEvidence, evidenceStatus: row.evidenceStatus, source: row.source, notes: row.notes, isActive: true,
      }, transacting: trx });
      const normalizedCode = codeKey(row.internalColourCode);
      const normalizedName = normalizeCanonicalColourName(row.officialColourName);
      const existingByName = await strapi.entityService.findMany(REGISTRY_UID, { filters: { normalizedColourName: normalizedName, status: 'approved' }, limit: 1, transacting: trx });
      const existingByCode = await strapi.entityService.findMany(REGISTRY_UID, { filters: { normalizedInternalCode: normalizedCode, status: 'approved' }, limit: 1, transacting: trx });
      if (!existingByName?.length && !existingByCode?.length) await strapi.entityService.create(REGISTRY_UID, { data: { canonicalColourName: row.officialColourName, normalizedColourName: normalizedName, internalColourCode: row.internalColourCode, normalizedInternalCode: normalizedCode, status: 'approved', source: row.source || `Mapping ${preview.document.mappingVersion}`, approvedAt: new Date().toISOString(), approvedBy: adminAudit(ctx) }, transacting: trx });
    }
    return strapi.entityService.update(IMPORT_UID, importRowId, { data: { status: 'active', isActive: true, mappingCount: mappings.length, fabricCount: preview.document.fabrics.length, validationSummary: { ...preview.validationSummary, issues: [] }, sourcePayload: preview.canonicalDocument, sha256: hashJson(preview.canonicalDocument), importedAt: record.importedAt || new Date().toISOString() }, transacting: trx });
  });
  return { import: safeImportRecord(result), activated: true, preview: { ...preview, document: undefined } };
}

async function getActiveMappings(strapi, supplier) {
  const version = await getActiveVersion(strapi, supplier);
  const rows = await mappingsForVersion(strapi, version);
  return { version: safeImportRecord(version), rows };
}

async function exportMapping(strapi, importDocumentId) {
  const selectedImportDocumentId = requireDocumentId(importDocumentId, 'importDocumentId');
  const version = await strapi.documents(IMPORT_UID).findOne({ documentId: selectedImportDocumentId });
  if (!version) throw new Error('Mapping import version was not found.');
  const rows = await mappingsForVersion(strapi, version);
  const fabrics = new Map();
  for (const row of rows) {
    const key = `${row.fabricDocumentId}|${row.supplierProductCode}`;
    if (!fabrics.has(key)) fabrics.set(key, { fabricName: row.fabricName, fabricDocumentId: row.fabricDocumentId, supplierProductCode: row.supplierProductCode, colours: [] });
    fabrics.get(key).colours.push({ supplierColourCode: row.supplierColourCode, fabricColourCode: row.fabricColourCode, officialColourName: row.officialColourName, internalColourCode: row.internalColourCode, submittedInternalColourCode: row.submittedInternalColourCode, reconciliationReason: row.reconciliationReason, reconciliationEvidence: row.reconciliationEvidence, evidenceStatus: row.evidenceStatus, source: row.source, notes: row.notes });
  }
  return { schemaVersion: version.schemaVersion || 1, supplier: version.supplier, mappingVersion: version.version, source: version.sourceReference || version.name, fabrics: [...fabrics.values()] };
}

function repositoryFallbackDocument() {
  const mappings = loadProductionMappings({ mode: 'production' });
  const registry = mappings.codeRegistry.codes || {};
  const byCode = new Map(Object.entries(registry).map(([code, entry]) => [codeKey(code), { code, name: entry.colourName }]));
  const byName = new Map(Object.entries(registry).map(([code, entry]) => [normalizeCanonicalColourName(entry.colourName), { code, name: entry.colourName }]));
  const blocked = [];
  const fabrics = Object.values(mappings.colourMap.products).map((product) => {
    const colours = [];
    for (const colour of Object.values(product.colours || {})) {
      const sourceName = clean(colour.supplierColourName);
      const sourceCode = clean(colour.internalColourCode);
      const named = byName.get(normalizeCanonicalColourName(sourceName));
      const coded = byCode.get(codeKey(sourceCode));
      const reason = !colour.resolved ? 'Source mapping is unresolved.'
        : !named ? 'Canonical colour name has no approved registry assignment.'
          : !coded || codeKey(coded.code) !== codeKey(named.code) ? `Canonical registry collision: ${sourceName} does not safely resolve to ${sourceCode}.` : null;
      if (reason) {
        blocked.push({ fabricName: product.fabricName, supplierProductCode: product.supplierProductCode, supplierColourCode: colour.supplierColourCode, officialColourName: sourceName, internalColourCode: sourceCode, reason });
        continue;
      }
      const metadata = { sourceImage: colour.sourceImage || null, colourwayUrl: colour.evidence?.colourwayUrl || null, productUrl: colour.evidence?.productUrl || null, confidence: colour.evidence?.confidence ?? null, imageUrl: colour.evidence?.imageUrl || null };
      colours.push({ supplierColourCode: colour.supplierColourCode, fabricColourCode: `${product.supplierProductCode}${colour.supplierColourCode}`, officialColourName: sourceName, internalColourCode: named.code, evidenceStatus: 'verified_official', source: colour.evidence?.source || 'approved Ashley Wilde repository mapping', notes: JSON.stringify(metadata) });
    }
    return { fabricName: product.fabricName, fabricDocumentId: product.fabricDocumentId || null, supplierProductCode: product.supplierProductCode, colours };
  });
  return {
    document: { schemaVersion: 1, supplier: mappings.colourMap.supplier || 'Ashley Wilde', mappingVersion: mappings.colourMap.generatedAt, source: 'Approved repository Ashley Wilde colour map and canonical code registry', notes: 'Generated from the approved repository map and registry. Rows without a safe canonical registry assignment are excluded.', fabrics },
    blocked,
  };
}

async function exportRepositoryFallback() {
  return repositoryFallbackDocument();
}

async function mappingRowsForFilters(strapi, options) {
  const importDocumentId = options.mappingVersion ? requireDocumentId(options.mappingVersion, 'mappingVersion documentId') : null;
  const version = importDocumentId ? await strapi.documents(IMPORT_UID).findOne({ documentId: importDocumentId }) : await getActiveVersion(strapi, options.supplier);
  if (!version) return { version: null, rows: [] };
  return { version, rows: await mappingsForVersion(strapi, version) };
}

async function reenrichSupplierMappings(strapi, ctx) {
  const options = { supplier: clean(ctx.request.body?.supplier || 'Ashley Wilde'), supplierProductCode: clean(ctx.request.body?.supplierProductCode), fabricName: clean(ctx.request.body?.fabricName), mappingVersion: clean(ctx.request.body?.mappingVersion) };
  const { version, rows } = await mappingRowsForFilters(strapi, options);
  if (!version) throw new Error('No active mapping version exists for this supplier.');
  const filters = { supplier: options.supplier };
  if (options.supplierProductCode) filters.supplierProductCode = options.supplierProductCode;
  if (options.fabricName) filters.fabric = { name: { $eqi: options.fabricName } };
  const identities = await strapi.entityService.findMany('api::fabric-colour-identity.fabric-colour-identity', { filters, populate: ['fabric'], limit: 10000 });
  const mappings = new Map(rows.map((row) => [scopeKey(row), row]));
  const results = identities.map((identity) => {
    const key = scopeKey({ supplier: identity.supplier, fabricDocumentId: identity.fabricDocumentId, supplierProductCode: identity.supplierProductCode, supplierColourCode: identity.supplierColourCode });
    const mapping = mappings.get(key);
    if (identity.mappingStatus === 'promoted') return { identityDocumentId: identity.documentId, status: 'unchanged', reason: 'promoted_identity_is_not_modified', mapping: mapping || null };
    if (!mapping) return { identityDocumentId: identity.documentId, status: identity.mappingStatus === 'verified' ? 'conflict' : 'pending', reason: 'mapping_missing', mapping: null };
    const sameName = normalizeCanonicalColourName(identity.officialColourName) === normalizeCanonicalColourName(mapping.officialColourName);
    const sameCode = codeKey(identity.internalColourCode) === codeKey(mapping.internalColourCode);
    const same = identity.mappingStatus === 'verified' && sameName && sameCode;
    if (same) return { identityDocumentId: identity.documentId, status: 'unchanged', reason: 'mapping_matches_active_version', mapping };
    if (identity.mappingStatus === 'verified' && !sameName) return { identityDocumentId: identity.documentId, status: 'conflict', reason: 'existing_verified_mapping_name_differs', mapping };
    if (identity.mappingStatus === 'verified') return { identityDocumentId: identity.documentId, status: 'would_reconcile', reason: 'verified_identity_reuses_active_canonical_mapping', mapping };
    return { identityDocumentId: identity.documentId, status: 'would_verify', reason: 'pending_identity_matches_mapping', mapping };
  });
  const summary = { total: results.length, wouldVerify: results.filter((item) => item.status === 'would_verify').length, wouldReconcile: results.filter((item) => item.status === 'would_reconcile').length, pending: results.filter((item) => item.status === 'pending').length, unchanged: results.filter((item) => item.status === 'unchanged').length, conflicts: results.filter((item) => item.status === 'conflict').length };
  const apply = ctx.request.body?.apply === true || ctx.request.body?.apply === 'true';
  if (apply) {
    if (!(ctx.request.body?.confirm === true || ctx.request.body?.confirm === 'true')) throw new Error('Explicit confirmation is required to apply re-enrichment.');
    for (const item of results.filter((candidate) => ['would_verify', 'would_reconcile'].includes(candidate.status))) {
      await strapi.entityService.update('api::fabric-colour-identity.fabric-colour-identity', item.identityDocumentId, { data: { displayName: `${item.mapping.fabricName} — ${item.mapping.officialColourName}`, officialColourName: item.mapping.officialColourName, internalColourCode: item.mapping.internalColourCode, mappingStatus: 'verified', evidenceStatus: item.mapping.evidenceStatus, source: `${item.mapping.source || 'Strapi mapping'} (version ${version.version})`, mappingVersion: version.version } });
    }
    return { version: safeImportRecord(version), summary, results, applied: summary.wouldVerify + summary.wouldReconcile };
  }
  return { version: safeImportRecord(version), summary, results, applied: 0 };
}

module.exports = { MAX_JSON_BYTES, applyMapping, buildPreview, exportMapping, exportRepositoryFallback, getActiveImporterMappings, getActiveMappings, getActiveVersion, loadRegistry, mappingsForVersion, normalizeActiveImporterMapping, normalizeDocument, reenrichSupplierMappings, uploadMapping, validateDocument };
