'use strict';

const crypto = require('crypto');

const NORMALIZED_COLOUR_FIELD = 'normalizedColour';
const NORMALIZED_COLOUR_FAMILIES = [
  'Blue',
  'White',
  'Green',
  'Grey',
  'Purple',
  'Brown',
  'Red',
  'Beige',
  'Pink',
  'Yellow',
  'Orange',
  'Cream',
  'Black',
  'Gold',
  'Rainbow',
];

const FAMILY_NAMES = {
  Blue: [
    'Aegean', 'Air Force Blue', 'Aqua', 'Aquamarine', 'Azure', 'Blue', 'Danube',
    'Denim', 'Duckegg', 'French Navy', 'Glacier', 'Hydro', 'Ice', 'Kingfisher',
    'Indigo', 'Ink', 'Lagoon', 'Lapis', 'Marine', 'Midnight', 'Navy', 'Ocean',
    'Peacock', 'Powder Blue', 'River', 'Seaspray', 'Sky', 'Spa', 'Teal', 'Wedgewood',
  ],
  White: ['Alabaster', 'Chalk', 'Frost', 'Opal', 'Pearl', 'Porcelain', 'Snow'],
  Green: [
    'Aloe', 'Alpine', 'Amazon', 'Apple', 'Celadon', 'Emerald', 'Fern', 'Forest',
    'Garden', 'Grass', 'Jade', 'Khaki', 'Kiwi', 'Leaf', 'Lime', 'Mint', 'Moss',
    'Olive', 'Pine', 'Pistachi', 'Pistachio', 'Sage', 'Seafoam', 'Spruce',
    'Thyme', 'Verdigris', 'Willow',
  ],
  Grey: [
    'Aluminium', 'Ash', 'Charcoal', 'Dove', 'Flint', 'Fog', 'Graphite', 'Grey',
    'Gunmetal', 'Haze', 'Mercury', 'Mineral', 'Mist', 'Mole', 'Mouse', 'Nordic',
    'Pebble', 'Pewter', 'Platinum', 'Shadow', 'Silver', 'Slate', 'Sliver', 'Smoke',
    'Steel',
  ],
  Purple: [
    'Amethyst', 'Aubergine', 'Cassis', 'Damson', 'Grape', 'Heather', 'Iris',
    'Lavender', 'Mauve', 'Mulberry', 'Orchid', 'Pansy', 'Plum', 'Thistle', 'Violet',
  ],
  Brown: [
    'Bark', 'Bronze', 'Caramel', 'Cinnamon', 'Cocoa', 'Copper', 'Espresso', 'Fudge',
    'Mocha', 'Otter', 'Praline', 'Toffee', 'Walnut',
  ],
  Red: [
    'Berry', 'Cherry', 'Claret', 'Cranberry', 'Crimson', 'Merlot', 'Paprika',
    'Raspberry', 'Rouge', 'Scarlet', 'Strawberry', 'Wine',
  ],
  Beige: [
    'Birch', 'Clay', 'Driftwood', 'Fawn', 'Flax', 'Hessian', 'Latte', 'Linen',
    'Mushroom', 'Natural', 'Nougat', 'Oatmeal', 'Oyster', 'Parchment', 'Putty',
    'Sand', 'Sesame', 'Stone', 'Taupe', 'Vintage', 'Wheat',
  ],
  Pink: [
    'Blossom', 'Blush', 'Boudoir', 'Calamine', 'Candy', 'Candyfloss', 'Carnation',
    'Duskypink', 'Fuchsia', 'Fuschia', 'Hollyhock', 'Magenta', 'Petal', 'Plaster',
    'Rose', 'Sorbet',
  ],
  Yellow: [
    'Buttercup', 'Citrus', 'Lemon', 'Maize', 'Mustard', 'Ochre', 'Pollen', 'Saffron',
    'Sunflower', 'Yellow Ochre', 'Zest',
  ],
  Orange: [
    'Cantaloupe', 'Clementine', 'Coral', 'Ginger', 'Nectarine', 'Rust', 'Sunset',
    'Tangerine', 'Terracotta',
  ],
  Cream: ['Champagne', 'Cream', 'Ecru', 'Ivory', 'Shell', 'Vanilla'],
  Black: ['Coal', 'Ebony', 'Noir', 'Onyx', 'Raven'],
  Gold: ['Gold', 'Rose Gold', 'Topaz'],
  Rainbow: ['Rainbow'],
};

const keyFor = (value) => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const FAMILY_BY_NAME = Object.entries(FAMILY_NAMES).reduce((lookup, [family, names]) => {
  for (const name of names) lookup[keyFor(name)] = family;
  return lookup;
}, {});

const COLOUR_UID = 'api::colour.colour';
const PLAN_VERSION = 'colour-map-v2';
const PLAN_TTL_MS = 10 * 60 * 1000;
const QUERY_LIMIT = 5000;

const stableFingerprint = (value) => crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

function normalizeColourName(name) {
  return FAMILY_BY_NAME[keyFor(name)] || null;
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
      alreadyNormalized: items.filter((item) => item.knownName && item.currentNormalizedColour === item.normalizedColour).length,
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
  const changes = current.items.filter((item) => item.knownName && item.currentNormalizedColour !== item.normalizedColour);
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
