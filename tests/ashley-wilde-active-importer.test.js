'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mappingService = require('../src/plugins/order-management/server/services/supplier-mapping');
const importer = require('../src/plugins/order-management/server/services/ashley-wilde-import');

function activeFixture({ supplier = 'Ashley Wilde', sourceSupplier = supplier } = {}) {
  const fabrics = Array.from({ length: 71 }, (_, index) => ({
    fabricName: `Fabric ${index + 1}`,
    fabricDocumentId: `fabric-${index + 1}`,
    supplierProductCode: `FAB${index + 1}`,
    colours: [],
  }));
  const rows = Array.from({ length: 562 }, (_, index) => {
    const fabricIndex = index % fabrics.length;
    return {
      documentId: `mapping-row-${index + 1}`,
      supplier: 'Ashley Wilde',
      fabricName: fabrics[fabricIndex].fabricName,
      fabricDocumentId: fabrics[fabricIndex].fabricDocumentId,
      supplierProductCode: fabrics[fabricIndex].supplierProductCode,
      supplierColourCode: `C${index + 1}`,
      officialColourName: `Colour ${index + 1}`,
      internalColourCode: `AW${String(index + 1).padStart(4, '0')}`,
      evidenceStatus: 'verified_official',
      source: 'official supplier mapping',
    };
  });
  const sourcePayload = { schemaVersion: 1, supplier: sourceSupplier, mappingVersion: 'active-562', source: 'Strapi active mapping', fabrics };
  return {
    version: {
      documentId: 'active-import-562', supplier, status: 'active', isActive: true,
      version: 'active-562', schemaVersion: 1, importedAt: '2026-07-28T10:00:00.000Z', sourcePayload,
    },
    rows,
  };
}

function strapiFor(active = null, writes = []) {
  return {
    entityService: {
      async findMany(uid) {
        if (uid === 'api::supplier-mapping-import.supplier-mapping-import') return active ? [active.version] : [];
        if (uid === 'api::fabric.fabric') return [];
        if (uid === 'api::fabric-colour-identity.fabric-colour-identity') return [];
        if (uid === 'api::fabric-colour-asset.fabric-colour-asset') return [];
        if (uid === 'api::image-import-batch.image-import-batch') return [];
        if (uid === 'plugin::upload.file') return [];
        return [];
      },
      async create(uid, data) { writes.push({ operation: 'create', uid, data }); return data; },
      async update(uid, id, data) { writes.push({ operation: 'update', uid, id, data }); return data; },
    },
    documents(uid) {
      if (uid === 'api::supplier-fabric-colour-mapping.supplier-fabric-colour-mapping') {
        return { async findMany() { return active?.rows || []; } };
      }
      throw new Error(`Unexpected documents API UID: ${uid}`);
    },
  };
}

function manifestEntry(relativePath = 'Ashley/FAB1C1.jpg') {
  return {
    relativePath,
    sha256: crypto.createHash('sha256').update(relativePath).digest('hex'),
    size: relativePath.length,
  };
}

test('active importer mapping normalizes Ashley Wilde and preserves all 562 rows across 71 fabrics', async () => {
  const active = activeFixture({ supplier: '  ashley wilde  ', sourceSupplier: 'Ashley   Wilde' });
  const result = await mappingService.getActiveImporterMappings(strapiFor(active), ' ashley wilde ');
  assert.equal(result.source, 'strapi-active-version');
  assert.equal(result.colourMap.supplier, 'Ashley Wilde');
  assert.equal(result.rows.length, 562);
  assert.equal(Object.keys(result.colourMap.products).length, 71);
});

test('valid active mapping wins and repository fallback is used only when no active version exists', async () => {
  const active = activeFixture();
  const activeResult = await importer.loadAshleyImporterMappings(strapiFor(active));
  assert.equal(activeResult.source, 'strapi-active-version');
  assert.equal(activeResult.mappingRowCount, 562);
  assert.equal(activeResult.colourMap.supplier, 'Ashley Wilde');

  const fallbackResult = await importer.loadAshleyImporterMappings(strapiFor(null));
  assert.equal(fallbackResult.source, 'repository-fallback');
  assert.equal(fallbackResult.colourMap.supplier, 'Ashley Wilde');
});

test('an unrelated active supplier payload is rejected instead of being silently normalized', async () => {
  const active = activeFixture({ sourceSupplier: 'Other Supplier' });
  await assert.rejects(
    () => mappingService.getActiveImporterMappings(strapiFor(active), 'Ashley Wilde'),
    (error) => error.code === 'ASHLEY_WILDE_MAPPING_INVALID' && /supplier must be "Ashley Wilde"/.test(error.message),
  );
});

test('analysis token is tied to admin, active mapping, complete manifest, and analyzed paths', () => {
  const previous = process.env.STRAPI_INTERNAL_SECURITY_SECRET;
  process.env.STRAPI_INTERNAL_SECURITY_SECRET = 'focused-test-secret';
  try {
    const entry = manifestEntry();
    const fingerprint = importer.manifestFingerprint([entry]);
    const token = importer.createAnalysisToken({
      mappingImportDocumentId: 'active-import-562', mappingVersion: 'active-562',
      manifestFingerprint: fingerprint, manifestFileCount: 1, analyzedPaths: [entry.relativePath], adminId: 'admin-1',
    });
    assert.equal(importer.verifyAnalysisToken(token, {
      mappingImportDocumentId: 'active-import-562', mappingVersion: 'active-562', fingerprint,
      manifestFileCount: 1, uploadedPaths: [entry.relativePath], adminId: 'admin-1',
    }).analyzedFileCount, 1);
    assert.throws(() => importer.verifyAnalysisToken(token, {
      mappingImportDocumentId: 'active-import-562', mappingVersion: 'active-562', fingerprint,
      manifestFileCount: 1, uploadedPaths: [entry.relativePath], adminId: 'admin-2',
    }), (error) => error.code === 'ASHLEY_WILDE_ANALYSIS_INVALID');
  } finally {
    if (previous === undefined) delete process.env.STRAPI_INTERNAL_SECURITY_SECRET;
    else process.env.STRAPI_INTERNAL_SECURITY_SECRET = previous;
  }
});

test('staging rejects a selected manifest when no successful analysis token was supplied', async () => {
  const active = activeFixture();
  const entry = manifestEntry();
  const writes = [];
  const strapi = strapiFor(active, writes);
  const body = {
    folderName: 'Ashley', folderFingerprint: importer.manifestFingerprint([entry]),
    folderManifest: JSON.stringify([entry]), fileMetadata: JSON.stringify([entry]), finalBatch: 'true',
  };
  const previous = process.env.STRAPI_INTERNAL_SECURITY_SECRET;
  process.env.STRAPI_INTERNAL_SECURITY_SECRET = 'focused-test-secret';
  try {
    await assert.rejects(() => importer.processBatch(strapi, [], body, { adminId: 'admin-1' }), (error) => error.code === 'ASHLEY_WILDE_ANALYSIS_REQUIRED');
    assert.equal(writes.length, 0);
  } finally {
    if (previous === undefined) delete process.env.STRAPI_INTERNAL_SECURITY_SECRET;
    else process.env.STRAPI_INTERNAL_SECURITY_SECRET = previous;
  }
});

test('queue analysis returns a token without mutating operational staging records', async () => {
  const active = activeFixture();
  const writes = [];
  const entry = manifestEntry('Ashley/UNKNOWN.jpg');
  const strapi = strapiFor(active, writes);
  const previous = process.env.STRAPI_INTERNAL_SECURITY_SECRET;
  process.env.STRAPI_INTERNAL_SECURITY_SECRET = 'focused-test-secret';
  try {
    const result = await importer.analyseFolder(strapi, {
      folderName: 'Ashley', folderFingerprint: importer.manifestFingerprint([entry]), manifest: [entry],
      folderManifest: [entry], queueBatch: true,
    }, { adminId: 'admin-1' });
    assert.match(result.analysisToken, /^aw-analysis\./);
    assert.equal(result.summary.totalFiles, 1);
    assert.equal(writes.length, 0);
  } finally {
    if (previous === undefined) delete process.env.STRAPI_INTERNAL_SECURITY_SECRET;
    else process.env.STRAPI_INTERNAL_SECURITY_SECRET = previous;
  }
});

test('folder UI does not display zero-count analysis or allow stage before analysis completes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/plugins/order-management/admin/src/components/AshleyWildeFolderImporter.jsx'), 'utf8');
  assert.match(source, /analysis\?\.analysisComplete === true/);
  assert.match(source, /setAnalysis\(null\)/);
  assert.match(source, /stageQueuedFolder/);
  assert.match(source, /<button[^>]*disabled(?:\s|=)[^>]*>[^<]*<Upload[^>]*\/>Stage \{queuedFolder\.totalFiles\} file\(s\)/s);
  assert.match(source, /analysisToken:\s*batch\.analysisToken/);
});

test('folder staging continues after per-file failures and leaves only failed rows retryable', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/plugins/order-management/admin/src/components/AshleyWildeFolderImporter.jsx'), 'utf8');
  assert.match(source, /const failures = \[\][\s\S]*for \(let index = 0; index < stagingRows\.length; index \+= 1\)[\s\S]*try \{[\s\S]*await stageAshleyRow/);
  assert.match(source, /failures\.push\(\{ filename: row\.filename, relativePath: row\.relativePath, error: rowError \}\)/);
  assert.match(source, /successfulPaths\.has\(row\.relativePath\) \? \{ \.\.\.row, status: 'already_complete' \} : row/);
});
