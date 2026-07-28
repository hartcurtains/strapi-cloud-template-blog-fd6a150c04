'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { after, before, test } = require('node:test');
const importer = require('../src/plugins/order-management/server/services/ashley-wilde-import');

const previousSecret = process.env.STRAPI_INTERNAL_SECURITY_SECRET;
before(() => { process.env.STRAPI_INTERNAL_SECURITY_SECRET = 'two-phase-test-secret'; });
after(() => {
  if (previousSecret === undefined) delete process.env.STRAPI_INTERNAL_SECURITY_SECRET;
  else process.env.STRAPI_INTERNAL_SECURITY_SECRET = previousSecret;
});

function twoPhaseFixture({ badCaption = false, failAssetOnce = false } = {}) {
  const relativePath = 'Ashley/ALASKAAQ.jpg';
  const fileFingerprint = 'a'.repeat(64);
  const fileSize = 123;
  const folderFingerprint = importer.manifestFingerprint([{ relativePath, sha256: fileFingerprint, size: fileSize }]);
  const analysisToken = importer.createAnalysisToken({
    mappingImportDocumentId: null,
    mappingVersion: null,
    manifestFingerprint: folderFingerprint,
    manifestFileCount: 1,
    analyzedPaths: [relativePath],
    analyzedFiles: [{
      relativePath,
      sha256: fileFingerprint,
      size: fileSize,
      mimeType: 'image/jpeg',
      status: 'matched',
      supplierProductCode: 'ALASKA',
      supplierColourCode: 'AQ',
      supplierColourName: 'Aqua',
      internalColourCode: 'AQ',
      fabricDocumentId: 'okwshze5maa8f02rmu0v5azq',
    }],
    adminId: 'admin-1',
  });
  const media = {
    id: 123,
    documentId: 'media-123',
    name: 'ALASKAAQ.jpg',
    mime: 'image/jpeg',
    size: fileSize / 1024,
    caption: badCaption ? 'wrong-binding' : `aw-ashley:${analysisToken.split('.').pop()}:${folderFingerprint}:${relativePath}:${fileFingerprint}`,
    createdBy: { id: 'admin-1' },
  };
  const identities = [];
  const assets = [];
  const batches = [];
  let assetFailurePending = failAssetOnce;
  const writes = [];
  const strapi = {
    log: { info() {} },
    entityService: {
      async findMany(uid, query = {}) {
        if (uid === 'api::supplier-mapping-import.supplier-mapping-import') return [];
        if (uid === 'api::fabric.fabric') return [{ documentId: 'okwshze5maa8f02rmu0v5azq', name: 'Alaska', brand: { name: 'Ashley Wilde' } }];
        if (uid === 'api::fabric-colour-identity.fabric-colour-identity') return identities.filter((row) => !query.filters?.identityKey || row.identityKey === query.filters.identityKey.$eq);
        if (uid === 'api::fabric-colour-asset.fabric-colour-asset') {
          if (query.filters?.assetKey) return assets.filter((row) => row.assetKey === query.filters.assetKey.$eq);
          if (query.filters?.normalizedFilename) return assets.filter((row) => row.normalizedFilename === query.filters.normalizedFilename.$eq);
          return assets;
        }
        if (uid === 'api::image-import-batch.image-import-batch') return batches.filter((row) => row.folderFingerprint === query.filters?.folderFingerprint);
        if (uid === 'plugin::upload.file') return [media];
        return [];
      },
      async create(uid, { data }) {
        writes.push({ operation: 'create', uid, data });
        if (uid === 'api::image-import-batch.image-import-batch') {
          const row = { id: batches.length + 1, ...data };
          batches.push(row);
          return row;
        }
        if (uid === 'api::fabric-colour-identity.fabric-colour-identity') {
          const row = { id: identities.length + 1, documentId: `identity-${identities.length + 1}`, ...data };
          identities.push(row);
          return row;
        }
        if (uid === 'api::fabric-colour-asset.fabric-colour-asset') {
          if (assetFailurePending) {
            assetFailurePending = false;
            throw new Error('simulated finalisation failure');
          }
          const row = { id: assets.length + 1, documentId: `asset-${assets.length + 1}`, ...data };
          assets.push(row);
          return row;
        }
        throw new Error(`Unexpected create ${uid}`);
      },
      async update(uid, id, { data }) {
        writes.push({ operation: 'update', uid, id, data });
        const row = batches.find((item) => item.id === id);
        if (row) Object.assign(row, data);
        return row || data;
      },
    },
    documents(uid) {
      if (uid === 'api::supplier-fabric-colour-mapping.supplier-fabric-colour-mapping') return { async findMany() { return []; } };
      throw new Error(`Unexpected documents API ${uid}`);
    },
  };
  const body = {
    analysisToken,
    manifestFileCount: 1,
    folderName: 'Ashley',
    folderFingerprint,
    relativePath,
    originalFilename: 'ALASKAAQ.jpg',
    fileFingerprint,
    fileSize,
    mimeType: 'image/jpeg',
    supplierProductCode: 'ALASKA',
    supplierColourCode: 'AQ',
    fabricDocumentId: 'okwshze5maa8f02rmu0v5azq',
    mediaId: 123,
    mediaDocumentId: 'media-123',
  };
  return { strapi, body, writes, identities, assets, batches };
}

test('JSON finalisation validates the Media record and stages it without image bytes', async () => {
  const fixture = twoPhaseFixture();
  const response = await importer.finaliseAshleyWildeMedia(fixture.strapi, fixture.body, { adminId: 'admin-1' });
  assert.equal(response.result.phase, 'complete');
  assert.equal(response.result.mediaId, 123);
  assert.equal(fixture.assets[0].media, 123);
  assert.ok(!fixture.writes.some((write) => write.data?.buffer || write.data?.files));
});

test('arbitrary Media identity injection is rejected before staging writes', async () => {
  const fixture = twoPhaseFixture({ badCaption: true });
  await assert.rejects(
    () => importer.finaliseAshleyWildeMedia(fixture.strapi, fixture.body, { adminId: 'admin-1' }),
    (error) => error.code === 'ASHLEY_WILDE_MEDIA_INVALID',
  );
  assert.equal(fixture.assets.length, 0);
  assert.equal(fixture.identities.length, 0);
  assert.equal(fixture.batches.length, 0);
});

test('finalisation retry reuses the uploaded Media and does not duplicate the identity', async () => {
  const fixture = twoPhaseFixture({ failAssetOnce: true });
  await assert.rejects(() => importer.finaliseAshleyWildeMedia(fixture.strapi, fixture.body, { adminId: 'admin-1' }), /Image uploaded; staging link still needs to be completed/);
  const firstIdentityCount = fixture.identities.length;
  const response = await importer.finaliseAshleyWildeMedia(fixture.strapi, fixture.body, { adminId: 'admin-1' });
  assert.equal(response.result.phase, 'complete');
  assert.equal(fixture.identities.length, firstIdentityCount);
  assert.equal(fixture.assets.length, 1);
});

test('refresh recovery finds the bound uploaded Media without image bytes', async () => {
  const fixture = twoPhaseFixture();
  const lookup = await importer.finaliseAshleyWildeMedia(fixture.strapi, { ...fixture.body, phase: 'lookup_media', mediaId: undefined, mediaDocumentId: undefined }, { adminId: 'admin-1' });
  assert.equal(lookup.result.phase, 'media_uploaded');
  assert.equal(lookup.result.mediaId, 123);
  assert.equal(fixture.assets.length, 0);
  assert.ok(!fixture.writes.some((write) => write.data?.buffer || write.data?.files));
});
