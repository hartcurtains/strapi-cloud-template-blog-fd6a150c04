'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');

const importer = require('../src/plugins/order-management/server/services/ashley-wilde-import');
const mappingService = require('../src/plugins/order-management/server/services/supplier-mapping');

const previousSecret = process.env.STRAPI_INTERNAL_SECURITY_SECRET;
before(() => { process.env.STRAPI_INTERNAL_SECURITY_SECRET = 'supplier-folder-test-secret'; });
after(() => {
  if (previousSecret === undefined) delete process.env.STRAPI_INTERNAL_SECURITY_SECRET;
  else process.env.STRAPI_INTERNAL_SECURITY_SECRET = previousSecret;
});

function activeVersion(supplier, slug, fabrics, mappingCount) {
  return {
    documentId: `${slug}-active-import`,
    supplier,
    status: 'active',
    isActive: true,
    version: `${slug}-active-v1`,
    schemaVersion: 1,
    mappingCount,
    importedAt: '2026-08-03T00:00:00.000Z',
    sourcePayload: { schemaVersion: 1, supplier, mappingVersion: `${slug}-active-v1`, fabrics },
  };
}

const versions = [
  activeVersion('Emily Bond', 'emily', [
    { fabricName: 'Alice', fabricDocumentId: 'emily-alice', supplierProductCode: 'ALICE' },
    { fabricName: 'Basil', fabricDocumentId: 'emily-basil', supplierProductCode: 'BASIL' },
  ], 2),
  activeVersion('Ashley Wilde', 'ashley', [
    { fabricName: 'Alaska', fabricDocumentId: 'ashley-alaska', supplierProductCode: 'ALASKA' },
    { fabricName: 'Ashton', fabricDocumentId: 'ashley-ashton', supplierProductCode: 'ASHTON' },
  ], 2),
  activeVersion('Clarissa Hulse', 'clarissa', [], 0),
];

const mappingRows = {
  'emily-active-import': [
    { supplier: 'Emily Bond', fabricName: 'Alice', fabricDocumentId: 'emily-alice', supplierProductCode: 'ALICE', supplierColourCode: 'ST', officialColourName: 'Stone', internalColourCode: 'ST', evidenceStatus: 'verified_official', source: 'official supplier mapping' },
    { supplier: 'Emily Bond', fabricName: 'Basil', fabricDocumentId: 'emily-basil', supplierProductCode: 'BASIL', supplierColourCode: 'PE', officialColourName: 'Pebble', internalColourCode: 'PE', evidenceStatus: 'verified_official', source: 'official supplier mapping' },
  ],
  'ashley-active-import': [
    { supplier: 'Ashley Wilde', fabricName: 'Alaska', fabricDocumentId: 'ashley-alaska', supplierProductCode: 'ALASKA', supplierColourCode: 'AQ', officialColourName: 'Aqua', internalColourCode: 'AQ', evidenceStatus: 'verified_official', source: 'official supplier mapping' },
    { supplier: 'Ashley Wilde', fabricName: 'Ashton', fabricDocumentId: 'ashley-ashton', supplierProductCode: 'ASHTON', supplierColourCode: 'ST', officialColourName: 'Stone', internalColourCode: 'ST', evidenceStatus: 'verified_official', source: 'official supplier mapping' },
  ],
  'clarissa-active-import': [],
};

const fabrics = [
  { documentId: 'emily-alice', name: 'Alice', brand: { name: 'Emily Bond' } },
  { documentId: 'ashley-alice', name: 'Alice', brand: { name: 'Ashley Wilde' } },
  { documentId: 'emily-basil', name: 'Basil', brand: { name: 'Emily Bond' } },
  { documentId: 'ashley-alaska', name: 'Alaska', brand: { name: 'Ashley Wilde' } },
  { documentId: 'ashley-ashton', name: 'Ashton', brand: { name: 'Ashley Wilde' } },
];

function strapiFor(activeVersions = versions, writes = null) {
  return {
    entityService: {
      async findMany(uid, query = {}) {
        if (uid === 'api::supplier-mapping-import.supplier-mapping-import') {
          const requested = query.filters?.supplier;
          return requested ? activeVersions.filter((version) => version.supplier === requested) : activeVersions;
        }
        if (uid === 'api::fabric.fabric') {
          if (query.filters?.documentId) return fabrics.filter((fabric) => fabric.documentId === query.filters.documentId);
          if (query.filters?.name?.$eqi) return fabrics.filter((fabric) => fabric.name.toLowerCase() === String(query.filters.name.$eqi).toLowerCase());
          return fabrics;
        }
        if (uid === 'api::fabric-colour-identity.fabric-colour-identity') return [];
        if (uid === 'api::fabric-colour-asset.fabric-colour-asset') return [];
        if (uid === 'api::image-import-batch.image-import-batch') return [];
        if (uid === 'plugin::upload.file') return [];
        return [];
      },
      async create(uid, payload) {
        if (!writes || uid !== 'api::image-import-batch.image-import-batch') throw new Error('Read-only analysis must not create operational records.');
        writes.push({ operation: 'create', uid, payload });
        return { id: 1, documentId: 'history-1', ...payload.data };
      },
      async update() { throw new Error('Read-only analysis must not update records.'); },
    },
    documents(uid) {
      if (uid !== 'api::supplier-fabric-colour-mapping.supplier-fabric-colour-mapping') throw new Error(`Unexpected documents API UID: ${uid}`);
      return {
        async findMany(query = {}) {
          return mappingRows[query.filters?.mappingImport?.documentId] || [];
        },
      };
    },
  };
}

function manifest(filename) {
  return [{
    relativePath: filename,
    sha256: crypto.createHash('sha256').update(filename).digest('hex'),
    size: filename.length,
  }];
}

async function analyse(supplier, filename, strapi = strapiFor()) {
  const folderManifest = manifest(filename);
  return importer.analyseFolder(strapi, {
    supplier,
    folderName: 'Selected supplier images',
    folderFingerprint: importer.manifestFingerprint(folderManifest, supplier),
    manifest: folderManifest,
    folderManifest,
    queueBatch: true,
  }, { adminId: 'admin-1' });
}

test('Emily Bond active mapping resolves Alice / Stone and Basil / Pebble without staging', async () => {
  const alice = (await analyse('Emily Bond', 'alicest.jpg')).rows[0];
  assert.equal(alice.supplier, 'Emily Bond');
  assert.equal(alice.supplierProductCode, 'ALICE');
  assert.equal(alice.supplierColourCode, 'ST');
  assert.equal(alice.fabricColourCode, 'ALICEST');
  assert.equal(alice.fabricName, 'Alice');
  assert.equal(alice.resolvedFabricDocumentId, 'emily-alice');
  assert.equal(alice.supplierColourName, 'Stone');
  assert.equal(alice.status, 'would_stage_identity');

  const basil = (await analyse('Emily Bond', 'basilpe.jpg')).rows[0];
  assert.equal(basil.supplierProductCode, 'BASIL');
  assert.equal(basil.supplierColourCode, 'PE');
  assert.equal(basil.fabricColourCode, 'BASILPE');
  assert.equal(basil.fabricName, 'Basil');
  assert.equal(basil.supplierColourName, 'Pebble');
  assert.equal(basil.status, 'would_stage_identity');
});

test('Ashley Wilde active mapping still resolves Alaska / Aqua', async () => {
  const alaska = (await analyse('Ashley Wilde', 'ALASKAAQ.jpg')).rows[0];
  assert.equal(alaska.supplier, 'Ashley Wilde');
  assert.equal(alaska.supplierProductCode, 'ALASKA');
  assert.equal(alaska.supplierColourCode, 'AQ');
  assert.equal(alaska.fabricColourCode, 'ALASKAAQ');
  assert.equal(alaska.fabricName, 'Alaska');
  assert.equal(alaska.supplierColourName, 'Aqua');
  assert.equal(alaska.status, 'would_stage_identity');
});

test('selecting the wrong supplier reports that supplier and never searches another active map', async () => {
  const row = (await analyse('Ashley Wilde', 'alicest.jpg')).rows[0];
  assert.equal(row.status, 'unknown_mapping_product');
  assert.equal(row.supplier, 'Ashley Wilde');
  assert.equal(row.supplierProductCode, 'ALICE');
  assert.equal(row.warning, 'Ashley Wilde mapping does not contain product code ALICE.');
});

test('Fabric resolution rejects a mapped document belonging to another Brand', async () => {
  const resolution = await importer.resolveSupplierFabric(strapiFor(), {
    status: 'matched',
    supplier: 'Emily Bond',
    fabricName: 'Alice',
    fabricDocumentId: 'ashley-alice',
    supplierProductCode: 'ALICE',
    supplierColourCode: 'ST',
  }, 'Emily Bond');
  assert.equal(resolution.fabric, null);
  assert.equal(resolution.parsed.status, 'fabric_not_found_in_current_catalog');
  assert.match(resolution.parsed.warning, /current Emily Bond catalog/);
});

test('missing selected supplier mapping uses the required supplier-specific error', async () => {
  await assert.rejects(
    () => analyse('Emily Bond', 'alicest.jpg', strapiFor(versions.filter((version) => version.supplier !== 'Emily Bond'))),
    (error) => error.code === 'SUPPLIER_MAPPING_NOT_FOUND'
      && error.message === 'No active colour mapping version exists for Emily Bond.',
  );
});

test('supplier selector source lists every Brand with an active mapping version', async () => {
  const suppliers = await mappingService.listActiveMappingSuppliers(strapiFor());
  assert.deepEqual(suppliers.map((entry) => entry.supplier), ['Ashley Wilde', 'Clarissa Hulse', 'Emily Bond']);
});

test('folder analysis history stores the selected supplier', async () => {
  const writes = [];
  const folderManifest = manifest('alicest.jpg');
  const result = await importer.analyseFolder(strapiFor(versions, writes), {
    supplier: 'Emily Bond',
    folderName: 'Emily images',
    folderFingerprint: importer.manifestFingerprint(folderManifest, 'Emily Bond'),
    manifest: folderManifest,
  }, { adminId: 'admin-1' });
  assert.equal(result.history.supplier, 'Emily Bond');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].uid, 'api::image-import-batch.image-import-batch');
  assert.equal(writes[0].payload.data.supplier, 'Emily Bond');
  assert.equal(writes[0].payload.data.manifestSummary.supplier, 'Emily Bond');
});

test('folder UI requires the selected supplier and sends it to analyse and finalise', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/plugins/order-management/admin/src/components/AshleyWildeFolderImporter.jsx'), 'utf8');
  assert.match(source, /<span>Supplier/);
  assert.match(source, /value=\{selectedSupplier\}/);
  assert.match(source, /supplier:\s*selectedSupplier/);
  assert.match(source, /disabled=\{[^}]*!selectedSupplier/);
});
