'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const supplierMappings = require('../src/plugins/order-management/server/services/supplier-mapping');
const promotion = require('../src/plugins/order-management/server/services/ashley-wilde-promotion');

const IDENTITY_UID = 'api::fabric-colour-identity.fabric-colour-identity';
const ASSET_UID = 'api::fabric-colour-asset.fabric-colour-asset';
const COLOUR_UID = 'api::colour.colour';

test('existing Colour detection is scoped to the canonical colour name on one Fabric', () => {
  const identity = {
    officialColourName: 'Flax',
    fabric: {
      documentId: 'fabric-legacy',
      colours: [
        { documentId: 'existing-flax', name: ' Flax ' },
        { documentId: 'existing-ocean', name: 'Ocean' },
      ],
    },
  };
  const matching = { colour: promotion.existingFabricColour(identity), alreadyLinkedToFabric: true };
  assert.equal(matching.colour.documentId, 'existing-flax');
  assert.deepEqual(promotion.existingColourScopeReasons(matching), ['colour_already_exists_for_fabric']);
  assert.equal(promotion.existingFabricColour({ ...identity, officialColourName: 'Danube' }), null);
  assert.deepEqual(promotion.existingColourScopeReasons({ colour: null, alreadyLinkedToFabric: false }), []);
});

test('an explicitly staged replacement makes only its existing Colour thumbnail eligible for update', () => {
  const matching = {
    colour: { id: 401, documentId: 'colour-maidenhair-ink', name: 'Ink', thumbnail: { id: 501 } },
    alreadyLinkedToFabric: true,
    conflict: false,
    priority: 'fabric_canonical_colour_name',
  };
  const replacement = {
    id: 211,
    documentId: 'asset-maidenhair-ink',
    importStatus: 'staged',
    duplicateStatus: 'unique',
    assetType: 'ordinary_colour',
    media: { id: 311, documentId: 'media-maidenhair-ink-new' },
    referenceMetadata: { replaceExistingImage: true },
  };
  const eligible = { eligible: true, reasons: [], approvedAssets: [replacement] };
  const identity = {
    documentId: 'identity-maidenhair-ink',
    identityKey: 'ashley-wilde|fabric-maidenhair|maidenhair|in',
    mappingStatus: 'verified', evidenceStatus: 'verified_official',
    fabric: { documentId: 'fabric-maidenhair', name: 'Maidenhair' },
    fabricDocumentId: 'fabric-maidenhair', supplierProductCode: 'MAIDENHAIR', supplierColourCode: 'IN',
    fabricColourCode: 'MAIDENHAIRIN', officialColourName: 'Ink', internalColourCode: 'INK',
  };

  assert.deepEqual(promotion.existingColourScopeReasons(matching, eligible), []);
  const plan = promotion.buildPlan(identity, matching, eligible);
  assert.equal(plan.eligible, true);
  assert.equal(plan.action, 'update_existing_colour_image');
  assert.equal(plan.colourDecision, 'update_existing_colour_thumbnail');
  assert.equal(plan.assetDecision, 'replace_existing_thumbnail');
  assert.equal(plan.replacesExistingImage, true);
  assert.equal(plan.preserveExistingThumbnail, false);
});

test('bulk preview skips only an existing Colour and keeps a missing sibling eligible', async () => {
  const fabric = {
    id: 111,
    documentId: 'fabric-legacy',
    name: 'Legacy',
    colours: [{ id: 999, documentId: 'existing-flax', name: 'Flax' }],
  };
  const identity = (overrides) => ({
    id: 11,
    documentId: 'identity-flax',
    identityKey: 'ashley-wilde|fabric-legacy|legacy|fl',
    mappingStatus: 'verified',
    evidenceStatus: 'verified_official',
    supplier: 'Ashley Wilde',
    fabric,
    fabricDocumentId: 'fabric-legacy',
    supplierProductCode: 'LEGACY',
    supplierColourCode: 'FL',
    fabricColourCode: 'LEGACYFL',
    officialColourName: 'Flax',
    internalColourCode: 'FX',
    assets: [{
      id: 211,
      documentId: 'asset-flax',
      importStatus: 'staged',
      duplicateStatus: 'unique',
      assetType: 'ordinary_colour',
      media: { id: 311, documentId: 'media-flax' },
    }],
    ...overrides,
  });
  const flax = identity({});
  const danube = identity({
    id: 12,
    documentId: 'identity-danube',
    identityKey: 'ashley-wilde|fabric-legacy|legacy|da',
    supplierColourCode: 'DA',
    fabricColourCode: 'LEGACYDA',
    officialColourName: 'Danube',
    internalColourCode: 'DAN',
    assets: [{
      id: 212,
      documentId: 'asset-danube',
      importStatus: 'staged',
      duplicateStatus: 'unique',
      assetType: 'ordinary_colour',
      media: { id: 312, documentId: 'media-danube' },
    }],
  });
  const strapi = {
    entityService: {
      findMany: async (uid) => uid === IDENTITY_UID ? [flax, danube] : [],
    },
  };
  const mappings = {
    codeRegistry: { codes: { FX: { colourName: 'Flax' }, DAN: { colourName: 'Danube' } } },
    mappingVersion: 'mapping-v1',
    mappingSource: 'test',
  };

  const bulk = await promotion.previewPromotion(strapi, { mappings });
  assert.equal(bulk.summary.eligible, 1);
  assert.equal(bulk.summary.blocked, 1);
  assert.equal(bulk.summary.skippedExistingColours, 1);
  assert.equal(bulk.summary.skippedExistingFabrics, 1);
  const flaxResult = bulk.results.find((row) => row.identityDocumentId === flax.documentId);
  const danubeResult = bulk.results.find((row) => row.identityDocumentId === danube.documentId);
  assert.deepEqual(flaxResult.skippedReasons, ['colour_already_exists_for_fabric']);
  assert.equal(flaxResult.eligible, false);
  assert.equal(danubeResult.eligible, true);
  assert.equal(danubeResult.colourDecision, 'create_new_colour');
});

test('promotion fingerprint is stable when Strapi returns staged relations in a different order', async () => {
  const fabric = { id: 111, documentId: 'fabric-order', name: 'Order', colours: [] };
  const assets = [
    { id: 201, documentId: 'asset-a', sha256: 'aaa', importStatus: 'staged', duplicateStatus: 'unique', assetType: 'ordinary_colour', media: { id: 301, documentId: 'media-a' } },
    { id: 202, documentId: 'asset-b', sha256: 'bbb', importStatus: 'staged', duplicateStatus: 'unique', assetType: 'numbered_alternate', media: { id: 302, documentId: 'media-b' } },
  ];
  const identity = {
    id: 11,
    documentId: 'identity-order',
    updatedAt: '2026-07-30T06:00:00.000Z',
    identityKey: 'ashley-wilde|fabric-order|order|da',
    mappingStatus: 'verified',
    evidenceStatus: 'verified_official',
    mappingVersion: 'mapping-v1',
    supplier: 'Ashley Wilde',
    fabric,
    fabricDocumentId: fabric.documentId,
    supplierProductCode: 'ORDER',
    supplierColourCode: 'DA',
    fabricColourCode: 'ORDERDA',
    officialColourName: 'Danube',
    internalColourCode: 'DA',
    assets,
  };
  let reverse = false;
  const strapi = {
    entityService: {
      findMany: async (uid) => {
        if (uid === IDENTITY_UID) {
          reverse = !reverse;
          return [{ ...identity, assets: reverse ? [...assets].reverse() : [...assets] }];
        }
        if (uid === COLOUR_UID) return [];
        throw new Error(`Unexpected findMany ${uid}`);
      },
    },
  };
  const mappings = {
    codeRegistry: { codes: { DAN: { colourName: 'Danube' } } },
    mappingVersion: 'mapping-v1',
    mappingSource: 'test',
  };

  const first = await promotion.previewPromotion(strapi, { mappings });
  const second = await promotion.previewPromotion(strapi, { mappings });

  assert.equal(first.planFingerprint, second.planFingerprint);
  assert.deepEqual(first.results[0].stagedAssetDocumentIds, ['asset-a', 'asset-b']);
  assert.equal(first.results[0].stagedMediaId, 'media-a');
});

test('preview repairs a colliding staged code to the existing canonical code instead of blocking it', async () => {
  const fabric = { id: 111, documentId: 'fabric-flax', name: 'Flax Fabric', colours: [] };
  const identity = {
    id: 11,
    documentId: 'identity-flax-collision',
    identityKey: 'ashley-wilde|fabric-flax|flax|fl',
    mappingStatus: 'verified',
    evidenceStatus: 'verified_official',
    supplier: 'Ashley Wilde',
    fabric,
    fabricDocumentId: fabric.documentId,
    supplierProductCode: 'FLAX',
    supplierColourCode: 'FL',
    fabricColourCode: 'FLAXFL',
    officialColourName: 'Flax',
    internalColourCode: 'FL',
    assets: [{ id: 211, documentId: 'asset-flax-collision', importStatus: 'staged', duplicateStatus: 'unique', assetType: 'ordinary_colour', media: { id: 311, documentId: 'media-flax-collision' } }],
  };
  const strapi = { entityService: { findMany: async (uid) => uid === IDENTITY_UID ? [identity] : [] } };
  const mappings = {
    codeRegistry: { codes: { FL: { colourName: 'Flint' }, FX: { colourName: 'Flax' } } },
    mappingVersion: 'mapping-v1',
    mappingSource: 'test',
  };

  const preview = await promotion.previewPromotion(strapi, { mappings });

  assert.equal(preview.summary.eligible, 1);
  assert.equal(preview.summary.internalCodeCollisions?.length || 0, 0);
  assert.equal(preview.results[0].internalColourCode, 'FX');
  assert.equal(preview.results[0].internalCodeDecision, 'repair_to_canonical_code');
  assert.doesNotMatch(preview.results[0].skippedReasons.join(','), /internal_code/);
});

test('preview deterministically generates a safe code for a verified colour missing from the registry', async () => {
  const fabric = { id: 112, documentId: 'fabric-new-colour', name: 'New Colour Fabric', colours: [] };
  const identity = {
    id: 12,
    documentId: 'identity-new-colour',
    identityKey: 'ashley-wilde|fabric-new-colour|new|gd',
    mappingStatus: 'verified',
    evidenceStatus: 'verified_official',
    supplier: 'Ashley Wilde',
    fabric,
    fabricDocumentId: fabric.documentId,
    supplierProductCode: 'NEW',
    supplierColourCode: 'GD',
    fabricColourCode: 'NEWGD',
    officialColourName: 'Galactic Dust',
    internalColourCode: 'GD',
    assets: [{ id: 212, documentId: 'asset-new-colour', importStatus: 'staged', duplicateStatus: 'unique', assetType: 'ordinary_colour', media: { id: 312, documentId: 'media-new-colour' } }],
  };
  const strapi = { entityService: { findMany: async (uid) => uid === IDENTITY_UID ? [identity] : [] } };
  const mappings = {
    codeRegistry: { codes: { GD: { colourName: 'Golden' } } },
    mappingVersion: 'mapping-v1',
    mappingSource: 'test',
  };

  const first = await promotion.previewPromotion(strapi, { mappings: structuredClone(mappings) });
  const second = await promotion.previewPromotion(strapi, { mappings: structuredClone(mappings) });

  assert.equal(first.summary.eligible, 1);
  assert.match(first.results[0].internalColourCode, /^AW[A-F0-9]{8,}$/);
  assert.equal(first.results[0].internalColourCode, second.results[0].internalColourCode);
  assert.equal(first.planFingerprint, second.planFingerprint);
  assert.equal(first.results[0].internalCodeDecision, 'generate_deterministic_code');
});

test('promotion commits a missing sibling after skipping the existing Colour on the same Fabric', async () => {
  const fabric = {
    id: 111,
    documentId: 'fabric-legacy',
    name: 'Legacy',
    colours: [{ id: 401, documentId: 'colour-flax', name: 'Flax' }],
  };
  const asset = (id, name) => ({
    id,
    documentId: `asset-${name}`,
    importStatus: 'staged',
    duplicateStatus: 'unique',
    assetType: 'ordinary_colour',
    media: { id: id + 100, documentId: `media-${name}` },
  });
  const flax = {
    id: 11,
    documentId: 'identity-flax',
    identityKey: 'ashley-wilde|fabric-legacy|legacy|fl',
    mappingStatus: 'verified',
    evidenceStatus: 'verified_official',
    supplier: 'Ashley Wilde',
    fabric,
    fabricDocumentId: fabric.documentId,
    supplierProductCode: 'LEGACY',
    supplierColourCode: 'FL',
    fabricColourCode: 'LEGACYFL',
    officialColourName: 'Flax',
    internalColourCode: 'FX',
    assets: [asset(211, 'flax')],
  };
  const danube = {
    ...flax,
    id: 12,
    documentId: 'identity-danube',
    identityKey: 'ashley-wilde|fabric-legacy|legacy|da',
    supplierColourCode: 'DA',
    fabricColourCode: 'LEGACYDA',
    officialColourName: 'Danube',
    internalColourCode: 'DAN',
    assets: [asset(212, 'danube')],
  };
  const identities = new Map([[flax.id, flax], [danube.id, danube]]);
  const writes = [];
  const strapi = {
    db: {
      transaction: async (callback) => callback({ trx: { transaction: true } }),
    },
    entityService: {
      findOne: async (uid, id) => {
        assert.equal(uid, IDENTITY_UID);
        return identities.get(id);
      },
      findMany: async (uid) => {
        if (uid === COLOUR_UID) return [];
        throw new Error(`Unexpected findMany ${uid}`);
      },
      create: async (uid, options) => {
        assert.equal(uid, COLOUR_UID);
        writes.push({ operation: 'create', uid, options });
        return { id: 402, documentId: 'colour-danube', name: 'Danube', fabrics: [fabric], thumbnail: danube.assets[0].media };
      },
      update: async (uid, id, options) => {
        writes.push({ operation: 'update', uid, id, options });
        return { id, ...options.data };
      },
    },
  };
  const mappings = {
    codeRegistry: { codes: { FX: { colourName: 'Flax' }, DAN: { colourName: 'Danube' } } },
    mappingVersion: 'mapping-v1',
    mappingSource: 'test',
  };

  const flaxResult = await promotion.promoteIdentity(strapi, flax.id, { commit: true, mappings });
  const danubeResult = await promotion.promoteIdentity(strapi, danube.id, { commit: true, mappings });

  assert.equal(flaxResult.committed, false);
  assert.deepEqual(flaxResult.skippedReasons, ['colour_already_exists_for_fabric']);
  assert.equal(danubeResult.committed, true);
  assert.equal(danubeResult.colourDecision, 'create_new_colour');
  assert.equal(writes.filter((write) => write.operation === 'create' && write.uid === COLOUR_UID).length, 1);
  assert.equal(writes.filter((write) => write.operation === 'update' && write.uid === IDENTITY_UID).length, 1);
  assert.equal(writes.filter((write) => write.operation === 'update' && write.uid === ASSET_UID).length, 1);
});

test('promotion replaces the thumbnail only for the explicitly re-uploaded existing Colour', async () => {
  const oldMedia = { id: 301, documentId: 'media-maidenhair-ink-old' };
  const newMedia = { id: 302, documentId: 'media-maidenhair-ink-new' };
  const colour = { id: 401, documentId: 'colour-maidenhair-ink', name: 'Ink', thumbnail: oldMedia };
  const fabric = { id: 101, documentId: 'fabric-maidenhair', name: 'Maidenhair', colours: [colour] };
  colour.fabrics = [{ id: fabric.id, documentId: fabric.documentId }];
  const asset = {
    id: 201,
    documentId: 'asset-maidenhair-ink',
    importStatus: 'staged',
    duplicateStatus: 'unique',
    assetType: 'ordinary_colour',
    media: newMedia,
    referenceMetadata: { replaceExistingImage: true, previousMediaId: oldMedia.documentId },
  };
  const identity = {
    id: 1,
    documentId: 'identity-maidenhair-ink',
    identityKey: 'ashley-wilde|fabric-maidenhair|maidenhair|in',
    mappingStatus: 'verified', evidenceStatus: 'verified_official', supplier: 'Ashley Wilde',
    fabric, fabricDocumentId: fabric.documentId,
    supplierProductCode: 'MAIDENHAIR', supplierColourCode: 'IN', fabricColourCode: 'MAIDENHAIRIN',
    officialColourName: 'Ink', internalColourCode: 'INK', assets: [asset], promotedColour: null,
  };
  const writes = [];
  const strapi = {
    db: { transaction: async (callback) => callback({ trx: { transaction: true } }) },
    entityService: {
      findOne: async (uid, id) => {
        assert.equal(uid, IDENTITY_UID);
        assert.equal(id, identity.id);
        return identity;
      },
      findMany: async (uid) => uid === COLOUR_UID ? [] : [],
      create: async () => { throw new Error('Replacement promotion must not create a Colour.'); },
      update: async (uid, id, options) => {
        writes.push({ uid, id, options });
        if (uid === COLOUR_UID) return { ...colour, thumbnail: newMedia };
        return { id, ...options.data };
      },
    },
  };
  const mappings = {
    supplier: 'Ashley Wilde',
    codeRegistry: { codes: { INK: { colourName: 'Ink' } } },
    mappingVersion: 'mapping-v1', mappingSource: 'test',
  };

  const result = await promotion.promoteIdentity(strapi, identity.id, { commit: true, mappings });

  assert.equal(result.committed, true);
  assert.equal(result.action, 'update_existing_colour_image');
  assert.equal(result.colourDecision, 'update_existing_colour_thumbnail');
  const colourWrite = writes.find((write) => write.uid === COLOUR_UID);
  assert.deepEqual(colourWrite.options.data, { thumbnail: newMedia.id });
  assert.equal(writes.filter((write) => write.uid === COLOUR_UID).length, 1);
  assert.equal(writes.filter((write) => write.uid === IDENTITY_UID).length, 1);
  assert.equal(writes.filter((write) => write.uid === ASSET_UID).length, 1);
});

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
    internalColourCode: 'DA',
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
    byCode: new Map([
      ['DA', { canonicalColourName: 'Dawn' }],
      ['DAN', { canonicalColourName: 'Danube' }],
    ]),
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
    assert.equal(identityUpdate.options.data.internalColourCode, 'DAN');
    const assetUpdate = writes.find((write) => write.operation === 'update' && write.uid === ASSET_UID);
    assert.equal(assetUpdate.options.data.importStatus, 'promoted');
  } finally {
    supplierMappings.getActiveImporterMappings = originalActiveMappings;
    supplierMappings.loadRegistry = originalLoadRegistry;
  }
});
