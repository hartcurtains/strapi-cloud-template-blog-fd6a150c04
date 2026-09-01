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
    { fabricName: 'Alice', fabricDocumentId: 'stale-emily-alice', supplierProductCode: 'ALICE' },
    { fabricName: 'Basil', fabricDocumentId: 'stale-emily-basil', supplierProductCode: 'BASIL' },
  ], 2),
  activeVersion('Ashley Wilde', 'ashley', [
    { fabricName: 'Alaska', fabricDocumentId: 'ashley-alaska', supplierProductCode: 'ALASKA' },
    { fabricName: 'Ashton', fabricDocumentId: 'ashley-ashton', supplierProductCode: 'ASHTON' },
  ], 2),
  activeVersion('Clarissa Hulse', 'clarissa', [], 0),
];

const lauraVersions = [
  activeVersion('Laura Ashley', 'laura', [
    { fabricName: 'Alfriston', fabricDocumentId: 'laura-alfriston', supplierProductCode: 'ALFRISTON' },
    { fabricName: 'Ambrose', fabricDocumentId: 'laura-ambrose', supplierProductCode: 'AMBROSE' },
  ], 8),
];

const mappingRows = {
  'emily-active-import': [
    { supplier: 'Emily Bond', fabricName: 'Alice', fabricDocumentId: 'stale-emily-alice', supplierProductCode: 'ALICE', supplierColourCode: 'ST', officialColourName: 'Stone', internalColourCode: 'ST', evidenceStatus: 'verified_official', source: 'official supplier mapping' },
    { supplier: 'Emily Bond', fabricName: 'Basil', fabricDocumentId: 'stale-emily-basil', supplierProductCode: 'BASIL', supplierColourCode: 'PE', officialColourName: 'Pebble', internalColourCode: 'PE', evidenceStatus: 'verified_official', source: 'official supplier mapping' },
  ],
  'ashley-active-import': [
    { supplier: 'Ashley Wilde', fabricName: 'Alaska', fabricDocumentId: 'ashley-alaska', supplierProductCode: 'ALASKA', supplierColourCode: 'AQ', officialColourName: 'Aqua', internalColourCode: 'AQ', evidenceStatus: 'verified_official', source: 'official supplier mapping' },
    { supplier: 'Ashley Wilde', fabricName: 'Ashton', fabricDocumentId: 'ashley-ashton', supplierProductCode: 'ASHTON', supplierColourCode: 'ST', officialColourName: 'Stone', internalColourCode: 'ST', evidenceStatus: 'verified_official', source: 'official supplier mapping' },
  ],
  'clarissa-active-import': [],
};

const lauraMappingRows = {
  'laura-active-import': [
    ['Alfriston', 'laura-alfriston', 'ALFRISTON', 'FE', 'Fern'],
    ['Alfriston', 'laura-alfriston', 'ALFRISTON', 'NA', 'Natural'],
    ['Alfriston', 'laura-alfriston', 'ALFRISTON', 'SA', 'Sage'],
    ['Ambrose', 'laura-ambrose', 'AMBROSE', 'EM', 'Emerald'],
    ['Ambrose', 'laura-ambrose', 'AMBROSE', 'FE', 'Fern'],
    ['Ambrose', 'laura-ambrose', 'AMBROSE', 'OC', 'Ochre'],
    ['Ambrose', 'laura-ambrose', 'AMBROSE', 'PA', 'Pearl'],
    ['Ambrose', 'laura-ambrose', 'AMBROSE', 'SA', 'Sage'],
  ].map(([fabricName, fabricDocumentId, supplierProductCode, supplierColourCode, officialColourName]) => ({
    supplier: 'Laura Ashley', fabricName, fabricDocumentId, supplierProductCode, supplierColourCode,
    officialColourName, internalColourCode: supplierColourCode, evidenceStatus: 'verified_official', source: 'official supplier mapping',
  })),
};

const fabrics = [
  { documentId: 'emily-alice', name: 'Alice', brand: { name: 'Emily Bond' } },
  { documentId: 'ashley-alice', name: 'Alice', brand: { name: 'Ashley Wilde' } },
  { documentId: 'emily-basil', name: 'Basil', brand: { name: 'Emily Bond' } },
  { documentId: 'ashley-alaska', name: 'Alaska', brand: { name: 'Ashley Wilde' } },
  { documentId: 'ashley-ashton', name: 'Ashton', brand: { name: 'Ashley Wilde' } },
];

const lauraFabrics = [
  { documentId: 'laura-alfriston', name: 'Alfriston', brand: { name: 'Laura Ashley' } },
  { documentId: 'laura-ambrose', name: 'Ambrose', brand: { name: 'Laura Ashley' } },
];

function strapiFor(activeVersions = versions, writes = null, fixture = { fabrics, mappingRows }) {
  return {
    entityService: {
      async findMany(uid, query = {}) {
        if (uid === 'api::supplier-mapping-import.supplier-mapping-import') {
          const requested = query.filters?.supplier;
          return requested ? activeVersions.filter((version) => version.supplier === requested) : activeVersions;
        }
        if (uid === 'api::fabric.fabric') {
          if (query.filters?.documentId) return fixture.fabrics.filter((fabric) => fabric.documentId === query.filters.documentId);
          if (query.filters?.name?.$eqi) return fixture.fabrics.filter((fabric) => fabric.name.toLowerCase() === String(query.filters.name.$eqi).toLowerCase());
          return fixture.fabrics;
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
          return fixture.mappingRows[query.filters?.mappingImport?.documentId] || [];
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

test('Laura Ashley numbered image variants resolve product-scoped colours and preserve source filenames', async () => {
  const strapi = strapiFor(lauraVersions, null, { fabrics: lauraFabrics, mappingRows: lauraMappingRows });
  const expected = [
    ['laalfristonfe_1.jpg', 'ALFRISTON', 'FE'],
    ['laalfristonna_1.jpg', 'ALFRISTON', 'NA'],
    ['laalfristonsa_1.jpg', 'ALFRISTON', 'SA'],
    ['laambroseem_1.jpg', 'AMBROSE', 'EM'],
    ['laambrosefe_1.jpg', 'AMBROSE', 'FE'],
    ['laambroseoc_1.jpg', 'AMBROSE', 'OC'],
    ['laambrosepa_1.jpg', 'AMBROSE', 'PA'],
    ['laambrosesa_1.jpg', 'AMBROSE', 'SA'],
  ];

  for (const [filename, supplierProductCode, supplierColourCode] of expected) {
    const row = (await analyse('Laura Ashley', filename, strapi)).rows[0];
    assert.equal(row.status, 'would_stage_identity');
    assert.equal(row.supplierProductCode, supplierProductCode);
    assert.equal(row.supplierColourCode, supplierColourCode);
    assert.equal(row.fabricColourCode, `${supplierProductCode}${supplierColourCode}`);
    assert.equal(row.assetType, 'numbered_alternate');
    assert.equal(row.filename, filename);
    assert.equal(row.relativePath, filename);
    assert.equal(row.supplierColourCode.endsWith('1'), false);
  }

  const ordinary = (await analyse('Laura Ashley', 'alfristonfe.jpg', strapi)).rows[0];
  assert.equal(ordinary.status, 'would_stage_identity');
  assert.equal(ordinary.supplierProductCode, 'ALFRISTON');
  assert.equal(ordinary.supplierColourCode, 'FE');
  assert.equal(ordinary.assetType, 'ordinary_colour');

  const multiDigit = (await analyse('Laura Ashley', 'laambrosefe_12.jpg', strapi)).rows[0];
  assert.equal(multiDigit.status, 'would_stage_identity');
  assert.equal(multiDigit.supplierProductCode, 'AMBROSE');
  assert.equal(multiDigit.supplierColourCode, 'FE');
  assert.equal(multiDigit.assetType, 'numbered_alternate');

  const nestedPath = 'Laura images/laalfristonfe_1.jpg';
  const nested = (await analyse('Laura Ashley', nestedPath, strapi)).rows[0];
  assert.equal(nested.filename, 'laalfristonfe_1.jpg');
  assert.equal(nested.relativePath, nestedPath);

  const mappings = await mappingService.getActiveImporterMappings(strapi, 'Laura Ashley');
  const invalid = importer.parseSupplierFilename('laalfristonzz_12.jpg', mappings.colourMap, 'Laura Ashley');
  assert.equal(invalid.status, 'pending_manual_mapping');
  assert.equal(invalid.supplierProductCode, 'ALFRISTON');
  assert.equal(invalid.supplierColourCode, 'ZZ');
  assert.equal(invalid.filename, 'laalfristonzz_12.jpg');
  assert.doesNotMatch(invalid.supplierColourCode, /1$/);

  const unknown = importer.parseSupplierFilename('launknownfe_1.jpg', mappings.colourMap, 'Laura Ashley');
  assert.equal(unknown.status, 'unknown_mapping_product');
  assert.equal(unknown.supplierProductCode, 'UNKNOWN');
  assert.doesNotMatch(unknown.warning, /FE1/);

  const ambiguousMap = structuredClone(mappings.colourMap);
  const alfriston = ambiguousMap.products['ALFRISTON|laura-alfriston'];
  ambiguousMap.products.duplicate = { ...alfriston, fabricName: 'Alfriston Duplicate', productName: 'Alfriston Duplicate', fabricDocumentId: 'laura-alfriston-duplicate' };
  const ambiguous = importer.parseSupplierFilename('laalfristonfe_1.jpg', ambiguousMap, 'Laura Ashley');
  assert.equal(ambiguous.status, 'ambiguous_filename');
  assert.equal(ambiguous.filename, 'laalfristonfe_1.jpg');
  assert.equal(ambiguous.supplierProductCode, undefined);
});

test('changed content under the same scoped filename requires the explicit replacement option', async () => {
  const strapi = strapiFor();
  const originalFindMany = strapi.entityService.findMany.bind(strapi.entityService);
  const identity = {
    id: 71,
    documentId: 'identity-alaska-aqua',
    officialColourName: 'Aqua',
    mappingStatus: 'promoted',
  };
  const priorAsset = {
    id: 81,
    documentId: 'asset-alaska-aqua',
    originalFilename: 'ALASKAAQ.jpg',
    normalizedFilename: 'alaskaaq',
    sha256: 'a'.repeat(64),
    importStatus: 'promoted',
    duplicateStatus: 'unique',
    fabricColourIdentity: { documentId: identity.documentId },
  };
  strapi.entityService.findMany = async (uid, query = {}) => {
    if (uid === 'api::fabric-colour-identity.fabric-colour-identity') return [identity];
    if (uid === 'api::fabric-colour-asset.fabric-colour-asset') {
      if (query.filters?.assetKey) return [];
      if (query.filters?.normalizedFilename === 'alaskaaq') return [priorAsset];
      return [];
    }
    return originalFindMany(uid, query);
  };
  const folderManifest = [{ ...manifest('ALASKAAQ.jpg')[0], sha256: 'b'.repeat(64), mimeType: 'image/jpeg' }];
  const body = {
    supplier: 'Ashley Wilde', folderName: 'Replacement images',
    folderFingerprint: importer.manifestFingerprint(folderManifest, 'Ashley Wilde'),
    manifest: folderManifest, folderManifest, queueBatch: true,
  };

  const ordinary = await importer.analyseFolder(strapi, body, { adminId: 'admin-1' });
  assert.equal(ordinary.rows[0].status, 'conflicting_image');

  const replacement = await importer.analyseFolder(strapi, { ...body, replaceExistingImages: true }, { adminId: 'admin-1' });
  assert.equal(replacement.rows[0].status, 'would_replace_asset');
  assert.equal(replacement.rows[0].replaceExistingImage, true);
  assert.equal(replacement.summary.readyFiles, 1);
  assert.equal(replacement.summary.conflictFiles, 0);
  const signed = importer.verifyAnalysisToken(replacement.analysisToken, {
    supplier: 'Ashley Wilde', mappingImportDocumentId: 'ashley-active-import', mappingVersion: 'ashley-active-v1',
    fingerprint: body.folderFingerprint, manifestFileCount: 1, uploadedPaths: ['ALASKAAQ.jpg'], adminId: 'admin-1',
  });
  assert.equal(signed.analyzedFiles[0].replaceExistingImage, true);
});

test('selecting the wrong supplier reports that supplier and never searches another active map', async () => {
  const row = (await analyse('Ashley Wilde', 'alicest.jpg')).rows[0];
  assert.equal(row.status, 'unknown_mapping_product');
  assert.equal(row.supplier, 'Ashley Wilde');
  assert.equal(row.supplierProductCode, 'ALICE');
  assert.equal(row.warning, 'Ashley Wilde mapping does not contain product code ALICE.');
});

test('a stale or cross-Brand mapped ID falls back only to the exact selected-Brand Fabric name', async () => {
  const resolution = await importer.resolveSupplierFabric(strapiFor(), {
    status: 'matched',
    supplier: 'Emily Bond',
    fabricName: 'Alice',
    fabricDocumentId: 'ashley-alice',
    supplierProductCode: 'ALICE',
    supplierColourCode: 'ST',
  }, 'Emily Bond');
  assert.equal(resolution.fabric.documentId, 'emily-alice');
  assert.equal(resolution.parsed.status, 'mapped');
  assert.equal(resolution.parsed.fabricDocumentId, 'emily-alice');
});

test('a stale mapped ID never falls through to another Brand when the selected Brand/name is absent', async () => {
  const resolution = await importer.resolveSupplierFabric(strapiFor(), {
    status: 'matched',
    supplier: 'Emily Bond',
    fabricName: 'Not Alice',
    fabricDocumentId: 'ashley-alice',
    supplierProductCode: 'ALICE',
    supplierColourCode: 'ST',
  }, 'Emily Bond');
  assert.equal(resolution.fabric, null);
  assert.equal(resolution.parsed.status, 'fabric_not_found_in_current_catalog');
  assert.match(resolution.parsed.warning, /No Emily Bond fabric named Not Alice/);
});

test('Fabric resolution reads draft/published Document Service records before exact-name fallback', async () => {
  const strapi = strapiFor();
  const entityFindMany = strapi.entityService.findMany;
  strapi.entityService.findMany = async (uid, query) => (
    uid === 'api::fabric.fabric' ? [] : entityFindMany(uid, query)
  );
  const mappingDocuments = strapi.documents;
  strapi.documents = (uid) => {
    if (uid !== 'api::fabric.fabric') return mappingDocuments(uid);
    return {
      async findMany(query) {
        if (query.filters?.documentId) return [];
        if (query.status === 'draft') return [{ documentId: 'emily-alice-draft', name: 'Alice', brand: { name: 'Emily Bond' } }];
        return [];
      },
    };
  };
  const resolution = await importer.resolveSupplierFabric(strapi, {
    status: 'matched',
    supplier: 'Emily Bond',
    fabricName: 'Alice',
    fabricDocumentId: 'stale-emily-alice',
    supplierProductCode: 'ALICE',
    supplierColourCode: 'ST',
  }, 'Emily Bond');
  assert.equal(resolution.fabric.documentId, 'emily-alice-draft');
  assert.equal(resolution.parsed.status, 'mapped');
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
  assert.match(source, /Replace images already in the catalogue/);
  assert.match(source, /replaceExistingImages,\s*\n\s*folderName:/);
  assert.match(source, /Colours not included in this upload stay unchanged/);
});
