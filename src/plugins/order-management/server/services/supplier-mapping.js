'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadProductionMappings, normalizeCanonicalColourName, normalizeToken } = require('../../shared/ashley-wilde-mapping');

const IMPORT_UID = 'api::supplier-mapping-import.supplier-mapping-import';
const MAPPING_UID = 'api::supplier-fabric-colour-mapping.supplier-fabric-colour-mapping';
const REGISTRY_UID = 'api::canonical-colour-registry.canonical-colour-registry';
const FABRIC_UID = 'api::fabric.fabric';
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const EVIDENCE_STATUSES = new Set(['pending_manual', 'verified_manual', 'verified_official', 'unresolved']);

function clean(value) { return String(value || '').normalize('NFKC').trim(); }
function nameKey(value) { return clean(value).replace(/\s+/g, ' ').toLocaleLowerCase(); }
function codeKey(value) { return normalizeToken(value); }
function relationId(value) { return value?.documentId || value?.id || value; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function scopeKey(row) { return [clean(row.supplier), String(row.fabricDocumentId || ''), clean(row.supplierProductCode), clean(row.supplierColourCode)].join('|'); }
function hashJson(value) { return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex'); }

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
      officialColourName: colour.resolved === false ? null : (colour.officialColourName || colour.supplierColourName),
      internalColourCode: colour.resolved === false ? null : colour.internalColourCode,
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
        officialColourName: clean(colour?.officialColourName || colour?.supplierColourName),
        internalColourCode: clean(colour?.internalColourCode),
        evidenceStatus: clean(colour?.evidenceStatus || (colour?.officialColourName ? 'verified_manual' : 'pending_manual')),
        source: clean(colour?.source),
        notes: clean(colour?.notes),
      })),
    })),
  };
}

async function fabricCandidates(strapi, row) {
  const candidates = await strapi.entityService.findMany(FABRIC_UID, {
    filters: { name: { $eqi: row.fabricName } },
    populate: ['brand'],
    limit: 100,
  });
  return (candidates || []).filter((fabric) => {
    const brands = Array.isArray(fabric.brand) ? fabric.brand : [fabric.brand];
    return brands.some((brand) => nameKey(brand?.name) === nameKey(row.supplier));
  });
}

async function resolveFabric(strapi, row) {
  const candidates = await fabricCandidates(strapi, row);
  const byDocumentId = row.fabricDocumentId && candidates.filter((fabric) => String(fabric.documentId) === String(row.fabricDocumentId));
  if (byDocumentId.length === 1) return { status: 'resolved', fabric: byDocumentId[0] };
  const byProductCode = candidates.filter((fabric) => [fabric.productId, fabric.slug].some((value) => codeKey(value) === codeKey(row.supplierProductCode)));
  if (byProductCode.length === 1) return { status: 'resolved', fabric: byProductCode[0] };
  if (candidates.length === 1) return { status: 'resolved', fabric: candidates[0] };
  return { status: candidates.length ? 'ambiguous' : 'missing', candidates };
}

async function loadRegistry(strapi, supplier) {
  const rows = await strapi.entityService.findMany(REGISTRY_UID, { filters: { status: 'approved' }, limit: 10000 });
  const byCode = new Map((rows || []).map((row) => [codeKey(row.normalizedInternalCode || row.internalColourCode), row]));
  const byName = new Map((rows || []).map((row) => [normalizeCanonicalColourName(row.normalizedColourName || row.canonicalColourName), row]));
  if (nameKey(supplier) === nameKey('Ashley Wilde')) {
    try {
      const fallback = loadProductionMappings({ mode: 'production' }).codeRegistry.codes || {};
      for (const [code, entry] of Object.entries(fallback)) {
        if (!byCode.has(codeKey(code))) byCode.set(codeKey(code), { internalColourCode: code, canonicalColourName: entry.colourName, source: 'approved repository registry' });
        if (!byName.has(normalizeCanonicalColourName(entry.colourName))) byName.set(normalizeCanonicalColourName(entry.colourName), { internalColourCode: code, canonicalColourName: entry.colourName, source: 'approved repository registry' });
      }
    } catch { /* repository fallback is optional for non-Ashley or incomplete installs */ }
  }
  return { byCode, byName };
}

function addIssue(issues, type, message, rowIndex = null) {
  issues.push({ type, message, rowIndex });
}

async function validateDocument(strapi, input) {
  const document = normalizeDocument(input);
  const issues = [];
  if (document.schemaVersion !== 1) addIssue(issues, 'schema_version', 'schemaVersion must be 1');
  if (!document.supplier) addIssue(issues, 'supplier_missing', 'supplier is required');
  if (!document.mappingVersion) addIssue(issues, 'mapping_version_missing', 'mappingVersion is required');
  if (!document.fabrics.length) addIssue(issues, 'fabrics_missing', 'fabrics must contain at least one Fabric');
  const registry = await loadRegistry(strapi, document.supplier);
  const rows = [];
  const resolvedFabrics = new Map();
  const productGroups = new Map();
  const codeGroups = new Map();
  const identityGroups = new Map();
  const nameToCode = new Map();
  const codeToName = new Map();
  const codeReconciliations = [];

  for (let fabricIndex = 0; fabricIndex < document.fabrics.length; fabricIndex += 1) {
    const fabricInput = document.fabrics[fabricIndex];
    if (!fabricInput.fabricName) addIssue(issues, 'fabric_name_missing', `Fabric ${fabricIndex + 1} has no fabricName`, fabricIndex);
    if (!fabricInput.supplierProductCode) addIssue(issues, 'product_code_missing', `Fabric ${fabricInput.fabricName || fabricIndex + 1} has no supplierProductCode`, fabricIndex);
    const resolution = fabricInput.fabricName && fabricInput.supplierProductCode ? await resolveFabric(strapi, { ...fabricInput, supplier: document.supplier }) : { status: 'missing' };
    const fabric = resolution.fabric;
    const fabricResolution = { status: resolution.status, fabricDocumentId: fabric?.documentId || null, fabricName: fabric?.name || fabricInput.fabricName, candidates: (resolution.candidates || []).map((item) => item.documentId || item.id) };
    resolvedFabrics.set(fabricIndex, fabricResolution);
    if (resolution.status === 'missing') addIssue(issues, 'fabric_missing', `No ${document.supplier} Fabric named ${fabricInput.fabricName} could be resolved`, fabricIndex);
    if (resolution.status === 'ambiguous') addIssue(issues, 'fabric_ambiguous', `Fabric ${fabricInput.fabricName} resolves to multiple catalogue records`, fabricIndex);
    const productKey = codeKey(fabricInput.supplierProductCode);
    if (productKey) {
      if (!productGroups.has(productKey)) productGroups.set(productKey, []);
      productGroups.get(productKey).push(fabricInput.fabricName);
    }
    for (let colourIndex = 0; colourIndex < fabricInput.colours.length; colourIndex += 1) {
      const colour = fabricInput.colours[colourIndex];
      const rowIndex = rows.length;
      const fabricDocumentId = fabric?.documentId || fabricInput.fabricDocumentId || null;
      const normalized = {
        rowIndex,
        fabricName: fabric?.name || fabricInput.fabricName,
        fabricDocumentId,
        supplier: document.supplier,
        supplierProductCode: fabricInput.supplierProductCode,
        supplierColourCode: colour.supplierColourCode,
        fabricColourCode: `${fabricInput.supplierProductCode}${colour.supplierColourCode}`,
        officialColourName: colour.officialColourName || null,
        internalColourCode: colour.internalColourCode || null,
        incomingInternalColourCode: colour.internalColourCode || null,
        evidenceStatus: colour.evidenceStatus || 'pending_manual',
        source: colour.source || document.source || null,
        notes: colour.notes || null,
        fabricResolution,
      };
      const canonicalName = normalizeCanonicalColourName(normalized.officialColourName);
      const incomingCode = codeKey(normalized.internalColourCode);
      const approvedByName = canonicalName ? registry.byName.get(canonicalName) : null;
      const approvedByCode = incomingCode ? registry.byCode.get(incomingCode) : null;
      if (approvedByName) {
        normalized.internalColourCode = approvedByName.internalColourCode;
        if (incomingCode && codeKey(approvedByName.internalColourCode) !== incomingCode) {
          codeReconciliations.push({ rowIndex, officialColourName: normalized.officialColourName, incomingInternalColourCode: normalized.incomingInternalColourCode, approvedInternalColourCode: approvedByName.internalColourCode, reason: 'approved_registry_code_reused' });
        }
        if (approvedByCode && normalizeCanonicalColourName(approvedByCode.canonicalColourName) !== canonicalName) {
          addIssue(issues, 'internal_code_collision', `Internal code ${normalized.incomingInternalColourCode} is already assigned to ${approvedByCode.canonicalColourName}, not ${normalized.officialColourName}`, rowIndex);
        }
      } else if (approvedByCode && normalizeCanonicalColourName(approvedByCode.canonicalColourName) !== canonicalName) {
        addIssue(issues, 'approved_registry_collision', `Internal code ${normalized.internalColourCode} already belongs to ${approvedByCode.canonicalColourName}`, rowIndex);
      }
      rows.push(normalized);
      if (!EVIDENCE_STATUSES.has(normalized.evidenceStatus)) addIssue(issues, 'unknown_evidence_status', `Unknown evidenceStatus ${normalized.evidenceStatus}`, rowIndex);
      if (!normalized.supplierColourCode) addIssue(issues, 'supplier_colour_code_missing', 'supplierColourCode is required', rowIndex);
      if (!normalized.officialColourName) addIssue(issues, 'official_colour_name_missing', 'officialColourName is required for an activated mapping', rowIndex);
      if (!normalized.internalColourCode) addIssue(issues, 'internal_code_missing', 'internalColourCode is required for an activated mapping', rowIndex);
      const expected = `${normalized.supplierProductCode}${normalized.supplierColourCode}`;
      if (!normalized.supplierColourCode || codeKey(normalized.fabricColourCode) !== codeKey(expected)) addIssue(issues, 'fabric_colour_code_invalid', 'fabricColourCode does not equal supplierProductCode + supplierColourCode', rowIndex);
      const identity = scopeKey(normalized);
      if (!identityGroups.has(identity)) identityGroups.set(identity, []);
      identityGroups.get(identity).push(rowIndex);
      const fabricCode = `${String(normalized.fabricDocumentId || normalized.fabricName)}|${codeKey(normalized.fabricColourCode)}`;
      if (!codeGroups.has(fabricCode)) codeGroups.set(fabricCode, []);
      codeGroups.get(fabricCode).push(rowIndex);
      const name = normalizeCanonicalColourName(normalized.officialColourName);
      const code = codeKey(normalized.internalColourCode);
      if (name && code) {
        if (nameToCode.has(name) && nameToCode.get(name) !== code) addIssue(issues, 'canonical_name_collision', `Canonical colour name ${normalized.officialColourName} is assigned multiple internal codes`, rowIndex);
        if (codeToName.has(code) && codeToName.get(code) !== name) addIssue(issues, 'internal_code_collision', `Internal code ${normalized.internalColourCode} is used for different canonical colour names`, rowIndex);
        nameToCode.set(name, code);
        codeToName.set(code, name);
        const approvedByName = registry.byName.get(name);
        if (approvedByName && codeKey(approvedByName.internalColourCode) !== code) addIssue(issues, 'approved_registry_collision', `Canonical colour ${normalized.officialColourName} already uses ${approvedByName.internalColourCode}`, rowIndex);
      }
    }
  }

  const duplicateRows = [...identityGroups.entries()].filter(([, indexes]) => indexes.length > 1);
  const duplicateFabricColourCodes = [...codeGroups.entries()].filter(([, indexes]) => indexes.length > 1);
  const duplicateSupplierProductCodes = [...productGroups.entries()].filter(([, names]) => unique(names.map(nameKey)).length > 1);
  duplicateRows.forEach(([value, indexes]) => addIssue(issues, 'duplicate_row', `Duplicate mapping identity ${value}`, indexes[0]));
  duplicateFabricColourCodes.forEach(([value, indexes]) => addIssue(issues, 'duplicate_fabric_colour_code', `Duplicate fabricColourCode ${value}`, indexes[0]));
  const validationSummary = {
    totalFabrics: document.fabrics.length,
    totalRows: rows.length,
    resolvedFabrics: [...resolvedFabrics.values()].filter((item) => item.status === 'resolved').length,
    missingFabrics: [...resolvedFabrics.values()].filter((item) => item.status === 'missing').length,
    ambiguousFabrics: [...resolvedFabrics.values()].filter((item) => item.status === 'ambiguous').length,
    duplicateSupplierProductCodes: duplicateSupplierProductCodes.map(([value, names]) => ({ value, fabrics: unique(names) })),
    duplicateFabricColourCodes: duplicateFabricColourCodes.map(([value, indexes]) => ({ value, rowIndexes: indexes })),
    duplicateRows: duplicateRows.map(([value, indexes]) => ({ value, rowIndexes: indexes })),
    unknownEvidenceStatuses: issues.filter((issue) => issue.type === 'unknown_evidence_status').length,
    missingOfficialColourNames: issues.filter((issue) => issue.type === 'official_colour_name_missing').length,
    missingInternalCodes: issues.filter((issue) => issue.type === 'internal_code_missing').length,
    canonicalNameCodeCollisions: issues.filter((issue) => issue.type === 'canonical_name_collision').length,
    internalCodeCanonicalNameCollisions: issues.filter((issue) => issue.type === 'internal_code_collision' || issue.type === 'approved_registry_collision').length,
    codeReconciliations,
    issueCount: issues.length,
    valid: issues.length === 0,
  };
  return { document, rows, issues, validationSummary };
}

async function getActiveVersion(strapi, supplier) {
  const versions = await strapi.entityService.findMany(IMPORT_UID, { filters: { supplier, status: 'active', isActive: true }, sort: ['updatedAt:desc'], limit: 1 });
  return versions?.[0] || null;
}

async function mappingsForVersion(strapi, version) {
  if (!version) return [];
  return strapi.entityService.findMany(MAPPING_UID, { filters: { mappingImport: version.documentId || version.id, isActive: true }, populate: ['fabric'], limit: 10000 });
}

function importerColourMap(version, rows) {
  const products = {};
  for (const fabric of version.sourcePayload?.fabrics || []) {
    const productKey = `${codeKey(fabric.supplierProductCode)}|${fabric.fabricDocumentId || fabric.fabricName}`;
    products[productKey] = {
      productName: fabric.fabricName,
      fabricName: fabric.fabricName,
      fabricDocumentId: fabric.fabricDocumentId || null,
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
        fabricDocumentId: row.fabricDocumentId,
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
      evidenceStatus: row.evidenceStatus,
      evidence: { source: `${row.source || 'Strapi supplier mapping'} (mapping version ${version.version})` },
    };
  }
  return { schemaVersion: version.schemaVersion || 1, mappingVersion: version.version, generatedAt: version.importedAt, products };
}

async function getActiveImporterMappings(strapi, supplier) {
  const version = await getActiveVersion(strapi, supplier);
  if (!version) return null;
  const rows = await mappingsForVersion(strapi, version);
  return { version, rows, colourMap: importerColourMap(version, rows), source: 'strapi-active-version' };
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

async function buildPreview(strapi, input) {
  const validated = await validateDocument(strapi, input);
  const active = await getActiveVersion(strapi, validated.document.supplier);
  const activeRows = await mappingsForVersion(strapi, active);
  return { ...validated, activeVersion: active ? { documentId: active.documentId, version: active.version, status: active.status } : null, comparison: compareRows(validated.rows, activeRows) };
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
    status: preview.validationSummary.valid ? 'ready' : 'invalid', originalFilename, sha256: hashJson(preview.document), importedAt: new Date().toISOString(), importedBy: adminAudit(ctx), mappingCount: preview.rows.length, fabricCount: preview.document.fabrics.length, validationSummary: { ...preview.validationSummary, issues: preview.issues }, notes: preview.document.notes, isActive: false, sourceType: 'json_upload', sourceReference: preview.document.source, sourcePayload: preview.document,
  } });
  if (!record?.documentId) throw new Error('Validated mapping import did not return a Strapi documentId.');
  return { import: safeImportRecord(record), preview: { ...preview, document: undefined, importDocumentId: record.documentId } };
}

async function applyMapping(strapi, ctx) {
  const documentId = clean(ctx.request.body?.importDocumentId || ctx.request.body?.documentId);
  if (!documentId) throw new Error('importDocumentId is required.');
  if (!(ctx.request.body?.confirm === true || ctx.request.body?.confirm === 'true')) throw new Error('Explicit confirmation is required to activate a mapping version.');
  const record = await strapi.documents(IMPORT_UID).findOne({ documentId, populate: ['mappings'] });
  if (!record) throw new Error('Mapping import version was not found.');
  if (record.status === 'active' && record.isActive) return { import: safeImportRecord(record), activated: false, alreadyActive: true };
  const preview = await buildPreview(strapi, record.sourcePayload);
  if (!preview.validationSummary.valid) {
    await strapi.entityService.update(IMPORT_UID, record.id, { data: { status: 'invalid', validationSummary: { ...preview.validationSummary, issues: preview.issues } } });
    throw new Error(`Mapping version is invalid and cannot be activated (${preview.issues.length} issue(s)).`);
  }
  const mappings = preview.rows;
  const active = await getActiveVersion(strapi, preview.document.supplier);
  const result = await strapi.db.transaction(async ({ trx }) => {
    if (active && active.id !== record.id) await strapi.entityService.update(IMPORT_UID, active.id, { data: { status: 'superseded', isActive: false }, transacting: trx });
    for (const row of mappings) {
      await strapi.entityService.create(MAPPING_UID, { data: {
        mappingImport: record.documentId, supplier: row.supplier, fabric: row.fabricDocumentId, fabricDocumentId: row.fabricDocumentId, fabricName: row.fabricName, supplierProductCode: row.supplierProductCode, supplierColourCode: row.supplierColourCode, fabricColourCode: row.fabricColourCode, officialColourName: row.officialColourName, internalColourCode: row.internalColourCode, evidenceStatus: row.evidenceStatus, source: row.source, notes: row.notes, isActive: true,
      }, transacting: trx });
      const normalizedCode = codeKey(row.internalColourCode);
      const normalizedName = nameKey(row.officialColourName);
      const existing = await strapi.entityService.findMany(REGISTRY_UID, { filters: { normalizedInternalCode: normalizedCode }, limit: 1, transacting: trx });
      if (!existing?.length) await strapi.entityService.create(REGISTRY_UID, { data: { canonicalColourName: row.officialColourName, normalizedColourName: normalizedName, internalColourCode: row.internalColourCode, normalizedInternalCode: normalizedCode, status: 'approved', source: row.source || `Mapping ${preview.document.mappingVersion}`, approvedAt: new Date().toISOString(), approvedBy: adminAudit(ctx) }, transacting: trx });
    }
    return strapi.entityService.update(IMPORT_UID, record.id, { data: { status: 'active', isActive: true, mappingCount: mappings.length, fabricCount: preview.document.fabrics.length, validationSummary: { ...preview.validationSummary, issues: [] }, importedAt: record.importedAt || new Date().toISOString() }, transacting: trx });
  });
  return { import: safeImportRecord(result), activated: true, preview: { ...preview, document: undefined } };
}

async function getActiveMappings(strapi, supplier) {
  const version = await getActiveVersion(strapi, supplier);
  const rows = await mappingsForVersion(strapi, version);
  return { version: safeImportRecord(version), rows };
}

async function exportMapping(strapi, documentId) {
  const version = await strapi.entityService.findOne(IMPORT_UID, documentId);
  if (!version) throw new Error('Mapping import version was not found.');
  const rows = await mappingsForVersion(strapi, version);
  const fabrics = new Map();
  for (const row of rows) {
    const key = `${row.fabricDocumentId}|${row.supplierProductCode}`;
    if (!fabrics.has(key)) fabrics.set(key, { fabricName: row.fabricName, fabricDocumentId: row.fabricDocumentId, supplierProductCode: row.supplierProductCode, colours: [] });
    fabrics.get(key).colours.push({ supplierColourCode: row.supplierColourCode, officialColourName: row.officialColourName, internalColourCode: row.internalColourCode, evidenceStatus: row.evidenceStatus, source: row.source, notes: row.notes });
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
  const version = options.mappingVersion ? await strapi.entityService.findOne(IMPORT_UID, options.mappingVersion) : await getActiveVersion(strapi, options.supplier);
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

module.exports = { MAX_JSON_BYTES, applyMapping, buildPreview, exportMapping, exportRepositoryFallback, getActiveImporterMappings, getActiveMappings, getActiveVersion, loadRegistry, mappingsForVersion, normalizeDocument, reenrichSupplierMappings, uploadMapping, validateDocument };
