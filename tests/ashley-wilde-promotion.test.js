'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const supplierMappings = require('../src/plugins/order-management/server/services/supplier-mapping');
const promotion = require('../src/plugins/order-management/server/services/ashley-wilde-promotion');

const IDENTITY_UID = 'api::fabric-colour-identity.fabric-colour-identity';
const ASSET_UID = 'api::fabric-colour-asset.fabric-colour-asset';
const COLOUR_UID = 'api::colour.colour';

test('confirmed promotion writes Strapi Entity Service relation IDs and commits the reviewed identity', async () => {
  const originalActiveMappings = supplierMappings.getActiveImporterMappings;
  const originalLoadRegistry = supplierMappings.loadRegistry;
  const fabric = { id: 101, documentId: 'fabric-tunbridge', name: 'Tunbridge' };
  const media = { id: 301, documentId: 'media-danube' };
  const asset = {
    id: 201,
    documentId: 'asset-danube',
    updatedAt: '2026-07-29T10:00:00.000Z',
    sha256: 'abc123',
    importStatus: 'staged',
    duplicateStatus: 'unique',
    assetType: 'ordinary_colour',
    media,
  };
  const identity = {
    id: 1,
    documentId: 'identity-danube',
    updatedAt: '2026-07-29T10:00:00.000Z',
    identityKey: 'ashley-wilde|fabric-tunbridge|tunbridge|da',
    mappingStatus: 'verified',
    evidenceStatus: 'verified_official',
    mappingVersion: 'mapping-v1',
    supplier: 'Ashley Wilde',
    fabric,
    fabricDocumentId: fabric.documentId,
    supplierProductCode: 'TUNBRIDGE',
    supplierColourCode: 'DA',
    fabricColourCode: 'TUNBRIDGEDA',
    officialColourName: 'Danube',
    internalColourCode: 'DAN',
    promotedColour: null,
    assets: [asset],
  };
  const writes = [];
  const strapi = {
    db: {
      transaction: async (callback) => callback({ trx: { transaction: true } }),
    },
    entityService: {
      findMany: async (uid) => {
        if (uid === IDENTITY_UID) return [identity];
        if (uid === COLOUR_UID) return [];
        throw new Error(`Unexpected findMany ${uid}`);
      },
      findOne: async (uid, id) => {
        assert.equal(uid, IDENTITY_UID);
        assert.equal(id, identity.id);
        return identity;
      },
      create: async (uid, options) => {
        assert.equal(uid, COLOUR_UID);
        writes.push({ operation: 'create', uid, options });
        return {
          id: 401,
          documentId: 'colour-danube',
          name: 'Danube',
          thumbnail: media,
          fabrics: [fabric],
        };
      },
      update: async (uid, id, options) => {
        writes.push({ operation: 'update', uid, id, options });
        return { id, ...options.data };
      },
    },
  };

  supplierMappings.getActiveImporterMappings = async () => ({
    version: { documentId: 'mapping-v1', version: 'mapping-v1' },
  });
  supplierMappings.loadRegistry = async () => ({
    byCode: new Map([['DAN', { canonicalColourName: 'Danube' }]]),
  });

  try {
    const scope = {
      supplier: 'Ashley Wilde',
      fabricName: 'Tunbridge',
      supplierProductCode: 'TUNBRIDGE',
    };
    const preview = await promotion.previewPromotion(strapi, scope);
    assert.equal(preview.summary.eligible, 1);

    const result = await promotion.promoteVerified(strapi, {
      ...scope,
      commit: true,
      confirm: true,
      planFingerprint: preview.planFingerprint,
      planExpiresAt: preview.planExpiresAt,
      identityDocumentIds: preview.identityDocumentIds,
    });

    assert.equal(result.summary.blocked, 0);
    assert.equal(result.summary.newColours, 1);
    assert.equal(result.results[0].committed, true);
    const colourCreate = writes.find((write) => write.operation === 'create' && write.uid === COLOUR_UID);
    assert.equal(colourCreate.options.data.thumbnail, media.id);
    assert.deepEqual(colourCreate.options.data.fabrics, [fabric.id]);
    const identityUpdate = writes.find((write) => write.operation === 'update' && write.uid === IDENTITY_UID);
    assert.deepEqual(identityUpdate.options.data.promotedColour, { connect: [401] });
    const assetUpdate = writes.find((write) => write.operation === 'update' && write.uid === ASSET_UID);
    assert.equal(assetUpdate.options.data.importStatus, 'promoted');
  } finally {
    supplierMappings.getActiveImporterMappings = originalActiveMappings;
    supplierMappings.loadRegistry = originalLoadRegistry;
  }
});
