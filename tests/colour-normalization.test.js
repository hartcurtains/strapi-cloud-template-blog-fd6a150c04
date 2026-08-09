'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildPlan,
  normalizeColourName,
  NORMALIZED_COLOUR_FAMILIES,
} = require('../src/plugins/order-management/shared/colour-normalization');

const importExportControllerSource = fs.readFileSync(
  path.join(__dirname, '../src/plugins/order-management/server/controllers/import-export.js'),
  'utf8',
);

test('normalization controller resolves the shared service in the deployed Strapi layout', () => {
  assert.match(importExportControllerSource, /require\('\.\.\/\.\.\/shared\/colour-normalization'\)/);
  assert.doesNotMatch(importExportControllerSource, /require\('\.\.\/services\/colour-normalization'\)/);
});

test('colour normalization applies the approved mapping for every current colour name', () => {
  const expectedFamilies = [
    'Blue', 'White', 'Green', 'Grey', 'Purple', 'Brown', 'Red', 'Beige',
    'Pink', 'Yellow', 'Orange', 'Cream', 'Black', 'Gold', 'Rainbow',
  ];
  const expectedMappings = {
    'Aegean': 'Blue', 'Air Force Blue': 'Blue', 'Alabaster': 'White', 'Aloe': 'Green',
    'Alpine': 'Green', 'Aluminium': 'Grey', 'Amazon': 'Green', 'Amethyst': 'Purple',
    'Apple': 'Green', 'Aqua': 'Blue', 'Aquamarine': 'Blue', 'Ash': 'Grey',
    'Aubergine': 'Purple', 'Azure': 'Blue', 'Bark': 'Brown', 'Berry': 'Red',
    'Birch': 'Beige', 'Blossom': 'Pink', 'Blue': 'Blue', 'Blush': 'Pink',
    'Boudoir': 'Pink', 'Bronze': 'Brown', 'Buttercup': 'Yellow', 'Calamine': 'Pink',
    'Candy': 'Pink', 'Candyfloss': 'Pink', 'Cantaloupe': 'Orange', 'Caramel': 'Brown',
    'Carnation': 'Pink', 'Cassis': 'Purple', 'Celadon': 'Green', 'Chalk': 'White',
    'Champagne': 'Cream', 'Charcoal': 'Grey', 'Cherry': 'Red', 'Cinnamon': 'Brown',
    'Citrus': 'Yellow', 'Claret': 'Red', 'Clay': 'Beige', 'Clementine': 'Orange',
    'Coal': 'Black', 'Cocoa': 'Brown', 'Copper': 'Brown', 'Coral': 'Orange',
    'Cranberry': 'Red', 'Cream': 'Cream', 'Crimson': 'Red', 'Damson': 'Purple',
    'Danube': 'Blue', 'Denim': 'Blue', 'Dove': 'Grey', 'Driftwood': 'Beige',
    'Duckegg': 'Blue', 'Duskypink': 'Pink', 'Ebony': 'Black', 'Ecru': 'Cream',
    'Emerald': 'Green', 'Espresso': 'Brown', 'Fawn': 'Beige', 'Fern': 'Green',
    'Flax': 'Beige', 'Flint': 'Grey', 'Fog': 'Grey', 'Forest': 'Green',
    'French Navy': 'Blue', 'Frost': 'White', 'Fuchsia': 'Pink', 'Fudge': 'Brown',
    'Fuschia': 'Pink', 'Garden': 'Green', 'Ginger': 'Orange', 'Glacier': 'Blue',
    'Gold': 'Gold', 'Grape': 'Purple', 'Graphite': 'Grey', 'Grass': 'Green',
    'Grey': 'Grey', 'Gunmetal': 'Grey', 'Haze': 'Grey', 'Heather': 'Purple',
    'Hessian': 'Beige', 'Hollyhock': 'Pink', 'Hydro': 'Blue', 'Ice': 'Blue',
    'Indigo': 'Blue', 'Ink': 'Blue', 'Iris': 'Purple', 'Ivory': 'Cream',
    'Jade': 'Green', 'Khaki': 'Green', 'Kingfisher': 'Blue', 'Kiwi': 'Green',
    'Lagoon': 'Blue', 'Lapis': 'Blue', 'Latte': 'Beige', 'Lavender': 'Purple',
    'Leaf': 'Green', 'Lemon': 'Yellow', 'Lime': 'Green', 'Linen': 'Beige',
    'Magenta': 'Pink', 'Maize': 'Yellow', 'Marine': 'Blue', 'Mauve': 'Purple',
    'Mercury': 'Grey', 'Merlot': 'Red', 'Midnight': 'Blue', 'Mineral': 'Grey',
    'Mint': 'Green', 'Mist': 'Grey', 'Mocha': 'Brown', 'Mole': 'Grey',
    'Moss': 'Green', 'Mouse': 'Grey', 'Mulberry': 'Purple', 'Mushroom': 'Beige',
    'Mustard': 'Yellow', 'Natural': 'Beige', 'Navy': 'Blue', 'Nectarine': 'Orange',
    'Noir': 'Black', 'Nordic': 'Grey', 'Nougat': 'Beige', 'Oatmeal': 'Beige',
    'Ocean': 'Blue', 'Ochre': 'Yellow', 'Olive': 'Green', 'Onyx': 'Black',
    'Opal': 'White', 'Orchid': 'Purple', 'Otter': 'Brown', 'Oyster': 'Beige',
    'Pansy': 'Purple', 'Paprika': 'Red', 'Parchment': 'Beige', 'Peacock': 'Blue',
    'Pearl': 'White', 'Pebble': 'Grey', 'Petal': 'Pink', 'Pewter': 'Grey',
    'Pine': 'Green', 'Pistachi': 'Green', 'Pistachio': 'Green', 'Plaster': 'Pink',
    'Platinum': 'Grey', 'Plum': 'Purple', 'Pollen': 'Yellow', 'Porcelain': 'White',
    'Powder Blue': 'Blue', 'Praline': 'Brown', 'Putty': 'Beige', 'Rainbow': 'Rainbow',
    'Raspberry': 'Red', 'Raven': 'Black', 'River': 'Blue', 'Rose': 'Pink',
    'Rose Gold': 'Gold', 'Rouge': 'Red', 'Rust': 'Orange', 'Saffron': 'Yellow',
    'Sage': 'Green', 'Sand': 'Beige', 'Scarlet': 'Red', 'Seafoam': 'Green',
    'Seaspray': 'Blue', 'Sesame': 'Beige', 'Shadow': 'Grey', 'Shell': 'Cream',
    'Silver': 'Grey', 'Sky': 'Blue', 'Slate': 'Grey', 'Sliver': 'Grey',
    'Smoke': 'Grey', 'Snow': 'White', 'Sorbet': 'Pink', 'Spa': 'Blue',
    'Spruce': 'Green', 'Steel': 'Grey', 'Stone': 'Beige', 'Strawberry': 'Red',
    'Sunflower': 'Yellow', 'Sunset': 'Orange', 'Tangerine': 'Orange', 'Taupe': 'Beige',
    'Teal': 'Blue', 'Terracotta': 'Orange', 'Thistle': 'Purple', 'Thyme': 'Green',
    'Toffee': 'Brown', 'Topaz': 'Gold', 'Vanilla': 'Cream', 'Verdigris': 'Green',
    'Vintage': 'Beige', 'Violet': 'Purple', 'Walnut': 'Brown', 'Wedgewood': 'Blue',
    'Wheat': 'Beige', 'Willow': 'Green', 'Wine': 'Red', 'Yellow Ochre': 'Yellow',
    'Zest': 'Yellow',
  };

  assert.deepEqual(NORMALIZED_COLOUR_FAMILIES, expectedFamilies);
  assert.equal(Object.keys(expectedMappings).length, 201);
  for (const [name, family] of Object.entries(expectedMappings)) {
    assert.equal(normalizeColourName(name), family, name);
  }
  assert.equal(normalizeColourName('new supplier shade'), null);
});

test('normalization preview is deterministic and identifies only records that need writing', () => {
  const preview = buildPlan([
    { id: 2, documentId: 'blue-2', name: 'Navy', normalizedColour: 'Blue', currentNormalizedColour: null, knownName: true },
    { id: 1, documentId: 'red-1', name: 'Berry', normalizedColour: 'Red', currentNormalizedColour: 'Red', knownName: true },
  ]);

  assert.deepEqual(preview.groups, [
    { family: 'Blue', count: 1, names: ['Navy'] },
    { family: 'Red', count: 1, names: ['Berry'] },
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

test('unknown colour names are reported and never included in writes', () => {
  const preview = buildPlan([
    { id: 3, documentId: 'unknown-3', name: 'new supplier shade', normalizedColour: null, currentNormalizedColour: null, knownName: false },
  ]);

  assert.equal(preview.summary.changes, 0);
  assert.equal(preview.summary.alreadyNormalized, 0);
  assert.equal(preview.summary.unknownNames, 1);
  assert.deepEqual(preview.unknownNames, ['new supplier shade']);
});
