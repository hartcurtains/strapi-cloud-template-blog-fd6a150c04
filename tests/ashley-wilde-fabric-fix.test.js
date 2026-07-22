'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  BLOCKER_FABRICS,
  fabricPayload,
  normalize,
  upsertBlockerFabrics,
} = require('../scripts/ashley-wilde-fabric-fix');

function harness(initialRows = []) {
  const rows = initialRows.map((row) => ({ ...row }));
  const calls = { creates: 0, updates: 0, publishes: 0 };
  let nextId = 1;
  let nextDocument = 1;
  const brand = { id: 52, documentId: 'ashley-brand', name: 'Ashley Wilde' };
  const strapi = {
    entityService: {
      async findMany(uid) {
        assert.equal(uid, 'api::fabric.fabric');
        return rows.map((row) => ({ ...row, brand }));
      },
    },
    documents(uid) {
      if (uid === 'api::brand.brand') return {
        async findMany() { return [brand]; },
      };
      assert.equal(uid, 'api::fabric.fabric');
      return {
        async create({ data }) {
          calls.creates += 1;
          const document = { id: nextId++, documentId: `fabric-${nextDocument++}`, ...data, publishedAt: null };
          rows.push({ ...document, brand });
          return document;
        },
        async update({ documentId, data }) {
          calls.updates += 1;
          const row = rows.find((item) => item.documentId === documentId);
          assert.ok(row, `missing document ${documentId}`);
          Object.assign(row, data);
          return { ...row, brand };
        },
        async publish({ documentId }) {
          calls.publishes += 1;
          const row = rows.find((item) => item.documentId === documentId);
          assert.ok(row, `missing document ${documentId}`);
          row.publishedAt = '2026-07-21T00:00:00.000Z';
          return { ...row, brand };
        },
      };
    },
  };
  return { strapi, rows, calls };
}

test('blocker identities normalize cosmetic spacing and punctuation without conflating codes', () => {
  assert.equal(normalize('Birdsandroses'), normalize('Birds & Roses'));
  assert.equal(normalize('Birdsandroses'), normalize('Birds and Roses'));
  assert.equal(normalize('ANTIQUEROSE'), normalize('Antique Rose'));
  assert.notEqual(normalize('BIRDSANDROSES/BL'), normalize('BIRDSANDROSES/MU'));
});

test('blocker payload preserves canonical names, exact supplier codes, and project IDs', () => {
  const payload = fabricPayload(BLOCKER_FABRICS[0], 'ashley-brand');
  assert.equal(payload.name, 'Antiquerose');
  assert.equal(payload.productId, 'FAB-ANTIQUEROSE-9021');
  assert.deepEqual(payload.brand, { connect: ['ashley-brand'] });
});

test('blocker catalogue fix creates each document once and is idempotent on rerun', async () => {
  const { strapi, calls } = harness();
  const first = await upsertBlockerFabrics(strapi);
  const second = await upsertBlockerFabrics(strapi);
  assert.deepEqual(first.map((row) => row.action), ['created', 'created']);
  assert.deepEqual(second.map((row) => row.action), ['updated', 'updated']);
  assert.equal(calls.creates, 2);
  assert.equal(calls.updates, 2);
  assert.equal(calls.publishes, 4);
});

test('cosmetic display-name spacing does not create a duplicate Fabric', async () => {
  const { strapi, rows, calls } = harness([
    { id: 9, documentId: 'birds-existing', name: 'Birds & Roses', productId: 'FAB-BIRDSANDROSES-9022', publishedAt: null },
    { id: 10, documentId: 'antiquerose-existing', name: 'Antiquerose', productId: 'FAB-ANTIQUEROSE-9021', publishedAt: null },
  ]);
  const result = await upsertBlockerFabrics(strapi);
  assert.equal(result[1].action, 'updated');
  assert.equal(rows.filter((row) => normalize(row.name) === normalize('Birdsandroses')).length, 1);
  assert.equal(calls.creates, 0);
  assert.equal(calls.updates, 2);
});

test('supplier-code identity takes precedence over a cosmetic name match', async () => {
  const { strapi } = harness([
    { id: 9, documentId: 'birds-conflict', name: 'Birds and Roses', productId: 'WRONG-SUPPLIER-CODE', publishedAt: null },
  ]);
  await assert.rejects(() => upsertBlockerFabrics(strapi), /productId WRONG-SUPPLIER-CODE conflicts/);
});
