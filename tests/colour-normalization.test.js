'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPlan,
  normalizeColourName,
} = require('../src/plugins/order-management/shared/colour-normalization');

test('colour normalization preserves spelling variants while assigning stable families', () => {
  assert.equal(normalizeColourName('Fuschia'), 'Violet');
  assert.equal(normalizeColourName('Pistachi'), 'Green');
  assert.equal(normalizeColourName('Sliver'), 'Metallic');
  assert.equal(normalizeColourName('Rainbow'), 'Multicolour');
  assert.equal(normalizeColourName('new supplier shade'), 'Neutral');
});

test('normalization preview is deterministic and identifies only records that need writing', () => {
  const preview = buildPlan([
    { id: 2, documentId: 'blue-2', name: 'Navy', normalizedColour: 'Blue', currentNormalizedColour: null, knownName: true },
    { id: 1, documentId: 'red-1', name: 'Berry', normalizedColour: 'Red', currentNormalizedColour: 'Red', knownName: true },
  ]);

  assert.deepEqual(preview.groups, [
    { family: 'Red', count: 1, names: ['Berry'] },
    { family: 'Blue', count: 1, names: ['Navy'] },
  ]);
  assert.equal(preview.summary.total, 2);
  assert.equal(preview.summary.changes, 1);
  assert.equal(preview.summary.alreadyNormalized, 1);
  assert.equal(preview.summary.distinctNames, 2);
  assert.equal(preview.planFingerprint, buildPlan([
    { id: 1, documentId: 'red-1', name: 'Berry', normalizedColour: 'Red', currentNormalizedColour: 'Red', knownName: true },
    { id: 2, documentId: 'blue-2', name: 'Navy', normalizedColour: 'Blue', currentNormalizedColour: null, knownName: true },
  ]).planFingerprint);
});
