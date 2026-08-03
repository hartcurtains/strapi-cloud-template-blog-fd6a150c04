'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { after, before, test } = require('node:test');
const importer = require('../src/plugins/order-management/server/services/ashley-wilde-import');

const previousSecret = process.env.STRAPI_INTERNAL_SECURITY_SECRET;
const activeMappingVersion = {
  documentId: 'ashley-active-import',
  supplier: 'Ashley Wilde',
  status: 'active',
  isActive: true,
  version: 'ashley-active-v1',
  schemaVersion: 1,
  importedAt: '2026-08-03T00:00:00.000Z',
  sourcePayload: {
    schemaVersion: 1,
    supplier: 'Ashley Wilde',
    mappingVersion: 'ashley-active-v1',
    fabrics: [{ fabricName: 'Alaska', fabricDocumentId: 'okwshze5maa8f02rmu0v5azq', supplierProductCode: 'ALASKA' }],
  },
};
const activeMappingRows = [{
  supplier: 'Ashley Wilde',
  fabricName: 'Alaska',
  fabricDocumentId: 'okwshze5maa8f02rmu0v5azq',
  supplierProductCode: 'ALASKA',
  supplierColourCode: 'AQ',
  officialColourName: 'Aqua',
  internalColourCode: 'AQ',
  evidenceStatus: 'verified_official',
  source: 'test active mapping',
}];
before(() => { process.env.STRAPI_INTERNAL_SECURITY_SECRET = 'two-phase-test-secret'; });
after(() => {
  if (previousSecret === undefined) delete process.env.STRAPI_INTERNAL_SECURITY_SECRET;
  else process.env.STRAPI_INTERNAL_SECURITY_SECRET = previousSecret;
});

function renewAnalysisToken(token) {
  const [, encoded] = token.split('.');
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  payload.expiresAt += 1;
  const renewedEncoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', process.env.STRAPI_INTERNAL_SECURITY_SECRET).update(renewedEncoded, 'utf8').digest('base64url');
  return `aw-analysis.${renewedEncoded}.${signature}`;
}

function stableMediaBinding({ supplier = 'Ashley Wilde', adminId, folderFingerprint, relativePath, fileFingerprint }) {
  const payload = [supplier.toLowerCase(), adminId, folderFingerprint.toLowerCase(), relativePath, fileFingerprint.toLowerCase()].join('\0');
  const signature = crypto.createHmac('sha256', process.env.STRAPI_INTERNAL_SECURITY_SECRET).update(payload, 'utf8').digest('base64url');
  return `aw-ashley:v2:${signature}:${folderFingerprint}:${relativePath}:${fileFingerprint}`;
}

function twoPhaseFixture({ badCaption = false, emptyMedia = false, failAssetOnce = false, reanalysed = false } = {}) {
  const relativePath = 'Ashley/ALASKAAQ.jpg';
  const fileFingerprint = 'a'.repeat(64);
  const fileSize = 2_981_739;
  const folderFingerprint = importer.manifestFingerprint([{ relativePath, sha256: fileFingerprint, size: fileSize }]);
  const analysisToken = importer.createAnalysisToken({
    supplier: 'Ashley Wilde',
    mappingImportDocumentId: activeMappingVersion.documentId,
    mappingVersion: activeMappingVersion.version,
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
  const uploadAnalysisToken = analysisToken;
  const currentAnalysisToken = reanalysed ? renewAnalysisToken(uploadAnalysisToken) : uploadAnalysisToken;
  const media = {
    id: 123,
    documentId: 'media-123',
    name: 'ALASKAAQ.jpg',
    mime: 'image/jpeg',
    // Strapi's default Media settings optimize uploaded images, so persisted
    // size is not expected to equal the pre-upload analysis size.
    size: emptyMedia ? 0 : 1_234.57,
    caption: badCaption ? 'wrong-binding' : stableMediaBinding({
      adminId: 'admin-1',
      folderFingerprint,
      relativePath,
      fileFingerprint,
    }),
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
        if (uid === 'api::supplier-mapping-import.supplier-mapping-import') return [activeMappingVersion];
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
      if (uid === 'api::supplier-fabric-colour-mapping.supplier-fabric-colour-mapping') return { async findMany() { return activeMappingRows; } };
      throw new Error(`Unexpected documents API ${uid}`);
    },
  };
  const body = {
    supplier: 'Ashley Wilde',
    analysisToken: currentAnalysisToken,
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
  const response = await importer.finaliseAshleyWildeMedia(fixture.strapi, fixture.body, { adminId: 'admin-1', traceId: 'aw_folder01*file0001*2' });
  assert.equal(response.result.phase, 'complete');
  assert.equal(response.result.mediaId, 123);
  assert.equal(fixture.assets[0].media, 123);
  assert.ok(!fixture.writes.some((write) => write.data?.buffer || write.data?.files));
  assert.equal(fixture.batches[0].manifestSummary.resultsByPath['Ashley/ALASKAAQ.jpg'].traceId, 'aw_folder01*file0001*2');
  assert.equal(fixture.batches[0].manifestSummary.resultsByPath['Ashley/ALASKAAQ.jpg'].attempt, 2);
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
  await assert.rejects(() => importer.finaliseAshleyWildeMedia(fixture.strapi, fixture.body, { adminId: 'admin-1' }), /The image was uploaded, but its staged fabric-colour link still needs to be completed/);
  const firstIdentityCount = fixture.identities.length;
  const response = await importer.finaliseAshleyWildeMedia(fixture.strapi, fixture.body, { adminId: 'admin-1' });
  assert.equal(response.result.phase, 'complete');
  assert.equal(fixture.identities.length, firstIdentityCount);
  assert.equal(fixture.assets.length, 1);
});

test('empty optimized Media is rejected before staging writes', async () => {
  const fixture = twoPhaseFixture({ emptyMedia: true });
  await assert.rejects(
    () => importer.finaliseAshleyWildeMedia(fixture.strapi, fixture.body, { adminId: 'admin-1' }),
    (error) => error.code === 'ASHLEY_WILDE_MEDIA_INVALID',
  );
  assert.equal(fixture.assets.length, 0);
});

test('re-analysis retry accepts the stable server-signed Media binding', async () => {
  const fixture = twoPhaseFixture({ reanalysed: true });
  const response = await importer.finaliseAshleyWildeMedia(fixture.strapi, fixture.body, { adminId: 'admin-1' });
  assert.equal(response.result.phase, 'complete');
  assert.equal(response.result.mediaId, 123);
  assert.equal(fixture.assets.length, 1);
});

test('refresh recovery finds the bound uploaded Media without image bytes', async () => {
  const fixture = twoPhaseFixture();
  const lookup = await importer.getAshleyWildeMediaStatus(fixture.strapi, { ...fixture.body, mediaId: undefined, mediaDocumentId: undefined }, { adminId: 'admin-1' });
  assert.equal(lookup.result.phase, 'media_uploaded');
  assert.equal(lookup.result.mediaId, 123);
  assert.equal(fixture.assets.length, 0);
  assert.ok(!fixture.writes.some((write) => write.data?.buffer || write.data?.files));
});

test('refresh recovery still finds the same server-bound Media after re-analysis', async () => {
  const fixture = twoPhaseFixture({ reanalysed: true });
  const lookup = await importer.getAshleyWildeMediaStatus(fixture.strapi, { ...fixture.body, mediaId: undefined, mediaDocumentId: undefined }, { adminId: 'admin-1' });
  assert.equal(lookup.result.phase, 'media_uploaded');
  assert.equal(lookup.result.mediaId, 123);
});

test('upload failure records retryable progress without calling finalisation or creating staging rows', async () => {
  const fixture = twoPhaseFixture();
  const response = await importer.recordAshleyWildeProgress(fixture.strapi, {
    ...fixture.body,
    phase: 'retryable_upload_failure',
    errorCode: 'ASHLEY_WILDE_UPSTREAM_UNAVAILABLE',
  }, { adminId: 'admin-1' });
  assert.equal(response.result.phase, 'retryable_upload_failure');
  assert.equal(fixture.assets.length, 0);
  assert.equal(fixture.identities.length, 0);
  assert.equal(fixture.batches[0].manifestSummary.resultsByPath['Ashley/ALASKAAQ.jpg'].phase, 'retryable_upload_failure');
});
