'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  SUPPLIER, canonicalManifestLines, loadProductionMappings, normalizeCanonicalColourName, normalizeRelativePath,
  normalizeStem, normalizeToken, parseFilename,
} = require('../../shared/ashley-wilde-mapping');
const supplierMappings = require('./supplier-mapping');
const uploadPolicy = require('../../shared/ashley-wilde-upload-policy.json');

const BATCH_UID = 'api::image-import-batch.image-import-batch';
const FABRIC_UID = 'api::fabric.fabric';
const IDENTITY_UID = 'api::fabric-colour-identity.fabric-colour-identity';
const ASSET_UID = 'api::fabric-colour-asset.fabric-colour-asset';
const FILE_UID = 'plugin::upload.file';
const COLOUR_STATUSES = new Set(['matched', 'mapped', 'pending_manual_mapping', 'would_stage_identity', 'would_stage_asset', 'already_staged', 'staged', 'exact_duplicate', 'conflicting_image']);
const ANALYSIS_TOKEN_TTL_MS = 15 * 60 * 1000;

function safeMessage(error) {
  if (error?.code === 'ASHLEY_WILDE_MAPPING_INVALID') return error.message;
  if (error?.code === 'ASHLEY_WILDE_ANALYSIS_REQUIRED') return 'A successful Ashley Wilde filename analysis is required before staging files.';
  if (error?.code === 'ASHLEY_WILDE_ANALYSIS_INVALID') return 'The active supplier mapping changed after this folder was analysed. Analyse the folder again before continuing.';
  if (error?.code === 'ASHLEY_WILDE_MEDIA_INVALID') return 'The uploaded Media record could not be securely matched to this analysed image.';
  if (error?.code === 'ASHLEY_WILDE_FINALISATION_RETRYABLE') return 'The image was uploaded, but its staged fabric-colour link still needs to be completed.';
  return 'The folder import could not be processed safely.';
}

function adminIdentity(ctx) {
  const user = ctx?.state?.catalogWriteAuth?.user || ctx?.state?.user;
  return String(user?.documentId || user?.id || user?.email || '').trim();
}

function safeLog(strapi, stage, details = {}) {
  const entry = { timestamp: new Date().toISOString(), stage, ...details };
  const logger = strapi?.log?.info ? strapi.log : console;
  logger.info(`[Ashley Wilde bulk upload] ${JSON.stringify(entry)}`);
}

async function timedStage(strapi, stage, work, details = {}) {
  const startedAt = Date.now();
  safeLog(strapi, `${stage}-start`, details);
  try {
    const result = await work();
    safeLog(strapi, `${stage}-complete`, { ...details, durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    safeLog(strapi, `${stage}-failed`, { ...details, durationMs: Date.now() - startedAt, errorCode: error?.code || 'unknown' });
    throw error;
  }
}

function analysisTokenSecret() {
  const configured = process.env.STRAPI_INTERNAL_SECURITY_SECRET || process.env.APP_KEYS;
  if (!configured) {
    const error = new Error('Ashley Wilde analysis token signing is not configured');
    error.code = 'ASHLEY_WILDE_ANALYSIS_REQUIRED';
    throw error;
  }
  return String(configured).split(',')[0];
}

function base64url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function signAnalysisPayload(encodedPayload) {
  return crypto.createHmac('sha256', analysisTokenSecret()).update(encodedPayload, 'utf8').digest('base64url');
}

function createAnalysisToken({ mappingImportDocumentId, mappingVersion, manifestFingerprint: fingerprint, manifestFileCount, analyzedPaths, analyzedFiles, adminId }) {
  if (!adminId) {
    const error = new Error('Authenticated administrator identity is required for Ashley Wilde analysis');
    error.code = 'ASHLEY_WILDE_ANALYSIS_REQUIRED';
    throw error;
  }
  const paths = [...new Set((analyzedPaths || []).map(normalizeRelativePath))].sort();
  const payload = {
    version: 1,
    expiresAt: Date.now() + ANALYSIS_TOKEN_TTL_MS,
    adminId: String(adminId),
    mappingImportDocumentId: mappingImportDocumentId || null,
    mappingVersion: mappingVersion || null,
    manifestFingerprint: fingerprint,
    manifestFileCount,
    analyzedPaths: paths,
    analyzedFileCount: paths.length,
    analyzedFiles: (analyzedFiles || []).map((file) => ({
      relativePath: normalizeRelativePath(file.relativePath),
      filename: path.basename(normalizeRelativePath(file.relativePath)),
      sha256: String(file.sha256 || '').toLowerCase(),
      size: Number(file.size),
      mimeType: String(file.mimeType || '').toLowerCase() || null,
      status: file.status || null,
      supplierProductCode: file.supplierProductCode || null,
      supplierColourCode: file.supplierColourCode || null,
      supplierColourName: file.supplierColourName || null,
      internalColourCode: file.internalColourCode || null,
      fabricDocumentId: file.fabricDocumentId || file.resolvedFabricDocumentId || null,
    })),
  };
  const encoded = base64url(JSON.stringify(payload));
  return `aw-analysis.${encoded}.${signAnalysisPayload(encoded)}`;
}

function invalidAnalysisError() {
  const error = new Error('Ashley Wilde analysis token is invalid or no longer matches the selected folder.');
  error.code = 'ASHLEY_WILDE_ANALYSIS_INVALID';
  return error;
}

function verifyAnalysisToken(token, { mappingImportDocumentId, mappingVersion, fingerprint, manifestFileCount, uploadedPaths, adminId }) {
  if (typeof token !== 'string' || !token.startsWith('aw-analysis.')) {
    const error = new Error('A successful Ashley Wilde filename analysis is required before staging files.');
    error.code = 'ASHLEY_WILDE_ANALYSIS_REQUIRED';
    throw error;
  }
  const [, encoded, suppliedSignature] = token.split('.');
  if (!encoded || !suppliedSignature) throw invalidAnalysisError();
  const expectedSignature = signAnalysisPayload(encoded);
  const expected = Buffer.from(expectedSignature, 'utf8');
  const supplied = Buffer.from(suppliedSignature, 'utf8');
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) throw invalidAnalysisError();
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { throw invalidAnalysisError(); }
  const expectedPaths = new Set(Array.isArray(payload.analyzedPaths) ? payload.analyzedPaths : []);
  const requestedPaths = (uploadedPaths || []).map(normalizeRelativePath);
  if (payload.version !== 1 || payload.expiresAt < Date.now() || payload.adminId !== String(adminId || '')
    || payload.mappingImportDocumentId !== (mappingImportDocumentId || null)
    || payload.mappingVersion !== (mappingVersion || null)
    || payload.manifestFingerprint !== fingerprint
    || payload.manifestFileCount !== manifestFileCount
    || payload.analyzedFileCount !== expectedPaths.size
    || requestedPaths.some((relativePath) => !expectedPaths.has(relativePath))) throw invalidAnalysisError();
  return payload;
}

function normalizeManifest(input) {
  if (!Array.isArray(input) || input.length === 0) throw new Error('Folder manifest must contain at least one file');
  return input.map((entry, index) => {
    const relativePath = normalizeRelativePath(entry?.relativePath);
    const sha256 = String(entry?.sha256 || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Manifest item ${index + 1} has an invalid SHA-256`);
    const size = Number(entry?.size);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Manifest item ${index + 1} has an invalid size`);
    const mimeType = String(entry?.mimeType || '').toLowerCase();
    return { relativePath, sha256, size, ...(mimeType ? { mimeType } : {}) };
  });
}

function manifestFingerprint(manifest) {
  return crypto.createHash('sha256').update(canonicalManifestLines(manifest).join('\n'), 'utf8').digest('hex');
}

function logicalRows(rows) {
  const byDocument = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = row.documentId || row.id;
    const current = byDocument.get(key);
    if (!current || (current.publishedAt && !row.publishedAt)) byDocument.set(key, row);
  }
  return [...byDocument.values()];
}

function normalizedFabricName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function brandIsAshleyWilde(fabric) {
  const brands = Array.isArray(fabric?.brand) ? fabric.brand : [fabric?.brand];
  return brands.some((brand) => normalizedFabricName(brand?.name) === normalizedFabricName(SUPPLIER));
}

async function fabricCandidatesByName(strapi, name) {
  const rows = await strapi.entityService.findMany(FABRIC_UID, { filters: { name: { $eqi: name } }, populate: ['brand'], limit: 100 });
  return logicalRows(rows.filter((fabric) => normalizedFabricName(fabric.name) === normalizedFabricName(name) && brandIsAshleyWilde(fabric)));
}

async function resolveAshleyFabric(strapi, parsed) {
  if (!COLOUR_STATUSES.has(parsed.status)) return { parsed, fabric: null };
  if (parsed.fabricDocumentId) {
    const exact = await strapi.entityService.findMany(FABRIC_UID, { filters: { documentId: parsed.fabricDocumentId }, populate: ['brand'], limit: 2 });
    const branded = logicalRows((exact || []).filter(brandIsAshleyWilde));
    if (branded.length === 1) {
      const fabric = branded[0];
      return { parsed: { ...parsed, status: 'mapped', fabricName: fabric.name, fabricDocumentId: fabric.documentId, resolvedFabricDocumentId: fabric.documentId }, fabric };
    }
    if (!branded.length) return { parsed: { ...parsed, status: 'fabric_not_found_in_current_catalog', warning: `The mapped Fabric ${parsed.fabricDocumentId} does not exist in the current Ashley Wilde catalog.` }, fabric: null };
    return { parsed: { ...parsed, status: 'ambiguous_catalog_fabric', warning: `The mapped Fabric ${parsed.fabricDocumentId} resolved to multiple catalogue records.` }, fabric: null };
  }
  const names = [parsed.fabricName, ...(parsed.approvedAliases || [])].filter(Boolean);
  let candidates = [];
  for (const name of names) {
    candidates = await fabricCandidatesByName(strapi, name);
    if (candidates.length) break;
  }
  if (!candidates.length) return { parsed: { ...parsed, status: 'fabric_not_found_in_current_catalog', warning: `No Ashley Wilde fabric named ${parsed.fabricName} exists in the current catalog.` }, fabric: null };
  if (candidates.length !== 1) return { parsed: { ...parsed, status: 'ambiguous_catalog_fabric', warning: `Multiple Ashley Wilde fabrics match ${parsed.fabricName}; resolution was refused.` }, fabric: null };
  const fabric = candidates[0];
  return { parsed: { ...parsed, status: 'mapped', fabricName: fabric.name, fabricDocumentId: fabric.documentId, resolvedFabricDocumentId: fabric.documentId }, fabric };
}

function identityKey(parsed) {
  return [normalizeToken(SUPPLIER), String(parsed.fabricDocumentId || '').normalize('NFKC').trim(), normalizeToken(parsed.supplierProductCode), normalizeToken(parsed.supplierColourCode)].join('|');
}

function assetKey(parsed, sha256) {
  return `${identityKey(parsed)}|${String(sha256 || '').toLowerCase()}`;
}

function mediaBindingFor({ analysisToken, folderFingerprint, relativePath, fileFingerprint }) {
  const signature = String(analysisToken || '').split('.').pop();
  return `aw-ashley:${signature}:${folderFingerprint}:${relativePath}:${fileFingerprint}`;
}

function blockedAssetKey(relativePath, sha256) {
  return `${normalizeToken(SUPPLIER)}|blocked|${normalizeRelativePath(relativePath)}|${String(sha256).toLowerCase()}`;
}

function normalizedAssetFilename(filename) {
  return normalizeStem(path.basename(String(filename || ''))).toLocaleLowerCase();
}

function conflictGroupFor(parsed, filename) {
  return `aw-conflict-${crypto.createHash('sha256').update(`${identityKey(parsed)}|${normalizedAssetFilename(filename)}`, 'utf8').digest('hex').slice(0, 24)}`;
}

async function findStagedIdentity(strapi, parsed, populate = []) {
  const rows = await strapi.entityService.findMany(IDENTITY_UID, { filters: { identityKey: { $eq: identityKey(parsed) } }, populate, limit: 20 });
  return logicalRows(rows)[0] || null;
}

async function findStagedAsset(strapi, parsed, sha256, populate = []) {
  const rows = await strapi.entityService.findMany(ASSET_UID, { filters: { assetKey: { $eq: assetKey(parsed, sha256) } }, populate, limit: 20 });
  return logicalRows(rows)[0] || null;
}

async function findIdentityFilenameAssets(strapi, identity, filename) {
  const rows = await strapi.entityService.findMany(ASSET_UID, { filters: { normalizedFilename: normalizedAssetFilename(filename) }, populate: ['fabricColourIdentity'], limit: 100 });
  const id = String(identity.documentId || identity.id);
  return rows.filter((row) => String(row.fabricColourIdentity?.documentId || row.fabricColourIdentity?.id || row.fabricColourIdentity) === id);
}

async function findMedia(strapi, filename, sha256, size) {
  const marker = `aw-sha256:${sha256}`;
  const byHash = await strapi.entityService.findMany(FILE_UID, { filters: { caption: marker }, limit: 2 });
  if (byHash?.length) return { media: byHash[0], exact: true };
  const rows = await strapi.entityService.findMany(FILE_UID, { filters: { name: filename }, sort: ['createdAt:desc'], limit: 5 });
  const publicRoot = path.resolve(strapi.dirs?.static?.public || path.join(process.cwd(), 'public'));
  for (const file of rows || []) {
    if (file.provider !== 'local' || !file.url || Math.abs(Number(file.size || 0) * 1024 - size) >= 2048) continue;
    const localPath = path.resolve(publicRoot, String(file.url).replace(/^[/\\]+/, ''));
    if (localPath !== publicRoot && !localPath.startsWith(`${publicRoot}${path.sep}`)) continue;
    try {
      if (crypto.createHash('sha256').update(await fs.promises.readFile(localPath)).digest('hex') === sha256) return { media: file, exact: true };
    } catch { /* unavailable legacy media is not assumed identical */ }
  }
  return { media: null, exact: false };
}

async function inspectMatch(strapi, parsed, manifestEntry) {
  if (!COLOUR_STATUSES.has(parsed.status)) return parsed;
  const resolution = await resolveAshleyFabric(strapi, parsed);
  if (!resolution.fabric) return resolution.parsed;
  parsed = resolution.parsed;
  const identity = await findStagedIdentity(strapi, parsed, ['assets']);
  if (identity?.officialColourName && parsed.supplierColourName && normalizeToken(identity.officialColourName) !== normalizeToken(parsed.supplierColourName)) {
    return { ...parsed, status: 'identity_conflict', warning: 'A staged identity already exists with a different approved official colour name.' };
  }
  const stagedAsset = await findStagedAsset(strapi, parsed, manifestEntry.sha256);
  if (stagedAsset) return { ...parsed, status: 'already_staged', identityDocumentId: identity?.documentId, assetDocumentId: stagedAsset.documentId, duplicateStatus: stagedAsset.duplicateStatus };
  if (!identity) return { ...parsed, status: 'would_stage_identity' };
  const sameLogical = await findIdentityFilenameAssets(strapi, identity, manifestEntry.relativePath);
  if (sameLogical.some((item) => String(item.sha256).toLowerCase() !== manifestEntry.sha256)) return { ...parsed, status: 'conflicting_image', conflictGroup: conflictGroupFor(parsed, manifestEntry.relativePath), warning: 'The same logical asset name already exists with a different SHA-256.' };
  return { ...parsed, status: 'would_stage_asset', identityDocumentId: identity.documentId };
}

function summaryForRows(rows) {
  const unresolved = new Set(['unknown_mapping_product', 'fabric_not_found_in_current_catalog', 'ambiguous_catalog_fabric', 'ambiguous_filename', 'identity_conflict', 'conflicting_image']);
  const blocked = new Set(['unsupported_file', 'classified_asset', 'duplicate_in_folder', 'exact_duplicate']);
  const ready = new Set(['matched', 'mapped', 'pending_manual_mapping', 'would_stage_identity', 'would_stage_asset', 'already_staged', 'staged']);
  return {
    totalFiles: rows.length,
    matchedFiles: rows.filter((row) => ready.has(row.status)).length,
    readyFiles: rows.filter((row) => ready.has(row.status)).length,
    alreadyCompleteFiles: rows.filter((row) => row.status === 'already_staged').length,
    skippedFiles: rows.filter((row) => blocked.has(row.status)).length,
    unresolvedFiles: rows.filter((row) => unresolved.has(row.status)).length,
    conflictFiles: rows.filter((row) => row.status === 'identity_conflict' || row.status === 'conflicting_image').length,
  };
}

async function upsertHistory(strapi, data, existingOverride) {
  const existing = existingOverride === undefined
    ? await strapi.entityService.findMany(BATCH_UID, { filters: { folderFingerprint: data.folderFingerprint }, limit: 1 })
    : existingOverride;
  const previous = existing?.[0];
  const priorSummary = previous?.manifestSummary || {};
  const manifestSummary = { ...priorSummary, ...data.manifestSummary, attemptCount: Number(priorSummary.attemptCount || 0) + (data.incrementAttempt ? 1 : 0), lastAttemptAt: new Date().toISOString() };
  const payload = { ...data, manifestSummary };
  delete payload.incrementAttempt;
  return previous ? strapi.entityService.update(BATCH_UID, previous.id, { data: payload }) : strapi.entityService.create(BATCH_UID, { data: payload });
}

async function loadAshleyImporterMappings(strapi, options = {}) {
  if (options.mappings) return { ...loadProductionMappings(options.mappings), source: 'repository-fallback' };
  const active = await supplierMappings.getActiveImporterMappings(strapi, SUPPLIER);
  if (active) {
    return {
      mode: 'strapi-active',
      source: active.source,
      colourMap: active.colourMap,
      mappingVersion: active.version.version,
      mappingImportDocumentId: active.version.documentId,
      mappingRowCount: active.rows.length,
      codeRegistry: null,
      imageIndex: null,
    };
  }
  return { ...loadProductionMappings(), source: 'repository-fallback', mappingVersion: null, mappingImportDocumentId: null };
}

async function analyseFolder(strapi, body, options = {}) {
  const mappings = await loadAshleyImporterMappings(strapi);
  const manifest = normalizeManifest(body?.manifest);
  const completeManifest = body?.queueBatch ? normalizeManifest(body?.folderManifest) : manifest;
  const fingerprint = manifestFingerprint(completeManifest);
  if (body?.folderFingerprint && body.folderFingerprint !== fingerprint) throw new Error('Folder fingerprint does not match the manifest');
  const folderName = String(body?.folderName || '').normalize('NFKC').trim().slice(0, 255);
  if (!folderName || /[\\/]/.test(folderName)) throw new Error('Folder name is invalid');

  const seenHashes = new Set();
  const rows = [];
  for (const entry of manifest) {
    const filename = path.basename(entry.relativePath);
    let parsed = parseFilename(filename, mappings.colourMap);
    if (seenHashes.has(entry.sha256) && COLOUR_STATUSES.has(parsed.status)) parsed = { ...parsed, status: 'exact_duplicate', duplicateStatus: 'exact_duplicate', warning: 'Identical content appears more than once in this folder.' };
    else parsed = await inspectMatch(strapi, parsed, entry);
    seenHashes.add(entry.sha256);
    rows.push({ ...entry, ...parsed });
  }
  const summary = summaryForRows(rows);
  if (body?.queueBatch) return {
    supplier: SUPPLIER,
    folderName,
    folderFingerprint: fingerprint,
    mappingSchemaVersion: mappings.colourMap.schemaVersion,
    mappingGeneratedAt: mappings.colourMap.generatedAt,
    mappingMode: mappings.mode,
    mappingSource: mappings.source,
    mappingVersion: mappings.mappingVersion || null,
    mappingVersionDocumentId: mappings.mappingImportDocumentId || null,
    mappingRowCount: mappings.mappingRowCount || null,
    analysisToken: createAnalysisToken({
      mappingImportDocumentId: mappings.mappingImportDocumentId,
      mappingVersion: mappings.mappingVersion,
      manifestFingerprint: fingerprint,
      manifestFileCount: completeManifest.length,
      analyzedPaths: manifest.map((item) => item.relativePath),
      analyzedFiles: rows,
      adminId: options.adminId,
    }),
    rows,
    summary,
  };
  const previousRows = await strapi.entityService.findMany(BATCH_UID, { filters: { folderFingerprint: fingerprint }, limit: 1 });
  const previous = previousRows?.[0];
  const noRemainingWork = summary.readyFiles === 0;
  const analysisStatus = noRemainingWork ? ((summary.conflictFiles || summary.unresolvedFiles || summary.skippedFiles) ? 'completed_with_skips' : 'completed') : 'ready';
  const history = await upsertHistory(strapi, { supplier: SUPPLIER, folderName, folderFingerprint: fingerprint, status: analysisStatus, totalFiles: summary.totalFiles, matchedFiles: summary.matchedFiles, uploadedFiles: Number(previous?.uploadedFiles || 0), alreadyCompleteFiles: summary.alreadyCompleteFiles, skippedFiles: summary.skippedFiles + summary.unresolvedFiles, conflictFiles: summary.conflictFiles, failedFiles: Number(previous?.failedFiles || 0), firstUploadedAt: previous?.firstUploadedAt || null, lastUploadedAt: previous?.lastUploadedAt || null, completedAt: noRemainingWork ? (previous?.completedAt || new Date().toISOString()) : null, mappingSchemaVersion: mappings.colourMap.schemaVersion, manifestSummary: { summary, paths: manifest.map((item) => item.relativePath), fingerprint }, incrementAttempt: true });
  return { supplier: SUPPLIER, mappingMode: mappings.mode, mappingSource: mappings.source, mappingVersion: mappings.mappingVersion || null, mappingSchemaVersion: mappings.colourMap.schemaVersion, mappingGeneratedAt: mappings.colourMap.generatedAt, folderName, folderFingerprint: fingerprint, rows, summary, history };
}

async function uploadMedia(strapi, descriptor, sha256) {
  const ext = path.extname(descriptor.name).toLowerCase() || '.jpg';
  const temporary = path.join(os.tmpdir(), `aw_${crypto.randomUUID()}${ext}`);
  await fs.promises.writeFile(temporary, descriptor.buffer);
  try {
    const result = await strapi.plugins.upload.services.upload.upload({ data: { fileInfo: { name: descriptor.name, alternativeText: descriptor.name, caption: `aw-sha256:${sha256}` } }, files: { filepath: temporary, path: temporary, originalFilename: descriptor.name, mimetype: descriptor.mimeType, type: descriptor.mimeType, size: descriptor.buffer.length } });
    return Array.isArray(result) ? result[0] : result;
  } finally { await fs.promises.unlink(temporary).catch(() => undefined); }
}

function evidenceFor(parsed) {
  if (!parsed.supplierColourName || !parsed.internalColourCode) return { mappingStatus: 'pending', evidenceStatus: 'pending_manual' };
  const source = String(parsed.mappingSource || 'approved Ashley Wilde mapping');
  return { mappingStatus: 'verified', evidenceStatus: /official supplier|official ashley wilde/i.test(source) ? 'verified_official' : 'verified_manual', source };
}

async function ensureStagedIdentity(strapi, parsed, fabric) {
  const existing = await findStagedIdentity(strapi, parsed, ['assets', 'fabric']);
  const evidence = evidenceFor(parsed);
  if (existing) {
    if (existing.officialColourName && parsed.supplierColourName && normalizeCanonicalColourName(existing.officialColourName) !== normalizeCanonicalColourName(parsed.supplierColourName)) return { identity: existing, conflict: true };
    if (existing.mappingStatus === 'verified' && evidence.mappingStatus !== 'verified') return { identity: existing, conflict: false };
    if (existing.mappingStatus === 'verified' && parsed.internalColourCode && normalizeToken(existing.internalColourCode) !== normalizeToken(parsed.internalColourCode) && normalizeCanonicalColourName(existing.officialColourName) !== normalizeCanonicalColourName(parsed.supplierColourName)) return { identity: existing, conflict: true };
    if (evidence.mappingStatus === 'verified' && existing.mappingStatus === 'verified' && existing.mappingVersion !== (parsed.mappingVersion || null)) {
      const updated = await strapi.entityService.update(IDENTITY_UID, existing.id, { data: { displayName: `${fabric.name} - ${parsed.supplierColourName}`, officialColourName: parsed.supplierColourName, internalColourCode: parsed.internalColourCode, mappingStatus: 'verified', evidenceStatus: evidence.evidenceStatus, source: evidence.source, mappingVersion: parsed.mappingVersion || null } });
      return { identity: updated, conflict: false };
    }
    if (evidence.mappingStatus === 'verified') {
      const updated = await strapi.entityService.update(IDENTITY_UID, existing.id, { data: { displayName: `${fabric.name} — ${parsed.supplierColourName}`, officialColourName: parsed.supplierColourName, internalColourCode: parsed.internalColourCode, mappingStatus: 'verified', evidenceStatus: evidence.evidenceStatus, source: evidence.source, mappingVersion: parsed.mappingVersion || null } });
      return { identity: updated, conflict: false };
    }
    return { identity: existing, conflict: false };
  }
  const data = { displayName: `${fabric.name} — ${parsed.supplierColourName || `Colour ${parsed.supplierColourCode}`}`, identityKey: identityKey(parsed), supplier: SUPPLIER, fabric: fabric.documentId, fabricDocumentId: fabric.documentId, supplierProductCode: parsed.supplierProductCode, supplierColourCode: parsed.supplierColourCode, fabricColourCode: `${parsed.supplierProductCode}${parsed.supplierColourCode}`, officialColourName: parsed.supplierColourName || null, internalColourCode: parsed.internalColourCode || null, mappingStatus: evidence.mappingStatus, evidenceStatus: evidence.evidenceStatus, source: evidence.source || null, mappingVersion: parsed.mappingVersion || null };
  try { return { identity: await strapi.entityService.create(IDENTITY_UID, { data }), conflict: false }; }
  catch (error) {
    const raced = await findStagedIdentity(strapi, parsed, ['assets', 'fabric']);
    if (raced) return { identity: raced, conflict: Boolean(raced.officialColourName && parsed.supplierColourName && normalizeCanonicalColourName(raced.officialColourName) !== normalizeCanonicalColourName(parsed.supplierColourName)) };
    throw error;
  }
}

async function createBlockedAsset(strapi, descriptor, metadata, parsed, batchContext) {
  const key = blockedAssetKey(metadata.relativePath || descriptor.name, metadata.sha256);
  const existing = await strapi.entityService.findMany(ASSET_UID, { filters: { assetKey: key }, limit: 1 });
  if (existing?.[0]) return { filename: descriptor.name, status: existing[0].duplicateStatus === 'exact_duplicate' ? 'exact_duplicate' : 'blocked', skipped: true, uploaded: false, assetDocumentId: existing[0].documentId };
  const asset = await strapi.entityService.create(ASSET_UID, { data: { name: descriptor.name, assetKey: key, originalFilename: descriptor.name, normalizedFilename: normalizedAssetFilename(descriptor.name), relativePath: metadata.relativePath || descriptor.name, sha256: metadata.sha256, fileSize: metadata.size, mimeType: descriptor.mimeType, assetType: parsed.assetType || 'unknown', duplicateStatus: 'unique', importStatus: 'blocked', notes: parsed.warning || 'Classified as non-colour or unresolved filename.', batchMetadata: { folderName: batchContext.folderName || null, folderFingerprint: batchContext.folderFingerprint || null }, referenceMetadata: { supplier: SUPPLIER } } });
  return { filename: descriptor.name, status: parsed.status, assetType: parsed.assetType || 'unknown', skipped: true, uploaded: false, assetDocumentId: asset.documentId, warning: parsed.warning };
}

async function stageMediaAsset(strapi, descriptor, metadata, mappings, batchContext = {}, media, mediaWasReused = false) {
  const parsed = parseFilename(descriptor.name, mappings.colourMap);
  if (!COLOUR_STATUSES.has(parsed.status)) return createBlockedAsset(strapi, descriptor, metadata, parsed, batchContext);
  const inspected = await inspectMatch(strapi, parsed, metadata);
  if (['identity_conflict', 'fabric_not_found_in_current_catalog', 'ambiguous_catalog_fabric', 'conflicting_image'].includes(inspected.status)) return { filename: descriptor.name, ...inspected, uploaded: false, failed: true };
  if (inspected.status === 'exact_duplicate' || inspected.status === 'already_staged') return { filename: descriptor.name, ...inspected, uploaded: false, linked: false, skipped: true };
  const resolution = await resolveAshleyFabric(strapi, parsed);
  if (!resolution.fabric) return { filename: descriptor.name, ...resolution.parsed, uploaded: false, failed: true };
  const resolvedParsed = resolution.parsed;
  const staged = await ensureStagedIdentity(strapi, resolvedParsed, resolution.fabric);
  if (staged.conflict) return { filename: descriptor.name, ...resolvedParsed, status: 'identity_conflict', uploaded: false, failed: true, warning: 'A staged identity already exists with conflicting approved mapping data.' };
  const identity = staged.identity;
  const existingSameKey = await findStagedAsset(strapi, resolvedParsed, metadata.sha256);
  if (existingSameKey) return { filename: descriptor.name, status: 'already_staged', uploaded: false, linked: false, skipped: true, identityDocumentId: identity.documentId, assetDocumentId: existingSameKey.documentId };
  const sameLogical = await findIdentityFilenameAssets(strapi, identity, descriptor.name);
  const conflicting = sameLogical.find((item) => String(item.sha256).toLowerCase() !== metadata.sha256);
  if (conflicting) {
    const group = conflictGroupFor(resolvedParsed, descriptor.name);
    for (const prior of sameLogical) await strapi.entityService.update(ASSET_UID, prior.id, { data: { duplicateStatus: 'conflicting_image', conflictGroup: group, importStatus: 'blocked' } });
    const conflictAsset = await strapi.entityService.create(ASSET_UID, { data: { name: descriptor.name, assetKey: assetKey(resolvedParsed, metadata.sha256), originalFilename: descriptor.name, normalizedFilename: normalizedAssetFilename(descriptor.name), relativePath: metadata.relativePath || descriptor.name, sha256: metadata.sha256, fileSize: metadata.size, mimeType: descriptor.mimeType, assetType: resolvedParsed.assetType || 'ordinary_colour', duplicateStatus: 'conflicting_image', conflictGroup: group, importStatus: 'blocked', fabricColourIdentity: identity.documentId, notes: 'Conflicting image hash; media upload and promotion are blocked.', batchMetadata: { folderName: batchContext.folderName || null, folderFingerprint: batchContext.folderFingerprint || null }, referenceMetadata: { supplier: SUPPLIER } } });
    return { filename: descriptor.name, ...resolvedParsed, status: 'conflicting_image', uploaded: false, failed: true, assetDocumentId: conflictAsset.documentId, conflictGroup: group };
  }
  const asset = await strapi.entityService.create(ASSET_UID, { data: { name: descriptor.name, assetKey: assetKey(resolvedParsed, metadata.sha256), originalFilename: descriptor.name, normalizedFilename: normalizedAssetFilename(descriptor.name), relativePath: metadata.relativePath || descriptor.name, sha256: metadata.sha256, fileSize: metadata.size, mimeType: descriptor.mimeType, assetType: resolvedParsed.assetType || 'ordinary_colour', fabricColourIdentity: identity.documentId, ...(mediaWasReused ? { existingMedia: media.id, duplicateStatus: 'exact_duplicate' } : { media: media.id, duplicateStatus: 'unique' }), importStatus: 'staged', batchMetadata: { folderName: batchContext.folderName || null, folderFingerprint: batchContext.folderFingerprint || null }, referenceMetadata: { supplier: SUPPLIER, supplierProductCode: resolvedParsed.supplierProductCode, supplierColourCode: resolvedParsed.supplierColourCode } } });
  return { filename: descriptor.name, status: 'staged', uploaded: !mediaWasReused, linked: true, skipped: false, mediaId: media.id, mediaDocumentId: media.documentId || null, identityDocumentId: identity.documentId, assetDocumentId: asset.documentId, ...resolvedParsed };
}

async function processFile(strapi, descriptor, metadata, mappings, batchContext = {}) {
  const actualHash = crypto.createHash('sha256').update(descriptor.buffer).digest('hex');
  if (actualHash !== metadata.sha256) return { filename: descriptor.name, status: 'failed', uploaded: false, failed: true, warning: 'Server SHA-256 verification failed.' };
  const mediaState = await findMedia(strapi, descriptor.name, metadata.sha256, metadata.size);
  const media = mediaState.media || await uploadMedia(strapi, descriptor, metadata.sha256);
  return stageMediaAsset(strapi, descriptor, metadata, mappings, batchContext, media, Boolean(mediaState.media));
}

const ACCEPTED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function finalisationError(message, code = 'ASHLEY_WILDE_FINALISATION_RETRYABLE', status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function findMediaByIdentity(strapi, mediaId, mediaDocumentId) {
  if (!mediaId && !mediaDocumentId) throw finalisationError('A Media record is required to finalise this image.', 'ASHLEY_WILDE_MEDIA_INVALID', 400);
  const filters = mediaDocumentId ? { documentId: mediaDocumentId } : { id: mediaId };
  const rows = await strapi.entityService.findMany(FILE_UID, { filters, populate: ['createdBy'], limit: 2 });
  const media = rows?.[0] || null;
  if (!media || (mediaId !== undefined && mediaId !== null && String(media.id) !== String(mediaId))
    || (mediaDocumentId && String(media.documentId || '') !== String(mediaDocumentId))) {
    throw finalisationError('The uploaded Media record does not match the requested image.', 'ASHLEY_WILDE_MEDIA_INVALID', 400);
  }
  return media;
}

function mediaSizeBytes(media) {
  const size = Number(media?.size || 0);
  // Strapi's upload file schema stores `size` in KiB, including for large files.
  return size * 1024;
}

function mediaCreatedBy(media) {
  return media?.createdBy?.documentId || media?.createdBy?.id || media?.createdBy;
}

async function validateAshleyMedia(strapi, body, analysedFile, adminId) {
  const media = await findMediaByIdentity(strapi, body.mediaId, body.mediaDocumentId);
  const mimeType = String(media.mime || media.mimeType || media.type || '').toLowerCase();
  const expectedMimeType = String(analysedFile.mimeType || body.mimeType || '').toLowerCase();
  const expectedFilename = analysedFile.filename;
  const mediaFilename = media.name || media.alternativeText || '';
  const expectedSize = Number(analysedFile.size);
  if (!ACCEPTED_MEDIA_TYPES.has(mimeType) || (expectedMimeType && mimeType !== expectedMimeType)
    || Math.abs(mediaSizeBytes(media) - expectedSize) >= 4096
    || normalizedAssetFilename(mediaFilename) !== normalizedAssetFilename(expectedFilename)
    || String(media.caption || '') !== mediaBindingFor({ analysisToken: body.analysisToken, folderFingerprint: body.folderFingerprint, relativePath: analysedFile.relativePath, fileFingerprint: analysedFile.sha256 })) {
    throw finalisationError('The uploaded Media record failed Ashley Wilde identity, size, type, or binding validation.', 'ASHLEY_WILDE_MEDIA_INVALID', 400);
  }
  const createdBy = mediaCreatedBy(media);
  if (createdBy && String(createdBy) !== String(adminId)) {
    throw finalisationError('The uploaded Media record was not created by the authenticated administrator.', 'ASHLEY_WILDE_MEDIA_INVALID', 403);
  }
  return media;
}

async function findUnfinalisedAshleyMedia(strapi, body, analysedFile, adminId) {
  const binding = mediaBindingFor({
    analysisToken: body.analysisToken,
    folderFingerprint: body.folderFingerprint,
    relativePath: analysedFile.relativePath,
    fileFingerprint: analysedFile.sha256,
  });
  const rows = await strapi.entityService.findMany(FILE_UID, { filters: { caption: { $eq: binding } }, populate: ['createdBy'], limit: 3 });
  if (!rows?.length) return null;
  if (rows.length > 1) throw finalisationError('More than one uploaded Media record matches this analysed image.', 'ASHLEY_WILDE_MEDIA_INVALID', 409);
  const candidate = rows[0];
  return validateAshleyMedia(strapi, {
    ...body,
    mediaId: candidate.id,
    mediaDocumentId: candidate.documentId || null,
  }, analysedFile, adminId);
}

async function persistFilePhase(strapi, mappings, body, phase, details = {}) {
  const rows = await strapi.entityService.findMany(BATCH_UID, { filters: { folderFingerprint: body.folderFingerprint }, limit: 1 });
  const previous = rows?.[0] || {};
  const oldSummary = previous.manifestSummary || {};
  const relativePath = normalizeRelativePath(body.relativePath);
  const resultsByPath = { ...(oldSummary.resultsByPath || {}), [relativePath]: { ...(oldSummary.resultsByPath?.[relativePath] || {}), relativePath, phase, ...details, updatedAt: new Date().toISOString() } };
  const persisted = Object.values(resultsByPath);
  const totalFiles = Number(previous.totalFiles || body.manifestFileCount || 0);
  const completeFiles = persisted.filter((item) => item.phase === 'complete').length;
  const failedFiles = persisted.filter((item) => String(item.phase || '').startsWith('retryable_') || item.failed).length;
  const initialReadyFiles = Number(oldSummary.summary?.readyFiles ?? oldSummary.readyFiles ?? (totalFiles - Number(previous.skippedFiles || 0) - Number(previous.conflictFiles || 0)));
  const readyFiles = Math.max(0, initialReadyFiles - completeFiles);
  const status = phase === 'complete' && completeFiles >= totalFiles ? 'completed'
    : failedFiles ? 'partial' : 'uploading';
  return upsertHistory(strapi, {
    supplier: SUPPLIER,
    folderName: String(body.folderName || previous.folderName || '').slice(0, 255),
    folderFingerprint: body.folderFingerprint,
    status,
    totalFiles,
    matchedFiles: Number(previous.matchedFiles || 0),
    uploadedFiles: completeFiles,
    alreadyCompleteFiles: persisted.filter((item) => item.status === 'already_staged').length,
    skippedFiles: Number(previous.skippedFiles || 0),
    conflictFiles: persisted.filter((item) => item.phase === 'conflict' || item.status === 'conflicting_image').length,
    failedFiles,
    firstUploadedAt: previous.firstUploadedAt || (completeFiles ? new Date().toISOString() : null),
    lastUploadedAt: completeFiles ? new Date().toISOString() : previous.lastUploadedAt || null,
    completedAt: status === 'completed' ? (previous.completedAt || new Date().toISOString()) : null,
    mappingSchemaVersion: mappings.colourMap.schemaVersion,
    manifestSummary: {
      ...oldSummary,
      phase,
      currentFilename: relativePath,
      currentPhase: phase,
      readyFiles,
      activeMappingVersion: mappings.mappingVersion || null,
      activeMappingVersionDocumentId: mappings.mappingImportDocumentId || null,
      resultsByPath,
      folderFingerprint: body.folderFingerprint,
    },
    incrementAttempt: false,
  }, rows);
}

function analysedFileFor(tokenPayload, relativePath) {
  return (tokenPayload.analyzedFiles || []).find((item) => normalizeRelativePath(item.relativePath) === normalizeRelativePath(relativePath));
}

function validateAshleyAnalysisRequest(body, mappings, adminId) {
  const relativePath = normalizeRelativePath(body?.relativePath);
  const filename = path.basename(relativePath);
  const manifestFileCount = Number(body?.manifestFileCount);
  const tokenPayload = verifyAnalysisToken(body?.analysisToken, {
    mappingImportDocumentId: mappings.mappingImportDocumentId,
    mappingVersion: mappings.mappingVersion,
    fingerprint: body?.folderFingerprint,
    manifestFileCount,
    uploadedPaths: [relativePath],
    adminId,
  });
  const analysedFile = analysedFileFor(tokenPayload, relativePath);
  if (!analysedFile || analysedFile.filename !== filename || !analysedFile.mimeType || !COLOUR_STATUSES.has(analysedFile.status)) {
    throw finalisationError('The requested image was not part of the successful Ashley Wilde analysis.', 'ASHLEY_WILDE_ANALYSIS_INVALID', 400);
  }
  if (String(body.originalFilename || '') !== analysedFile.filename
    || String(body.fileFingerprint || '').toLowerCase() !== analysedFile.sha256
    || Number(body.fileSize) !== Number(analysedFile.size)
    || String(body.mimeType || '').toLowerCase() !== analysedFile.mimeType) {
    throw finalisationError('The finalisation payload does not match the signed Ashley Wilde analysis.', 'ASHLEY_WILDE_ANALYSIS_INVALID', 400);
  }
  for (const field of ['supplierProductCode', 'supplierColourCode', 'supplierColourName', 'internalColourCode', 'fabricDocumentId']) {
    if (body[field] !== undefined && String(body[field] || '') !== String(analysedFile[field] || '')) {
      throw finalisationError('The finalisation identity does not match the signed Ashley Wilde analysis.', 'ASHLEY_WILDE_ANALYSIS_INVALID', 400);
    }
  }
  if (body.mappingVersionDocumentId !== undefined
    && String(body.mappingVersionDocumentId || '') !== String(mappings.mappingImportDocumentId || '')) {
    throw finalisationError('The active Ashley Wilde mapping version does not match the signed analysis.', 'ASHLEY_WILDE_ANALYSIS_INVALID', 400);
  }
  return { relativePath, filename, manifestFileCount, tokenPayload, analysedFile };
}

async function getAshleyWildeMediaStatus(strapi, body, options = {}) {
  const mappings = await timedStage(strapi, 'mapping-load-media-status', () => loadAshleyImporterMappings(strapi), { relativePath: body?.relativePath || null });
  const { relativePath, filename, analysedFile } = validateAshleyAnalysisRequest(body, mappings, options.adminId);
  const media = await findUnfinalisedAshleyMedia(strapi, body, analysedFile, options.adminId);
  if (!media) return { result: { filename, relativePath, phase: 'media_not_found' }, history: null };
  const result = { filename, relativePath, phase: 'media_uploaded', mediaId: media.id, mediaDocumentId: media.documentId || null };
  const history = await persistFilePhase(strapi, mappings, body, 'media_uploaded', result);
  return { result, history };
}

async function recordAshleyWildeProgress(strapi, body, options = {}) {
  const mappings = await timedStage(strapi, 'mapping-load-progress', () => loadAshleyImporterMappings(strapi), { relativePath: body?.relativePath || null });
  const { filename, relativePath } = validateAshleyAnalysisRequest(body, mappings, options.adminId);
  if (body?.phase !== 'retryable_upload_failure') {
    throw finalisationError('Only retryable Ashley Wilde upload failures may be recorded as progress.', 'ASHLEY_WILDE_PROGRESS_INVALID', 400);
  }
  const result = {
    filename,
    relativePath,
    phase: 'retryable_upload_failure',
    errorCode: String(body.errorCode || 'unknown'),
  };
  const history = await persistFilePhase(strapi, mappings, body, result.phase, result);
  return { result, history };
}

async function finaliseAshleyWildeMedia(strapi, body, options = {}) {
  const mappings = await timedStage(strapi, 'mapping-load-finalise', () => loadAshleyImporterMappings(strapi), { relativePath: body?.relativePath || null });
  const relativePath = normalizeRelativePath(body?.relativePath);
  const filename = path.basename(relativePath);
  const manifestFileCount = Number(body?.manifestFileCount);
  const tokenPayload = verifyAnalysisToken(body?.analysisToken, {
    mappingImportDocumentId: mappings.mappingImportDocumentId,
    mappingVersion: mappings.mappingVersion,
    fingerprint: body?.folderFingerprint,
    manifestFileCount,
    uploadedPaths: [relativePath],
    adminId: options.adminId,
  });
  const analysedFile = analysedFileFor(tokenPayload, relativePath);
  if (!analysedFile || analysedFile.filename !== filename || !analysedFile.mimeType || !COLOUR_STATUSES.has(analysedFile.status)) throw finalisationError('The requested image was not part of the successful Ashley Wilde analysis.', 'ASHLEY_WILDE_ANALYSIS_INVALID', 400);
  if (String(body.originalFilename || '') !== analysedFile.filename
    || String(body.fileFingerprint || '').toLowerCase() !== analysedFile.sha256
    || Number(body.fileSize) !== Number(analysedFile.size)
    || String(body.mimeType || '').toLowerCase() !== analysedFile.mimeType) {
    throw finalisationError('The finalisation payload does not match the signed Ashley Wilde analysis.', 'ASHLEY_WILDE_ANALYSIS_INVALID', 400);
  }
  for (const field of ['supplierProductCode', 'supplierColourCode', 'fabricDocumentId']) {
    if (body[field] !== undefined && String(body[field] || '') !== String(analysedFile[field] || '')) throw finalisationError('The finalisation identity does not match the signed Ashley Wilde analysis.', 'ASHLEY_WILDE_ANALYSIS_INVALID', 400);
  }
  if (body.mappingVersionDocumentId && String(body.mappingVersionDocumentId) !== String(mappings.mappingImportDocumentId || '')) {
    throw finalisationError('The active Ashley Wilde mapping version does not match the signed analysis.', 'ASHLEY_WILDE_ANALYSIS_INVALID', 400);
  }
  const media = await validateAshleyMedia(strapi, body, analysedFile, options.adminId);
  const metadata = { relativePath, sha256: analysedFile.sha256, size: analysedFile.size, mimeType: analysedFile.mimeType };
  const descriptor = { name: filename, relativePath, mimeType: analysedFile.mimeType, size: analysedFile.size };
  await persistFilePhase(strapi, mappings, body, 'media_uploaded', { mediaId: media.id, mediaDocumentId: media.documentId || null, filename, sha256: analysedFile.sha256, size: analysedFile.size, mimeType: analysedFile.mimeType });
  await persistFilePhase(strapi, mappings, body, 'finalising_staging', { mediaId: media.id, mediaDocumentId: media.documentId || null, filename });
  try {
    const result = await timedStage(strapi, 'staging-finalise', () => stageMediaAsset(strapi, descriptor, metadata, mappings, { folderName: body.folderName, folderFingerprint: body.folderFingerprint }, media), { relativePath, mediaId: media.id, bytes: analysedFile.size });
    const complete = { ...result, phase: 'complete', mediaId: media.id, mediaDocumentId: media.documentId || null, relativePath };
    const history = await persistFilePhase(strapi, mappings, body, 'complete', complete);
    return { result: complete, history };
  } catch (error) {
    await persistFilePhase(strapi, mappings, body, 'retryable_finalisation_failure', { mediaId: media.id, mediaDocumentId: media.documentId || null, filename, errorCode: error?.code || 'unknown' });
    if (error?.code === 'ASHLEY_WILDE_FINALISATION_RETRYABLE') throw error;
    throw finalisationError('The image was uploaded, but its staged fabric-colour link still needs to be completed.');
  }
}

async function processBatch(strapi, descriptors, body, options = {}) {
  const requestStartedAt = Date.now();
  const requestBytes = descriptors.reduce((sum, item) => sum + Number(item.size || item.buffer?.length || 0), 0);
  safeLog(strapi, 'staging-request-start', { batchFileCount: descriptors.length, requestBytes, targetBytes: uploadPolicy.normalBatchTargetBytes });
  const mappings = await timedStage(strapi, 'mapping-load', () => loadAshleyImporterMappings(strapi, options), { batchFileCount: descriptors.length });
  const manifestStartedAt = Date.now();
  const manifest = normalizeManifest(JSON.parse(body?.folderManifest || '[]'));
  const fingerprint = manifestFingerprint(manifest);
  if (fingerprint !== body?.folderFingerprint) throw new Error('Folder fingerprint does not match the manifest');
  const batchMetadata = JSON.parse(body?.fileMetadata || '[]');
  safeLog(strapi, 'manifest-validated', { batchFileCount: descriptors.length, manifestFileCount: manifest.length, durationMs: Date.now() - manifestStartedAt });
  safeLog(strapi, 'analysis-token-validation-start', {
    authenticatedAdminId: options.adminId || null,
    batchFileCount: descriptors.length,
    metadataPresent: batchMetadata.length > 0,
    analysisTokenPresent: Boolean(body?.analysisToken),
  });
  if (!options.mappings) verifyAnalysisToken(body?.analysisToken, {
    mappingImportDocumentId: mappings.mappingImportDocumentId,
    mappingVersion: mappings.mappingVersion,
    fingerprint,
    manifestFileCount: manifest.length,
    uploadedPaths: batchMetadata.map((item) => item.relativePath),
    adminId: options.adminId,
  });
  safeLog(strapi, 'analysis-token-validation-complete', {
    authenticatedAdminId: options.adminId || null,
    batchFileCount: descriptors.length,
    metadataPresent: batchMetadata.length > 0,
    analysisTokenPresent: Boolean(body?.analysisToken),
  });

  const priorRows = await timedStage(strapi, 'history-read', () => strapi.entityService.findMany(BATCH_UID, { filters: { folderFingerprint: fingerprint }, limit: 1 }), { folderFingerprint: fingerprint });
  const old = priorRows?.[0] || {};
  const previousSummary = old.manifestSummary || {};
  const previousResultsByPath = previousSummary.resultsByPath || {};
  await timedStage(strapi, 'history-upsert-uploading', () => upsertHistory(strapi, {
    supplier: SUPPLIER,
    folderName: String(body.folderName || '').slice(0, 255),
    folderFingerprint: fingerprint,
    status: 'uploading',
    totalFiles: manifest.length,
    matchedFiles: Number(old.matchedFiles || 0),
    uploadedFiles: Number(old.uploadedFiles || 0),
    alreadyCompleteFiles: Number(old.alreadyCompleteFiles || 0),
    skippedFiles: Number(old.skippedFiles || 0),
    conflictFiles: Number(old.conflictFiles || 0),
    failedFiles: Number(old.failedFiles || 0),
    firstUploadedAt: old.firstUploadedAt || null,
    lastUploadedAt: old.lastUploadedAt || null,
    completedAt: null,
    mappingSchemaVersion: mappings.colourMap.schemaVersion,
    manifestSummary: { ...(old.manifestSummary || {}), phase: 'staging', requestStartedAt: new Date(requestStartedAt).toISOString(), requestFileCount: descriptors.length, requestBytes, resultsByPath: previousResultsByPath },
    incrementAttempt: false,
  }, priorRows), { folderFingerprint: fingerprint });

  const byPath = new Map(batchMetadata.map((item) => [normalizeRelativePath(item.relativePath), item]));
  const results = [];
  for (let fileIndex = 0; fileIndex < descriptors.length; fileIndex += 1) {
    const descriptor = descriptors[fileIndex];
    const relativePath = normalizeRelativePath(descriptor.relativePath || descriptor.name);
    const metadata = byPath.get(relativePath);
    if (!metadata || metadata.size !== descriptor.size || path.basename(relativePath) !== descriptor.name) {
      results.push({ filename: descriptor.name, relativePath, status: 'failed', failed: true, warning: 'Batch metadata did not match the uploaded file.' });
      continue;
    }
    try {
      const result = await timedStage(strapi, 'file-processing', () => processFile(strapi, descriptor, metadata, mappings, { folderName: body.folderName, folderFingerprint: fingerprint }), { fileIndex, filename: descriptor.name, bytes: descriptor.size });
      results.push({ ...result, relativePath });
    } catch (error) {
      safeLog(strapi, 'file-processing-failed', { fileIndex, filename: descriptor.name, bytes: descriptor.size, errorCode: error?.code || 'unknown' });
      results.push({ filename: descriptor.name, relativePath, status: 'failed', failed: true, warning: 'Server processing failed for this file; retry this batch to resume safely.' });
    }
  }

  const uploadedDelta = results.filter((item) => item.uploaded).length;
  const failedDelta = results.filter((item) => item.failed).length;
  const skippedDelta = results.filter((item) => item.skipped).length;
  const finalBatch = body?.finalBatch === 'true' || body?.finalBatch === true;
  const resultsByPath = { ...previousResultsByPath };
  for (const result of results) {
    const key = normalizeRelativePath(result.relativePath || result.filename);
    resultsByPath[key] = { ...resultsByPath[key], ...result, uploaded: Boolean(resultsByPath[key]?.uploaded || result.uploaded) };
  }
  const persistedResults = Object.values(resultsByPath);
  const totals = {
    uploadedFiles: persistedResults.filter((item) => item.uploaded).length,
    failedFiles: persistedResults.filter((item) => item.failed).length,
    skippedFiles: persistedResults.filter((item) => item.skipped && !['staged', 'already_staged'].includes(item.status)).length,
  };
  const status = finalBatch ? (totals.failedFiles ? 'partial' : (totals.skippedFiles ? 'completed_with_skips' : 'completed')) : (failedDelta ? 'partial' : 'uploading');
  const now = new Date().toISOString();
  const history = await timedStage(strapi, 'history-upsert-final', () => upsertHistory(strapi, {
    supplier: SUPPLIER,
    folderName: String(body.folderName || '').slice(0, 255),
    folderFingerprint: fingerprint,
    status,
    totalFiles: manifest.length,
    matchedFiles: persistedResults.filter((item) => COLOUR_STATUSES.has(item.status)).length,
    ...totals,
    alreadyCompleteFiles: persistedResults.filter((item) => item.status === 'already_staged').length,
    conflictFiles: persistedResults.filter((item) => item.status === 'conflicting_image' || item.status === 'identity_conflict').length,
    firstUploadedAt: old.firstUploadedAt || (uploadedDelta ? now : null),
    lastUploadedAt: uploadedDelta ? now : old.lastUploadedAt,
    completedAt: finalBatch ? now : null,
    mappingSchemaVersion: mappings.colourMap.schemaVersion,
    manifestSummary: { ...(old.manifestSummary || {}), phase: status, lastBatch: results, resultsByPath },
    incrementAttempt: false,
  }), { folderFingerprint: fingerprint, status });
  safeLog(strapi, 'staging-request-complete', { batchFileCount: descriptors.length, durationMs: Date.now() - requestStartedAt, status, uploaded: uploadedDelta, failed: failedDelta, skipped: skippedDelta });
  return { results, history, mappingMode: mappings.mode, status, uploaded: uploadedDelta, failed: failedDelta, skipped: skippedDelta };
}

async function getHistory(strapi) {
  return strapi.entityService.findMany(BATCH_UID, { sort: ['updatedAt:desc'], limit: 50 });
}

module.exports = { adminIdentity, analyseFolder, createAnalysisToken, finaliseAshleyWildeMedia, getAshleyWildeMediaStatus, getHistory, loadAshleyImporterMappings, logicalRows, manifestFingerprint, normalizeManifest, processBatch, recordAshleyWildeProgress, resolveAshleyFabric, safeMessage, summaryForRows, upsertHistory, verifyAnalysisToken };
