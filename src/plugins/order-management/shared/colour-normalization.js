'use strict';

const crypto = require('crypto');

const NORMALIZED_COLOUR_FIELD = 'normalizedColour';
const NORMALIZED_COLOUR_FAMILIES = [
  'Red',
  'Orange',
  'Yellow',
  'Green',
  'Blue',
  'Indigo',
  'Violet',
  'Neutral',
  'Brown',
  'Metallic',
  'Multicolour',
];

const FAMILY_NAMES = {
  Red: [
    'Berry', 'Blossom', 'Blush', 'Boudoir', 'Calamine', 'Candy', 'Candyfloss',
    'Carnation', 'Cassis', 'Cherry', 'Claret', 'Cranberry', 'Crimson', 'Damson',
    'Duskypink', 'Merlot', 'Petal', 'Raspberry', 'Rose', 'Rouge', 'Scarlet',
    'Sorbet', 'Strawberry', 'Sunset', 'Wine',
  ],
  Orange: [
    'Cantaloupe', 'Caramel', 'Cinnamon', 'Clementine', 'Coral', 'Ginger',
    'Nectarine', 'Paprika', 'Rust', 'Tangerine', 'Terracotta',
  ],
  Yellow: [
    'Buttercup', 'Citrus', 'Lemon', 'Maize', 'Mustard', 'Ochre', 'Pollen',
    'Saffron', 'Sunflower', 'Topaz', 'Yellow Ochre', 'Zest',
  ],
  Green: [
    'Aloe', 'Alpine', 'Amazon', 'Apple', 'Celadon', 'Emerald', 'Fern', 'Forest',
    'Garden', 'Grass', 'Jade', 'Khaki', 'Kiwi', 'Leaf', 'Lime', 'Mint', 'Moss',
    'Olive', 'Pine', 'Pistachi', 'Pistachio', 'Sage', 'Seafoam', 'Spruce',
    'Thyme', 'Verdigris', 'Willow',
  ],
  Blue: [
    'Aegean', 'Air Force Blue', 'Aqua', 'Aquamarine', 'Azure', 'Blue', 'Danube',
    'Denim', 'Duckegg', 'French Navy', 'Glacier', 'Hydro', 'Ice', 'Kingfisher',
    'Lagoon', 'Lapis', 'Marine', 'Navy', 'Nordic', 'Ocean', 'Peacock',
    'Powder Blue', 'River', 'Seaspray', 'SEaspray', 'Sky', 'Spa', 'Teal',
    'Wedgewood',
  ],
  Indigo: ['Indigo', 'Ink', 'Midnight'],
  Violet: [
    'Amethyst', 'Aubergine', 'Fuchsia', 'Fuschia', 'Grape', 'Heather',
    'Hollyhock', 'Iris', 'Lavender', 'Magenta', 'Mauve', 'Mulberry', 'Orchid',
    'Pansy', 'Plum', 'Thistle', 'Violet',
  ],
  Neutral: [
    'Alabaster', 'Ash', 'Birch', 'Champagne', 'Chalk', 'Charcoal', 'Coal',
    'Cream', 'Dove', 'Ebony', 'Ecru', 'Flax', 'Flint', 'Fog', 'Frost', 'Grey',
    'Haze', 'Ivory', 'Linen', 'Mineral', 'Mist', 'Mouse', 'Natural', 'Noir',
    'Onyx', 'Opal', 'Oyster', 'Parchment', 'Pearl', 'Pebble', 'Plaster',
    'Porcelain', 'Putty', 'Raven', 'Shadow', 'Shell', 'Slate', 'Smoke', 'Snow',
    'Stone', 'Vanilla', 'Vintage',
  ],
  Brown: [
    'Bark', 'Clay', 'Cocoa', 'Driftwood', 'Espresso', 'Fawn', 'Fudge', 'Hessian',
    'Latte', 'Mocha', 'Mole', 'Mushroom', 'Nougat', 'Oatmeal', 'Otter', 'Praline',
    'Sand', 'Sesame', 'Taupe', 'Toffee', 'Walnut', 'Wheat',
  ],
  Metallic: [
    'Aluminium', 'Bronze', 'Copper', 'Gold', 'Graphite', 'Gunmetal', 'Mercury',
    'Pewter', 'Platinum', 'Rose Gold', 'Silver', 'Sliver', 'Steel',
  ],
  Multicolour: ['Rainbow'],
};

const keyFor = (value) => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const FAMILY_BY_NAME = Object.entries(FAMILY_NAMES).reduce((lookup, [family, names]) => {
  for (const name of names) lookup[keyFor(name)] = family;
  return lookup;
}, {});

const COLOUR_UID = 'api::colour.colour';
const PLAN_VERSION = 'wibgyor-v1';
const PLAN_TTL_MS = 10 * 60 * 1000;
const QUERY_LIMIT = 5000;

const stableFingerprint = (value) => crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

function normalizeColourName(name) {
  return FAMILY_BY_NAME[keyFor(name)] || 'Neutral';
}

function readColour(colour) {
  const name = String(colour?.name || '').trim();
  return {
    id: colour?.id || null,
    documentId: colour?.documentId || null,
    name,
    currentNormalizedColour: String(colour?.[NORMALIZED_COLOUR_FIELD] || '').trim() || null,
    normalizedColour: normalizeColourName(name),
    knownName: Boolean(FAMILY_BY_NAME[keyFor(name)]),
  };
}

async function loadColours(strapi) {
  const colours = await strapi.entityService.findMany(COLOUR_UID, {
    fields: ['name', NORMALIZED_COLOUR_FIELD, 'documentId'],
    sort: ['name:asc', 'documentId:asc'],
    limit: QUERY_LIMIT,
  });
  return (colours || []).map(readColour).filter((colour) => colour.name);
}

function buildPlan(colours) {
  const items = [...colours].sort((left, right) => left.name.localeCompare(right.name) || String(left.documentId || left.id).localeCompare(String(right.documentId || right.id)));
  const groups = NORMALIZED_COLOUR_FAMILIES.map((family) => {
    const familyItems = items.filter((item) => item.normalizedColour === family);
    return {
      family,
      count: familyItems.length,
      names: [...new Set(familyItems.map((item) => item.name))],
    };
  }).filter((group) => group.count > 0);
  const unknownNames = [...new Set(items.filter((item) => !item.knownName).map((item) => item.name))];
  const changes = items.filter((item) => item.currentNormalizedColour !== item.normalizedColour);
  const planFingerprint = stableFingerprint({
    version: PLAN_VERSION,
    colours: items.map((item) => ({
      id: item.id,
      documentId: item.documentId,
      name: item.name,
      normalizedColour: item.currentNormalizedColour,
    })),
  });

  return {
    version: PLAN_VERSION,
    planFingerprint,
    planExpiresAt: new Date(Date.now() + PLAN_TTL_MS).toISOString(),
    total: items.length,
    summary: {
      total: items.length,
      changes: changes.length,
      alreadyNormalized: items.length - changes.length,
      distinctNames: new Set(items.map((item) => item.name)).size,
      unknownNames: unknownNames.length,
    },
    groups,
    unknownNames,
    items,
    committed: false,
  };
}

async function previewNormalization(strapi) {
  return buildPlan(await loadColours(strapi));
}

async function applyNormalization(strapi, options = {}) {
  if (options.confirm !== true) throw new Error('Explicit confirmation is required to normalize Colour records.');
  if (!options.planFingerprint) throw new Error('Preview Colour normalization before applying it.');
  if (options.planExpiresAt && Date.parse(options.planExpiresAt) <= Date.now()) {
    throw new Error('The Colour normalization preview has expired. Run the preview again.');
  }

  const current = await previewNormalization(strapi);
  if (current.planFingerprint !== options.planFingerprint) {
    throw new Error('The Colour normalization preview is stale because Colour records changed. Run the preview again.');
  }
  const changes = current.items.filter((item) => item.currentNormalizedColour !== item.normalizedColour);
  if (!strapi.db?.transaction) throw new Error('Colour normalization requires the Strapi database transaction service.');

  await strapi.db.transaction(async ({ trx }) => {
    for (const item of changes) {
      await strapi.entityService.update(COLOUR_UID, item.id || item.documentId, {
        data: { [NORMALIZED_COLOUR_FIELD]: item.normalizedColour },
        transacting: trx,
      });
    }
  });

  return {
    ...current,
    committed: true,
    summary: {
      ...current.summary,
      updated: changes.length,
    },
  };
}

module.exports = {
  NORMALIZED_COLOUR_FAMILIES,
  buildPlan,
  normalizeColourName,
  previewNormalization,
  applyNormalization,
};
