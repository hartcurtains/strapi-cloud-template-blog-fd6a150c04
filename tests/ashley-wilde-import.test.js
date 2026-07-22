'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');

const mapping = require('../src/plugins/order-management/shared/ashley-wilde-mapping');
const importer = require('../src/plugins/order-management/server/services/ashley-wilde-import');
const { buildMap } = require('../scripts/ashley-wilde-map-builder');
const { resetPilotArtifacts, pilotTargets } = require('../scripts/ashley-wilde-pilot-reset');

function fixtures() {
  const colourMap = {
    schemaVersion: 1, supplier: 'Ashley Wilde', generatedAt: null,
    products: {
      ash: {
        supplierProductCode: 'ASH', fabricName: 'Ash', fabricDocumentId: 'fabric-ash', productName: 'Ash', filenamePrefixes: ['ASH'],
        colours: { BLUE12: { resolved: true, supplierColourCode: 'BLUE12', supplierColourName: 'Ocean', internalColourCode: 'AW0001' } },
      },
      ashley: {
        supplierProductCode: 'ASHLEY', fabricName: 'Ashley', fabricDocumentId: 'fabric-ashley', productName: 'Ashley', filenamePrefixes: ['ASHLEY'],
        colours: {
          X: { resolved: true, supplierColourCode: 'X', supplierColourName: 'Ocean', internalColourCode: 'AW0001' },
          TODO: { resolved: false, reason: 'Awaiting supplier confirmation' },
        },
      },
    },
  };
  const codeRegistry = {
    schemaVersion: 1, supplier: 'Ashley Wilde', generatedAt: null,
    codes: { AW0001: { colourName: 'Ocean', sources: [{ supplierProductCode: 'ASH', supplierColourCode: 'BLUE12' }] } }, unresolved: [],
  };
  const imageIndex = { schemaVersion: 1, supplier: 'Ashley Wilde', generatedAt: null, images: {}, unresolved: [] };
  return { colourMap, codeRegistry, imageIndex };
}

function colourIdentityHarness() {
  const fabrics = [
    { id: 101, documentId: 'fabric-berkeley', name: 'Berkeley', brand: { name: 'Ashley Wilde' } },
    { id: 102, documentId: 'fabric-cherington', name: 'Cherington', brand: { name: 'Ashley Wilde' } },
  ];
  const colours = [];
  const identities = [];
  const assets = [];
  const codes = [];
  const files = [];
  const batches = [];
  let nextColourId = 1;
  let nextIdentityId = 1;
  let nextAssetId = 1;
  let nextCodeId = 1;
  let nextFileId = 1;
  let nextBatchId = 1;

  const strapi = {
    dirs: { static: { public: path.join(os.tmpdir(), 'ashley-wilde-colour-test-public') } },
    entityService: {
      async findMany(uid, query = {}) {
        if (uid === 'api::fabric.fabric') {
          if (query.filters?.name?.$eqi) return fabrics.filter((fabric) => fabric.name.toLowerCase() === String(query.filters.name.$eqi).toLowerCase());
          return fabrics.filter((fabric) => fabric.documentId === query.filters?.documentId);
        }
        if (uid === 'api::colour.colour') {
          const filters = query.filters || {};
          return colours.filter((colour) =>
            String(colour.supplier || '').toLowerCase() === String(filters.supplier?.$eqi || '').toLowerCase() &&
            colour.fabricDocumentId === filters.fabricDocumentId?.$eq &&
            String(colour.supplierProductCode || '').toLowerCase() === String(filters.supplierProductCode?.$eqi || '').toLowerCase() &&
            String(colour.supplierColourCode || '').toLowerCase() === String(filters.supplierColourCode?.$eqi || '').toLowerCase()
          );
        }
        if (uid === 'api::fabric-colour-identity.fabric-colour-identity') {
          return identities.filter((identity) => identity.identityKey === query.filters?.identityKey?.$eq);
        }
        if (uid === 'api::fabric-colour-asset.fabric-colour-asset') {
          return assets.filter((asset) => asset.assetKey === query.filters?.assetKey?.$eq);
        }
        if (uid === 'api::color-code.color-code') {
          return codes.filter((code) => String(code.code).toLowerCase() === String(query.filters?.code?.$eqi || '').toLowerCase());
        }
        if (uid === 'plugin::upload.file') {
          if (query.filters?.caption) return files.filter((file) => file.caption === query.filters.caption);
          return files.filter((file) => file.name === query.filters?.name);
        }
        if (uid === 'api::image-import-batch.image-import-batch') {
          return batches.filter((batch) => batch.folderFingerprint === query.filters?.folderFingerprint);
        }
        return [];
      },
      async findOne(uid, id) {
        if (uid === 'api::colour.colour') return colours.find((colour) => colour.id === id) || null;
        if (uid === 'api::fabric-colour-identity.fabric-colour-identity') return identities.find((identity) => identity.id === id) || null;
        return null;
      },
      async create(uid, { data }) {
        if (uid === 'api::colour.colour') {
          const value = { id: nextColourId++, ...data, fabrics: [], thumbnail: null };
          colours.push(value);
          return value;
        }
        if (uid === 'api::fabric-colour-identity.fabric-colour-identity') {
          const value = { id: nextIdentityId++, ...data, assets: [] };
          identities.push(value);
          return value;
        }
        if (uid === 'api::fabric-colour-asset.fabric-colour-asset') {
          const value = { id: nextAssetId++, ...data };
          assets.push(value);
          return value;
        }
        if (uid === 'api::color-code.color-code') {
          const value = { id: nextCodeId++, ...data };
          codes.push(value);
          return value;
        }
        if (uid === 'api::image-import-batch.image-import-batch') {
          const value = { id: nextBatchId++, ...data };
          batches.push(value);
          return value;
        }
        throw new Error(`Unexpected create ${uid}`);
      },
      async update(uid, id, { data }) {
        if (uid === 'api::colour.colour') {
          const colour = colours.find((item) => item.id === id);
          if (data.name !== undefined) colour.name = data.name;
          if (data.thumbnail !== undefined) colour.thumbnail = data.thumbnail;
          if (data.fabrics?.connect) {
            for (const key of data.fabrics.connect) {
              const fabric = fabrics.find((item) => (item.documentId || item.id) === key);
              if (fabric && !colour.fabrics.some((item) => item.documentId === fabric.documentId)) colour.fabrics.push(fabric);
            }
          }
          if (data.fabrics?.set) colour.fabrics = data.fabrics.set.map((key) => fabrics.find((item) => (item.documentId || item.id) === key));
          return colour;
        }
        if (uid === 'api::fabric-colour-identity.fabric-colour-identity') {
          const identity = identities.find((item) => item.id === id);
          Object.assign(identity, data);
          return identity;
        }
        if (uid === 'api::fabric-colour-asset.fabric-colour-asset') {
          const asset = assets.find((item) => item.id === id);
          Object.assign(asset, data);
          return asset;
        }
        if (uid === 'api::image-import-batch.image-import-batch') {
          const batch = batches.find((item) => item.id === id);
          Object.assign(batch, data);
          return batch;
        }
        throw new Error(`Unexpected update ${uid}`);
      },
    },
    plugins: {
      upload: {
        services: {
          upload: {
            async upload({ data, files: descriptor }) {
              const value = {
                id: nextFileId++, name: descriptor.originalFilename, size: descriptor.size,
                provider: 'local', url: `/uploads/${descriptor.originalFilename}`,
                caption: data.fileInfo.caption,
              };
              files.push(value);
              return [value];
            },
          },
        },
      },
    },
  };
  return { strapi, fabrics, colours, identities, assets, files, batches };
}

function colourIdentityMappings() {
  return {
    mode: 'pilot',
    colourMap: {
      schemaVersion: 1, supplier: 'Ashley Wilde', generatedAt: null,
      products: {
        berkeley: {
          supplierProductCode: 'BERKELEY', fabricName: 'Berkeley', fabricDocumentId: 'fabric-berkeley', productName: 'Berkeley', filenamePrefixes: ['BERKELEY'],
          colours: { DO: { resolved: true, supplierColourCode: 'DO', supplierColourName: 'Dove', internalColourCode: 'DO' } },
        },
        cherington: {
          supplierProductCode: 'CHERINGTON', fabricName: 'Cherington', fabricDocumentId: 'fabric-cherington', productName: 'Cherington', filenamePrefixes: ['CHERINGTON'],
          colours: { DO: { resolved: true, supplierColourCode: 'DO', supplierColourName: 'Dove', internalColourCode: 'DO' } },
        },
      },
    },
    codeRegistry: {
      schemaVersion: 1, supplier: 'Ashley Wilde', generatedAt: null,
      codes: { DO: { colourName: 'Dove', sources: [{ supplierProductCode: 'BERKELEY', supplierColourCode: 'DO' }, { supplierProductCode: 'CHERINGTON', supplierColourCode: 'DO' }] } },
      unresolved: [],
    },
    imageIndex: { schemaVersion: 1, supplier: 'Ashley Wilde', generatedAt: null, images: {}, unresolved: [] },
  };
}

function fabricResolverHarness(rows) {
  return {
    entityService: {
      async findMany(uid) {
        return uid === 'api::fabric.fabric' ? rows : [];
      },
    },
  };
}

function resolvedFabricInput(overrides = {}) {
  return {
    status: 'matched', productName: 'Alaska', fabricName: 'Alaska',
    supplierProductCode: 'ALASKA', fabricDocumentId: 'old-document-id',
    approvedAliases: [], supplierColourCode: 'AQ', supplierColourName: 'Aqua',
    internalColourCode: 'AQ', ...overrides,
  };
}

test('production JSON contracts load safely after the validated merge', () => {
  const loaded = mapping.loadProductionMappings();
  assert.equal(loaded.colourMap.schemaVersion, 1);
  assert.equal(Object.keys(loaded.colourMap.products).length, 16);
  assert.equal(Object.values(loaded.colourMap.products).reduce((total, product) => total + Object.keys(product.colours).length, 0), 214);
  assert.equal(Object.keys(loaded.codeRegistry.codes).length, 164);
});

test('production mapping resolves every Alaska flat shot to the existing Alaska fabric', () => {
  const loaded = mapping.loadProductionMappings({ mode: 'production' });
  const alaska = loaded.colourMap.products.alaska;
  const expectedCodes = ['AQ', 'AU', 'BA', 'BE', 'CA', 'CI', 'CR', 'DO', 'EM', 'ES', 'FE', 'FO', 'FU', 'GR', 'GU', 'HE', 'HO', 'LA', 'LI', 'MA', 'MO', 'NA', 'NO', 'OT', 'OY', 'PE', 'PO', 'RU', 'SC', 'SE', 'SH', 'SI', 'SL', 'TE', 'TO', 'VI', 'WE', 'WI'];
  assert.equal(alaska.fabricName, 'Alaska');
  assert.equal(alaska.fabricDocumentId, 'okwshze5maa8f02rmu0v5azq');
  assert.deepEqual(Object.keys(alaska.colours), expectedCodes);
  for (const code of expectedCodes) {
    const parsed = mapping.parseFilename(`ALASKA${code}.jpg`, loaded.colourMap);
    assert.equal(parsed.status, 'matched', code);
    assert.equal(parsed.productName, 'Alaska', code);
    assert.equal(parsed.fabricDocumentId, 'okwshze5maa8f02rmu0v5azq', code);
    assert.ok(loaded.codeRegistry.codes[parsed.internalColourCode], code);
  }
});

test('pilot mode loads its isolated product-scoped mapping and remains separate from production', () => {
  const production = mapping.loadProductionMappings({ mode: 'production' });
  const pilot = mapping.loadProductionMappings({ mode: 'pilot' });
  assert.equal(production.mode, 'production');
  assert.equal(pilot.mode, 'pilot');
  assert.equal(mapping.parseFilename('ALASKAAQ.jpg', pilot.colourMap).supplierColourName, 'Aqua');
  assert.equal(mapping.parseFilename('AREZZOIN.jpg', pilot.colourMap).supplierColourName, 'Ink');
  assert.equal(mapping.parseFilename('BERKELEYDO.jpg', pilot.colourMap).supplierColourName, 'Dove');
  assert.equal(mapping.parseFilename('CHERINGTONDO.jpg', pilot.colourMap).supplierColourName, 'Dove');
  assert.equal(mapping.parseFilename('ALASKAMA.jpg', pilot.colourMap).status, 'unknown_colour_code');
  assert.equal(Object.keys(production.colourMap.products).length, 16);
  assert.notDeepEqual(production.colourMap.products, pilot.colourMap.products);
});

test('pilot mode is rejected for production and malformed pilot contracts fail safely', () => {
  assert.throws(() => mapping.loadProductionMappings({ mode: 'pilot', production: true }), /local-only/);
  assert.throws(() => mapping.validateColourMap({ schemaVersion: 1, supplier: 'Ashley Wilde', products: {} }), /generatedAt|products/);
  assert.throws(() => mapping.resolveMappingMode({ mode: 'not-a-mode' }), /mapping mode/);
});

test('fabric resolution is portable, exact, Ashley-scoped, and ambiguity-safe', async () => {
  const current = { id: 7, documentId: 'current-alaska-id', name: 'Alaska', brand: { name: 'Ashley Wilde' }, publishedAt: null };
  const mapped = await importer.resolveAshleyFabric(fabricResolverHarness([current]), resolvedFabricInput());
  assert.equal(mapped.parsed.status, 'mapped');
  assert.equal(mapped.parsed.fabricDocumentId, 'current-alaska-id');
  assert.equal(mapped.fabric.documentId, 'current-alaska-id');

  const otherBrand = await importer.resolveAshleyFabric(fabricResolverHarness([{ ...current, documentId: 'other-brand-id', brand: { name: 'Other Brand' } }]), resolvedFabricInput());
  assert.equal(otherBrand.parsed.status, 'fabric_not_found_in_current_catalog');

  const missing = await importer.resolveAshleyFabric(fabricResolverHarness([]), resolvedFabricInput());
  assert.equal(missing.parsed.status, 'fabric_not_found_in_current_catalog');

  const ambiguous = await importer.resolveAshleyFabric(fabricResolverHarness([
    current,
    { ...current, id: 8, documentId: 'second-alaska-id', publishedAt: '2026-01-01T00:00:00.000Z' },
  ]), resolvedFabricInput());
  assert.equal(ambiguous.parsed.status, 'ambiguous_catalog_fabric');

  const draftPublished = await importer.resolveAshleyFabric(fabricResolverHarness([
    { ...current, id: 9, publishedAt: '2026-01-01T00:00:00.000Z' },
    { ...current, id: 10, publishedAt: null },
  ]), resolvedFabricInput());
  assert.equal(draftPublished.parsed.status, 'mapped');
  assert.equal(draftPublished.fabric.id, 10);

  const portable = structuredClone(fixtures().colourMap);
  delete portable.products.ash.fabricDocumentId;
  mapping.validateColourMap(portable);
  assert.equal(portable.products.ash.fabricName, 'Ash');
});

test('mapping uses longest exact product prefix and variable-length suffixes', () => {
  const { colourMap } = fixtures();
  assert.deepEqual(mapping.parseFilename('ASHBLUE12.jpg', colourMap), {
    status: 'matched', filename: 'ASHBLUE12.jpg', productKey: 'ash', productName: 'Ash',
    supplierProductCode: 'ASH', fabricName: 'Ash', approvedAliases: [], fabricDocumentId: 'fabric-ash', supplierColourCode: 'BLUE12',
    supplierColourName: 'Ocean', internalColourCode: 'AW0001',
  });
  const longest = mapping.parseFilename('ASHLEYX.webp', colourMap);
  assert.equal(longest.productKey, 'ashley');
  assert.equal(longest.supplierColourCode, 'X');
});

test('mapping reports unknown product, unresolved colour, unsupported and ambiguous names', () => {
  const { colourMap } = fixtures();
  assert.equal(mapping.parseFilename('OTHERX.jpg', colourMap).status, 'unknown_mapping_product');
  assert.equal(mapping.parseFilename('ASHLEYTODO.jpg', colourMap).status, 'unknown_colour_code');
  assert.equal(mapping.parseFilename('notes.txt', colourMap).status, 'unsupported_file');
  const ambiguous = structuredClone(colourMap);
  ambiguous.products.second = { ...ambiguous.products.ashley, supplierProductCode: 'OTHER', fabricDocumentId: 'other' };
  assert.equal(mapping.parseFilename('ASHLEYX.jpg', ambiguous).status, 'ambiguous_filename');
});

test('invalid production shapes and inconsistent global codes fail clearly', () => {
  assert.throws(() => mapping.validateColourMap({ schemaVersion: 2 }), /schemaVersion/);
  const values = fixtures();
  values.codeRegistry.codes.AW0001.colourName = 'Different';
  assert.throws(() => mapping.loadProductionMappings(values), /conflicting colour name/);
});

test('manifest fingerprint is deterministic, nested-path aware, and changes with content', () => {
  const one = { relativePath: 'Folder/nested/a.jpg', sha256: 'a'.repeat(64), size: 1 };
  const two = { relativePath: 'Folder/b.jpg', sha256: 'b'.repeat(64), size: 1 };
  const first = importer.manifestFingerprint([one, two]);
  assert.equal(first, importer.manifestFingerprint([two, one]));
  assert.notEqual(first, importer.manifestFingerprint([one, { ...two, sha256: 'c'.repeat(64) }]));
  assert.throws(() => importer.normalizeManifest([{ ...one, relativePath: '../secret.jpg' }]), /invalid/);
});

test('logical draft/published rows deduplicate by documentId and prefer draft', () => {
  const rows = importer.logicalRows([
    { id: 1, documentId: 'same', publishedAt: '2026-01-01' },
    { id: 2, documentId: 'same', publishedAt: null },
    { id: 3, documentId: 'other', publishedAt: null },
  ]);
  assert.deepEqual(rows.map((row) => row.id), [2, 3]);
});

test('summary accounts for duplicates, unresolved, conflicts, ready and complete files', () => {
  const summary = importer.summaryForRows([
    { status: 'would_upload_and_link' }, { status: 'already_complete' },
    { status: 'duplicate_in_folder' }, { status: 'unknown_mapping_product' },
    { status: 'thumbnail_conflict' }, { status: 'unsupported_file' },
  ]);
  assert.equal(summary.totalFiles, 6);
  assert.equal(summary.readyFiles, 1);
  assert.equal(summary.alreadyCompleteFiles, 1);
  assert.equal(summary.unresolvedFiles, 1);
  assert.equal(summary.conflictFiles, 1);
  assert.equal(summary.skippedFiles, 2);
});

test('Ashley Wilde staging keeps duplicate official names and assets fabric-specific without touching Colour', async () => {
  const { strapi, colours, identities, assets, files } = colourIdentityHarness();
  const mappings = colourIdentityMappings();
  const berkeleyBuffer = Buffer.from('berkeley-thumbnail');
  const cheringtonBuffer = Buffer.from('cherington-thumbnail');
  const descriptors = [
    { name: 'BERKELEYDO.jpg', relativePath: 'Berkeley/BERKELEYDO.jpg', buffer: berkeleyBuffer, size: berkeleyBuffer.length, mimeType: 'image/jpeg' },
    { name: 'CHERINGTONDO.jpg', relativePath: 'Cherington/CHERINGTONDO.jpg', buffer: cheringtonBuffer, size: cheringtonBuffer.length, mimeType: 'image/jpeg' },
  ];
  const manifest = descriptors.map((descriptor) => ({
    relativePath: descriptor.relativePath,
    sha256: crypto.createHash('sha256').update(descriptor.buffer).digest('hex'),
    size: descriptor.size,
  }));
  const body = {
    folderName: 'duplicate-official-names',
    folderFingerprint: importer.manifestFingerprint(manifest),
    folderManifest: JSON.stringify(manifest),
    fileMetadata: JSON.stringify(manifest),
    finalBatch: 'true',
  };

  await importer.processBatch(strapi, descriptors, body, { mappings });
  assert.equal(colours.length, 0);
  assert.equal(identities.length, 2);
  assert.deepEqual(identities.map((identity) => ({
    officialColourName: identity.officialColourName,
    fabricDocumentId: identity.fabricDocumentId,
    supplierProductCode: identity.supplierProductCode,
    supplierColourCode: identity.supplierColourCode,
    fabricColourCode: identity.fabricColourCode,
    mappingStatus: identity.mappingStatus,
  })), [
    { officialColourName: 'Dove', fabricDocumentId: 'fabric-berkeley', supplierProductCode: 'BERKELEY', supplierColourCode: 'DO', fabricColourCode: 'BERKELEYDO', mappingStatus: 'pending' },
    { officialColourName: 'Dove', fabricDocumentId: 'fabric-cherington', supplierProductCode: 'CHERINGTON', supplierColourCode: 'DO', fabricColourCode: 'CHERINGTONDO', mappingStatus: 'pending' },
  ]);
  assert.equal(assets.length, 2);
  assert.equal(files.length, 2);

  const identityIds = identities.map((identity) => identity.id);
  const assetIds = assets.map((asset) => asset.id);
  await importer.processBatch(strapi, descriptors, body, { mappings });
  assert.equal(colours.length, 0);
  assert.deepEqual(identities.map((identity) => identity.id), identityIds);
  assert.deepEqual(assets.map((asset) => asset.id), assetIds);
  assert.equal(files.length, 2);

  const source = fs.readFileSync(path.join(__dirname, '../src/plugins/order-management/server/services/ashley-wilde-import.js'), 'utf8');
  assert.doesNotMatch(source, /api::colour\.colour/);
  assert.match(source, /api::fabric-colour-identity\.fabric-colour-identity/);
  assert.match(source, /api::fabric-colour-asset\.fabric-colour-asset/);
});

test('map-builder scans nested current fixtures, writes no output without refresh, and never crawls implicitly', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aw-map-'));
  try {
    await fs.promises.mkdir(path.join(root, 'nested'));
    await fs.promises.writeFile(path.join(root, 'nested', 'ASHBLUE12.jpg'), 'image');
    await fs.promises.writeFile(path.join(root, 'notes.txt'), 'ignore');
    const result = await buildMap({ rootDir: root, mappings: fixtures(), refresh: false });
    assert.equal(result.scanned, 2);
    assert.equal(result.indexed, 1);
    assert.equal(result.imageIndex.images['nested/ASHBLUE12.jpg'].sha256, crypto.createHash('sha256').update('image').digest('hex'));
    await assert.rejects(buildMap({ rootDir: root, mappings: fixtures(), crawl: true }), /crawl adapter/);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('admin component preserves relative paths, directory selection, sequential batches and history refresh', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/plugins/order-management/admin/src/components/AshleyWildeFolderImporter.jsx'), 'utf8');
  assert.match(source, /webkitdirectory/);
  assert.match(source, /for \(let index = 0; index < batches\.length; index \+= 1\)/);
  assert.match(source, /await refreshHistory\(\)/);
  assert.match(source, /folderFingerprint/);
  assert.match(source, /unresolved or conflicting/);
});

test('Ashley folder analysis uses the complete server catalogue without an unpaginated browser fabric request', async () => {
  const bulkSource = fs.readFileSync(path.join(__dirname, '../src/plugins/order-management/admin/src/components/BulkImageUploader.jsx'), 'utf8');
  const ashleySource = fs.readFileSync(path.join(__dirname, '../src/plugins/order-management/admin/src/components/AshleyWildeFolderImporter.jsx'), 'utf8');
  assert.doesNotMatch(bulkSource, /\/api\/fabrics\?populate=\*/);
  assert.match(bulkSource, /fetchAllFabrics\(\{ fetchImpl: fetch, headers: getAuthHeaders\(\), populate: '\*' \}\)/);
  assert.doesNotMatch(ashleySource, /\/api\/fabrics|fabric(?:Ids?|Names?)\s*:/i);
  assert.match(ashleySource, /adminCatalogRoutes\.ashleyWildeAnalyse,\s*\{\s*folderName, folderFingerprint, manifest,\s*\}/);

  const targetNames = ['Alaska', 'Arezzo', 'Berkeley', 'Cherington', 'Baltic'];
  const fabrics = [
    ...Array.from({ length: 25 }, (_, index) => ({ id: index + 1, documentId: `other-${index}`, name: `Other ${index}`, brand: { name: 'Ashley Wilde' } })),
    ...targetNames.map((name, index) => ({ id: index + 26, documentId: `fabric-${name.toLowerCase()}`, name, brand: { name: 'Ashley Wilde' } })),
  ];
  const batches = [];
  const strapi = {
    dirs: { static: { public: path.join(os.tmpdir(), 'aw-complete-catalogue-public') } },
    entityService: {
      async findMany(uid, query = {}) {
        if (uid === 'api::fabric.fabric') {
          const name = String(query.filters?.name?.$eqi || '').toLowerCase();
          return fabrics.filter((fabric) => fabric.name.toLowerCase() === name);
        }
        if (uid === 'api::image-import-batch.image-import-batch') return batches.filter((batch) => batch.folderFingerprint === query.filters?.folderFingerprint);
        return [];
      },
      async create(uid, { data }) {
        assert.equal(uid, 'api::image-import-batch.image-import-batch');
        const batch = { id: batches.length + 1, ...data };
        batches.push(batch);
        return batch;
      },
      async update(uid, id, { data }) {
        assert.equal(uid, 'api::image-import-batch.image-import-batch');
        const batch = batches.find((item) => item.id === id);
        Object.assign(batch, data);
        return batch;
      },
    },
  };
  const selectedPaths = [
    'ALASKAAQ.jpg', 'Alaska Flat Shots/ALASKAAQ.jpg', 'Alaska Flat Shots/ALASKAMA.jpg',
    'Atlantic Flat Shots/BALTICAQ.jpg', 'Portofino Flat Shots/AREZZOIN.jpg',
    'Caversham/Flats/BERKELEYCA copy.jpg', 'Caversham/Flats/BERKELEYDO copy.jpg',
    'Caversham/Flats/CHERINGTONDO copy.jpg',
  ];
  const duplicateHash = crypto.createHash('sha256').update('alaska-aqua').digest('hex');
  const manifest = selectedPaths.map((relativePath, index) => ({
    relativePath,
    size: 100 + index,
    sha256: index < 2 ? duplicateHash : crypto.createHash('sha256').update(relativePath).digest('hex'),
  }));
  const folderFingerprint = importer.manifestFingerprint(manifest);
  const priorMode = process.env.ASHLEY_WILDE_MAPPING_MODE;
  process.env.ASHLEY_WILDE_MAPPING_MODE = 'pilot';
  try {
    const result = await importer.analyseFolder(strapi, { folderName: 'Ashley pilot', folderFingerprint, manifest });
    assert.deepEqual(result.summary, {
      totalFiles: 8, matchedFiles: 7, readyFiles: 6, alreadyCompleteFiles: 0,
      skippedFiles: 1, unresolvedFiles: 1, conflictFiles: 0,
    });
    assert.deepEqual(new Set(result.rows.filter((row) => row.resolvedFabricDocumentId).map((row) => row.fabricName)), new Set(targetNames));
    assert.equal(result.rows.find((row) => row.filename === 'ALASKAMA.jpg').status, 'unknown_colour_code');
    assert.equal(result.rows.filter((row) => row.status === 'duplicate_in_folder').length, 1);
  } finally {
    if (priorMode === undefined) delete process.env.ASHLEY_WILDE_MAPPING_MODE;
    else process.env.ASHLEY_WILDE_MAPPING_MODE = priorMode;
  }
});

test('pilot reset requires confirmation and never targets the normal database', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aw-pilot-reset-'));
  try {
    await fs.promises.mkdir(path.join(root, '.tmp'), { recursive: true });
    await fs.promises.writeFile(path.join(root, '.tmp', 'data.db'), 'normal');
    await fs.promises.writeFile(path.join(root, '.tmp', 'ashley-wilde-pilot.db'), 'pilot');
    const dry = await resetPilotArtifacts({ rootDir: root });
    assert.equal(dry.confirmed, false);
    assert.equal(fs.existsSync(path.join(root, '.tmp', 'ashley-wilde-pilot.db')), true);
    await resetPilotArtifacts({ rootDir: root, confirm: true });
    assert.equal(fs.existsSync(path.join(root, '.tmp', 'ashley-wilde-pilot.db')), false);
    assert.equal(fs.existsSync(path.join(root, '.tmp', 'data.db')), true);
    assert.ok(pilotTargets(root).every((target) => target.includes(`${path.sep}.tmp${path.sep}ashley-wilde-pilot`)));
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});
