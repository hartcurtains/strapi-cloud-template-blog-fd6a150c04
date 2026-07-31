'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const cleanup = require('../src/plugins/order-management/server/services/ashley-wilde-legacy-colour-cleanup');

const FABRIC_UID = 'api::fabric.fabric';
const COLOUR_UID = 'api::colour.colour';
const IDENTITY_UID = 'api::fabric-colour-identity.fabric-colour-identity';

function fixture() {
  const ashley = { id: 91, documentId: 'brand-ashley', name: 'Ashley Wilde' };
  const otherBrand = { id: 92, documentId: 'brand-other', name: 'Other Supplier' };
  const legacyFabric = { id: 11, documentId: 'fabric-legacy', name: 'Legacy', brand: ashley };
  const otherFabric = { id: 12, documentId: 'fabric-other', name: 'Other', brand: otherBrand };
  const legacyColour = { id: 21, documentId: 'colour-legacy', name: 'Wrong legacy', updatedAt: '2026-07-31T10:00:00.000Z' };
  const sharedColour = { id: 22, documentId: 'colour-shared', name: 'Shared legacy', updatedAt: '2026-07-31T10:00:00.000Z' };
  const promotedColour = { id: 23, documentId: 'colour-promoted', name: 'Promoted', updatedAt: '2026-07-31T10:00:00.000Z' };

  legacyFabric.colours = [legacyColour, sharedColour, promotedColour];
  legacyColour.fabrics = [legacyFabric];
  sharedColour.fabrics = [legacyFabric, otherFabric];
  promotedColour.fabrics = [legacyFabric];

  const identity = {
    id: 31,
    documentId: 'identity-promoted',
    fabric: legacyFabric,
    promotedColour,
  };
  return {
    targetFabrics: [legacyFabric],
    colours: [legacyColour, sharedColour, promotedColour],
    identities: [identity],
  };
}

test('cleanup preview deletes only orphaned legacy rows and disconnects shared rows', () => {
  const plan = cleanup.buildCleanupPlan(fixture(), { supplier: 'Ashley Wilde' });

  assert.equal(plan.summary.fabricsScanned, 1);
  assert.equal(plan.summary.colourAssociationsFound, 3);
  assert.equal(plan.summary.identityLinkedAssociationsPreserved, 1);
  assert.equal(plan.summary.unlinkedAssociationsToRemove, 2);
  assert.equal(plan.summary.colourRecordsToDelete, 1);
  assert.equal(plan.summary.sharedColourRecordsToDisconnect, 1);
  assert.equal(plan.summary.mediaRecordsToDelete, 0);
  assert.equal(plan.results.length, 2);

  const legacy = plan.results.find((row) => row.colourDocumentId === 'colour-legacy');
  const shared = plan.results.find((row) => row.colourDocumentId === 'colour-shared');
  assert.equal(legacy.action, 'delete_colour');
  assert.equal(shared.action, 'disconnect_fabrics');
  assert.deepEqual(shared.targetFabrics.map((fabric) => fabric.documentId), ['fabric-legacy']);
  assert.equal(plan.results.some((row) => row.colourDocumentId === 'colour-promoted'), false);
});

test('confirmed cleanup commits the exact reviewed plan without deleting media or promoted Colours', async () => {
  const state = fixture();
  const writes = [];
  const strapi = {
    db: {
      transaction: async (callback) => callback({ trx: { transaction: true } }),
    },
    entityService: {
      findMany: async (uid) => {
        if (uid === FABRIC_UID) return state.targetFabrics;
        if (uid === COLOUR_UID) return state.colours;
        if (uid === IDENTITY_UID) return state.identities;
        throw new Error(`Unexpected findMany ${uid}`);
      },
      delete: async (uid, id, options) => {
        writes.push({ operation: 'delete', uid, id, options });
      },
      update: async (uid, id, options) => {
        writes.push({ operation: 'update', uid, id, options });
      },
    },
  };

  const preview = await cleanup.previewCleanup(strapi, { supplier: 'Ashley Wilde' });
  const result = await cleanup.applyCleanup(strapi, {
    supplier: 'Ashley Wilde',
    confirm: true,
    planFingerprint: preview.planFingerprint,
    planExpiresAt: preview.planExpiresAt,
    operationKeys: preview.operationKeys,
  });

  assert.equal(result.committed, true);
  assert.equal(result.summary.operationsCommitted, 2);
  assert.equal(result.summary.mediaRecordsToDelete, 0);
  assert.deepEqual(
    writes.map((write) => [write.operation, write.uid, write.id]),
    [
      ['delete', COLOUR_UID, 21],
      ['update', COLOUR_UID, 22],
    ],
  );
  assert.deepEqual(writes[1].options.data.fabrics.disconnect, [11]);
  assert.equal(writes.some((write) => write.id === 23), false);
  assert.ok(writes.every((write) => write.options.transacting.transaction));
});

test('cleanup rejects apply when a promoted identity relation appears after preview', async () => {
  const state = fixture();
  const strapi = {
    db: {
      transaction: async () => {
        throw new Error('Transaction must not start for a stale plan.');
      },
    },
    entityService: {
      findMany: async (uid) => {
        if (uid === FABRIC_UID) return state.targetFabrics;
        if (uid === COLOUR_UID) return state.colours;
        if (uid === IDENTITY_UID) return state.identities;
        throw new Error(`Unexpected findMany ${uid}`);
      },
    },
  };
  const preview = await cleanup.previewCleanup(strapi, { supplier: 'Ashley Wilde' });
  state.identities.push({
    id: 32,
    documentId: 'identity-now-linked',
    fabric: state.targetFabrics[0],
    promotedColour: state.colours[0],
  });

  await assert.rejects(
    cleanup.applyCleanup(strapi, {
      supplier: 'Ashley Wilde',
      confirm: true,
      planFingerprint: preview.planFingerprint,
      planExpiresAt: preview.planExpiresAt,
      operationKeys: preview.operationKeys,
    }),
    /preview is stale/,
  );
});
