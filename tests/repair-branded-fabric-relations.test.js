'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  assertApplySafe,
  buildRepairPlan,
  collectSourceFabrics,
  parseArgs,
} = require('../scripts/repair-branded-fabric-relations');

test('repair plan matches Fabrics only by exact productId and is idempotent', () => {
  const source = collectSourceFabrics([
    {
      sourceFile: 'emily-bond-product-import.json',
      rows: [
        { productId: 'FAB-ALICE-1', name: 'Alice', brand_name: 'Emily Bond' },
        { productId: 'FAB-ARTISTS-1', name: 'Artists Stripe', brand_name: 'Clarissa Hulse' },
      ],
    },
  ]);
  const plan = buildRepairPlan({
    sourceRecords: source.records,
    invalidRows: source.invalidRows,
    fabrics: [
      { id: 1, productId: 'FAB-ALICE-1', name: 'Alice', brand: null },
      { id: 2, productId: 'FAB-ARTISTS-1', name: 'Artists Stripe', brand: { name: 'clarissa hulse' } },
      { id: 3, productId: 'FAB-ALICE-10', name: 'Alice', brand: { name: 'Other Brand' } },
    ],
    brands: [
      { id: 10, documentId: 'emily-brand', name: 'Emily Bond' },
      { id: 11, documentId: 'clarissa-brand', name: 'Clarissa Hulse' },
    ],
  });

  assert.equal(plan.summary.toRepair, 1);
  assert.equal(plan.summary.alreadyCorrect, 1);
  assert.equal(plan.operations.find((operation) => operation.productId === 'FAB-ALICE-1').status, 'needs_repair');
  assert.equal(plan.operations.find((operation) => operation.productId === 'FAB-ARTISTS-1').status, 'already_correct');
  assert.equal(plan.operations.some((operation) => operation.productId === 'FAB-ALICE-10'), false);
  assert.deepEqual(plan.operations[0].relation, { connect: ['emily-brand'] });
});

test('repair apply is refused when exact matches are missing or ambiguous', () => {
  const plan = buildRepairPlan({
    sourceRecords: [{ productId: 'FAB-MISSING', fabricName: 'Missing', brandName: 'Laura Ashley' }],
    fabrics: [],
    brands: [],
  });
  assert.throws(() => assertApplySafe(plan), /Refusing --apply/);
});

test('repair defaults to dry-run and requires an explicit apply flag', () => {
  assert.equal(parseArgs([]).apply, false);
  assert.equal(parseArgs(['--dry-run']).apply, false);
  assert.equal(parseArgs(['--apply']).apply, true);
});
