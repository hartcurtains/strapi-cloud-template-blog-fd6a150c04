'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  brandRelationPayload,
  buildBrandIndex,
  linkedBrandSummary,
  sameBrand,
} = require('../src/plugins/order-management/server/services/catalog-import-brand');

test('Brand imports use the Strapi v5 document relation payload', () => {
  assert.deepEqual(
    brandRelationPayload({ id: 17, documentId: 'brand-emily', name: 'Emily Bond' }),
    { connect: ['brand-emily'] },
  );
  assert.deepEqual(brandRelationPayload({ id: 17, name: 'Emily Bond' }), { connect: [17] });
});

test('Brand lookup is case-insensitive and refuses ambiguous duplicate names', () => {
  const result = buildBrandIndex([
    { id: 1, documentId: 'emily-brand', name: 'Emily Bond' },
    { id: 2, documentId: 'clarissa-brand', name: 'Clarissa Hulse' },
    { id: 3, documentId: 'emily-duplicate', name: ' emily bond ' },
  ]);

  assert.equal(result.byName.has('clarissa bond'), false);
  assert.equal(result.byName.has('emily bond'), false);
  assert.equal(result.ambiguous.has('emily bond'), true);
  assert.equal(result.byName.get('clarissa hulse').documentId, 'clarissa-brand');
});

test('Brand change detection treats a connected documentId as the populated relation', () => {
  const target = { id: 9, documentId: 'brand-emily', name: 'Emily Bond' };
  assert.equal(sameBrand(target, { id: 9, documentId: 'brand-emily', name: 'Emily Bond' }), true);
  assert.equal(sameBrand({ connect: ['brand-emily'] }, target), true);
  assert.equal(sameBrand(target, null), false);
  assert.deepEqual(linkedBrandSummary(target), { id: 9, documentId: 'brand-emily', name: 'Emily Bond' });
});
