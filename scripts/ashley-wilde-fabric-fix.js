'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createStrapi } = require('@strapi/strapi');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const NORMAL_DATABASE = path.join(PROJECT_ROOT, '.tmp', 'data.db');
const FABRIC_UID = 'api::fabric.fabric';
const BRAND_UID = 'api::brand.brand';
const SUPPLIER = 'Ashley Wilde';

// The source folder is the only stored collection-level evidence for these two
// products. The September 2025 price list does not contain either product.
const BLOCKER_FABRICS = Object.freeze([
  {
    name: 'Antiquerose',
    supplierProductCode: 'ANTIQUEROSE',
    productId: 'FAB-ANTIQUEROSE-9021',
    slug: 'antiquerose-9021',
  },
  {
    name: 'Birdsandroses',
    supplierProductCode: 'BIRDSANDROSES',
    productId: 'FAB-BIRDSANDROSES-9022',
    slug: 'birdsandroses-9022',
  },
]);

const normalize = (value) => String(value || '')
  .normalize('NFKC')
  .trim()
  .toLocaleLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]/g, '');

function logicalRows(rows) {
  const byDocument = new Map();
  for (const row of rows || []) {
    const key = row.documentId || row.id;
    const current = byDocument.get(key);
    if (!current || (current.publishedAt && !row.publishedAt)) byDocument.set(key, row);
  }
  return [...byDocument.values()];
}

function fabricPayload(target, brandDocumentId) {
  return {
    name: target.name,
    collection: 'Cath Kidston Volume 1',
    description: 'Official Ashley Wilde current product; absent from the September 2025 Trade Price List. Local source: Cath Kidston Volume 1 Flat Shots.',
    productId: target.productId,
    slug: target.slug,
    pattern: 'Floral',
    composition: 'Not specified',
    patternRepeat_cm: 0,
    usableWidth_cm: 140,
    martindale: null,
    availability: 'out_of_stock',
    price_per_metre: 0,
    is_featured: false,
    is_curtain: true,
    is_blind: true,
    is_cushion: true,
    brand: { connect: [brandDocumentId] },
  };
}

async function findAshleyBrand(strapi) {
  const documents = strapi.documents(BRAND_UID);
  const brands = await documents.findMany({
    filters: { name: { $eqi: SUPPLIER } },
    status: 'draft',
  });
  const unique = logicalRows(brands);
  if (unique.length !== 1) throw new Error(`Expected exactly one Ashley Wilde brand document; found ${unique.length}.`);
  return unique[0];
}

async function findAshleyFabrics(strapi) {
  const rows = await strapi.entityService.findMany(FABRIC_UID, {
    // Read the complete local catalogue so cosmetic variants such as
    // "Birds & Roses" cannot evade the identity check.
    filters: {},
    populate: ['brand'],
    publicationState: 'preview',
    limit: 1000,
  });
  return logicalRows(rows).filter((row) => {
    const brands = Array.isArray(row.brand) ? row.brand : [row.brand];
    return brands.some((brand) => normalize(brand?.name) === normalize(SUPPLIER));
  });
}

function matchingRows(rows, target) {
  return rows.filter((row) => normalize(row.name) === normalize(target.name));
}

function assertNoConflictingIdentity(rows, target) {
  const matches = matchingRows(rows, target);
  if (matches.length > 1) {
    throw new Error(`Refusing ${target.name}: ${matches.length} Ashley Wilde Fabric documents share its normalized name.`);
  }
  if (!matches.length) return null;
  const existing = matches[0];
  const existingProductId = String(existing.productId || '');
  if (existingProductId && existingProductId !== target.productId && !/^FAB-/i.test(existingProductId)) {
    throw new Error(`Refusing ${target.name}: existing productId ${existingProductId} conflicts with ${target.supplierProductCode}.`);
  }
  return existing;
}

async function upsertBlockerFabrics(strapi) {
  const brand = await findAshleyBrand(strapi);
  const existingRows = await findAshleyFabrics(strapi);
  const existingByTarget = new Map(BLOCKER_FABRICS.map((target) => [
    target.name,
    assertNoConflictingIdentity(existingRows, target),
  ]));
  const fabricDocuments = strapi.documents(FABRIC_UID);
  const results = [];

  for (const target of BLOCKER_FABRICS) {
    const existing = existingByTarget.get(target.name);
    const data = fabricPayload(target, brand.documentId);
    const document = existing
      ? await fabricDocuments.update({ documentId: existing.documentId, data })
      : await fabricDocuments.create({ data });
    const published = await fabricDocuments.publish({ documentId: document.documentId });
    results.push({
      action: existing ? 'updated' : 'created',
      name: target.name,
      supplierProductCode: target.supplierProductCode,
      productId: target.productId,
      documentId: published.documentId,
      published: true,
    });
    if (!existing) existingRows.push({ ...published, brand: { name: SUPPLIER } });
  }
  return results;
}

async function main(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  if (!args.has('--confirm')) throw new Error('Catalogue mutation requires --confirm. Use --dry-run for inspection only.');
  if (!fs.existsSync(NORMAL_DATABASE)) throw new Error(`Normal local database not found: ${NORMAL_DATABASE}`);

  // Force the documented local target and refuse accidental alternate DBs.
  process.env.DATABASE_CLIENT = 'sqlite';
  process.env.DATABASE_FILENAME = '.tmp/data.db';
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';

  const app = createStrapi({ appDir: PROJECT_ROOT, distDir: path.join(PROJECT_ROOT, 'dist') });
  await app.register();
  await app.bootstrap();
  try {
    const results = await upsertBlockerFabrics(app);
    console.log(JSON.stringify({ database: path.relative(PROJECT_ROOT, NORMAL_DATABASE), results }, null, 2));
    return results;
  } finally {
    await app.destroy();
  }
}

if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

module.exports = {
  BLOCKER_FABRICS,
  fabricPayload,
  logicalRows,
  normalize,
  upsertBlockerFabrics,
};
