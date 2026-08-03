'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  brandRelationPayload,
  linkedBrandSummary,
  normalizeBrandName,
  sameBrand,
} = require('../src/plugins/order-management/server/services/catalog-import-brand');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const FABRIC_UID = 'api::fabric.fabric';
const BRAND_UID = 'api::brand.brand';

const DEFAULT_SOURCE_FILES = Object.freeze([
  'all-five-branded-fabrics-product-import.json',
  'clarissa-hulse-product-import.json',
  'emily-bond-product-import.json',
  'laura-ashley-product-import.json',
  'sara-miller-product-import.json',
  'william-morris-at-home-product-import.json',
]);

const INFERRED_BRANDS_BY_FILE = Object.freeze({
  'clarissa-hulse-product-import.json': 'Clarissa Hulse',
  'emily-bond-product-import.json': 'Emily Bond',
  'laura-ashley-product-import.json': 'Laura Ashley',
  'sara-miller-product-import.json': 'Sara Miller',
  'william-morris-at-home-product-import.json': 'William Morris At Home',
});

function resolveSourcePath(sourceFile) {
  if (path.isAbsolute(sourceFile)) return sourceFile;
  const projectPath = path.resolve(PROJECT_ROOT, sourceFile);
  if (fs.existsSync(projectPath)) return projectPath;
  return path.resolve(PROJECT_ROOT, 'exports', sourceFile);
}

function parseArgs(argv) {
  const sources = [];
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') {
      apply = true;
    } else if (argument === '--dry-run') {
      apply = false;
    } else if (argument === '--source') {
      if (!argv[index + 1]) throw new Error('--source requires a file path.');
      sources.push(argv[++index]);
    } else if (argument.startsWith('--source=')) {
      sources.push(argument.slice('--source='.length));
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { apply, sources: sources.length ? sources : [...DEFAULT_SOURCE_FILES] };
}

function rowsFromJson(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.fabrics)) return value.fabrics;
  if (Array.isArray(value.products)) return value.products;
  if (Array.isArray(value.data)) return value.data;
  if (value.data && typeof value.data === 'object') return rowsFromJson(value.data);
  if (value.result && typeof value.result === 'object') return rowsFromJson(value.result);
  return [];
}

function sourceBrandName(row, sourceFile) {
  const explicit = row?.brand_name || row?.brandName || row?.brand?.name;
  if (String(explicit || '').trim()) return String(explicit).trim();
  return INFERRED_BRANDS_BY_FILE[path.basename(sourceFile).toLocaleLowerCase()] || null;
}

function readSourceFiles(sourceFiles, projectRoot = PROJECT_ROOT) {
  const loaded = [];
  const missing = [];
  const invalid = [];

  for (const sourceFile of sourceFiles) {
    const resolved = path.isAbsolute(sourceFile)
      ? sourceFile
      : (() => {
        const projectPath = path.resolve(projectRoot, sourceFile);
        return fs.existsSync(projectPath) ? projectPath : path.resolve(projectRoot, 'exports', sourceFile);
      })();
    if (!fs.existsSync(resolved)) {
      missing.push(resolved);
      continue;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
      loaded.push({ sourceFile: resolved, rows: rowsFromJson(parsed) });
    } catch (error) {
      invalid.push({ sourceFile: resolved, error: error.message });
    }
  }

  return { loaded, missing, invalid };
}

function collectSourceFabrics(loadedSources) {
  const records = [];
  const invalidRows = [];

  for (const source of loadedSources || []) {
    source.rows.forEach((row, sourceIndex) => {
      const productId = String(row?.productId ?? '').trim();
      const brandName = sourceBrandName(row, source.sourceFile);
      if (!productId || !brandName) {
        invalidRows.push({
          sourceFile: source.sourceFile,
          sourceIndex,
          productId: productId || null,
          brandName: brandName || null,
          reason: !productId ? 'missing_productId' : 'missing_brand_name',
        });
        return;
      }
      records.push({
        sourceFile: source.sourceFile,
        sourceIndex,
        productId,
        fabricName: String(row.name || '').trim() || null,
        brandName,
      });
    });
  }

  return { records, invalidRows };
}

function groupByExactProductId(records) {
  const grouped = new Map();
  for (const record of records) {
    const list = grouped.get(record.productId) || [];
    list.push(record);
    grouped.set(record.productId, list);
  }
  return grouped;
}

function brandCandidates(brands, brandName) {
  const key = normalizeBrandName(brandName);
  return (brands || []).filter((brand) => normalizeBrandName(brand?.name) === key);
}

function fabricCandidates(fabrics, productId) {
  const key = String(productId);
  return (fabrics || []).filter((fabric) => String(fabric?.productId ?? '') === key);
}

function emptySummary() {
  return {
    sourceRows: 0,
    uniqueProductIds: 0,
    alreadyCorrect: 0,
    toRepair: 0,
    missingFabrics: 0,
    ambiguousFabrics: 0,
    missingBrands: 0,
    ambiguousBrands: 0,
    invalidSourceRows: 0,
  };
}

function addBrandCount(grouped, brandName, field) {
  const key = brandName || '(missing Brand name)';
  const entry = grouped[key] || { sourceRows: 0, alreadyCorrect: 0, toRepair: 0, missingFabrics: 0, ambiguousFabrics: 0, missingBrands: 0, ambiguousBrands: 0 };
  entry[field] += 1;
  grouped[key] = entry;
}

function buildRepairPlan({ sourceRecords, invalidRows = [], fabrics, brands }) {
  const summary = emptySummary();
  const byBrand = {};
  const operations = [];
  const sourceGroups = groupByExactProductId(sourceRecords);
  summary.sourceRows = sourceRecords.length;
  summary.uniqueProductIds = sourceGroups.size;
  summary.invalidSourceRows = invalidRows.length;

  for (const [productId, sourceMatches] of sourceGroups) {
    const source = sourceMatches[0];
    const distinctBrandNames = new Set(sourceMatches.map((match) => normalizeBrandName(match.brandName)));
    const base = {
      productId,
      fabricName: source.fabricName,
      requestedBrandName: source.brandName,
      sourceMatches,
    };

    if (sourceMatches.length > 1 && distinctBrandNames.size > 1) {
      summary.ambiguousFabrics += 1;
      addBrandCount(byBrand, source.brandName, 'ambiguousFabrics');
      operations.push({ ...base, status: 'ambiguous_source_productId', reason: 'same productId has different source Brands' });
      continue;
    }

    const matchingFabrics = fabricCandidates(fabrics, productId);
    if (matchingFabrics.length === 0) {
      summary.missingFabrics += 1;
      addBrandCount(byBrand, source.brandName, 'missingFabrics');
      operations.push({ ...base, status: 'missing_fabric' });
      continue;
    }
    if (matchingFabrics.length > 1) {
      summary.ambiguousFabrics += 1;
      addBrandCount(byBrand, source.brandName, 'ambiguousFabrics');
      operations.push({ ...base, status: 'ambiguous_fabric', fabricCandidates: matchingFabrics.map((fabric) => ({ id: fabric.id ?? null, documentId: fabric.documentId ?? null })) });
      continue;
    }

    const matchingBrands = brandCandidates(brands, source.brandName);
    if (matchingBrands.length === 0) {
      summary.missingBrands += 1;
      addBrandCount(byBrand, source.brandName, 'missingBrands');
      operations.push({ ...base, status: 'missing_brand', fabric: matchingFabrics[0] });
      continue;
    }
    if (matchingBrands.length > 1) {
      summary.ambiguousBrands += 1;
      addBrandCount(byBrand, source.brandName, 'ambiguousBrands');
      operations.push({ ...base, status: 'ambiguous_brand', fabric: matchingFabrics[0] });
      continue;
    }

    const fabric = matchingFabrics[0];
    const brand = matchingBrands[0];
    const alreadyCorrect = sameBrand(brand, fabric.brand);
    const status = alreadyCorrect ? 'already_correct' : 'needs_repair';
    summary[alreadyCorrect ? 'alreadyCorrect' : 'toRepair'] += 1;
    addBrandCount(byBrand, source.brandName, alreadyCorrect ? 'alreadyCorrect' : 'toRepair');
    operations.push({
      ...base,
      status,
      fabric,
      brand,
      relation: brandRelationPayload(brand),
    });
  }

  return { summary, byBrand, operations, invalidRows };
}

function preferredExamples(operations) {
  const preferred = ['Alice', 'Artists Stripe'];
  const examples = [];
  for (const name of preferred) {
    const match = operations.find((operation) => operation.fabricName === name);
    if (match) examples.push({ fabricName: name, requestedBrandName: match.requestedBrandName, productId: match.productId, status: match.status });
  }
  const byBrand = new Set();
  for (const operation of operations) {
    if (!operation.requestedBrandName || byBrand.has(normalizeBrandName(operation.requestedBrandName))) continue;
    byBrand.add(normalizeBrandName(operation.requestedBrandName));
    if (!examples.some((example) => example.productId === operation.productId)) {
      examples.push({ fabricName: operation.fabricName, requestedBrandName: operation.requestedBrandName, productId: operation.productId, status: operation.status });
    }
  }
  return examples;
}

function assertApplySafe(plan) {
  const { summary } = plan;
  if (plan.invalidRows.length || summary.missingFabrics || summary.ambiguousFabrics || summary.missingBrands || summary.ambiguousBrands) {
    throw new Error(`Refusing --apply: source or catalogue validation is not unambiguous (${JSON.stringify(summary)}).`);
  }
}

async function buildPlanFromStrapi(strapi, sourceData) {
  const { records, invalidRows } = collectSourceFabrics(sourceData.loaded);
  const productIds = [...new Set(records.map((record) => record.productId))];
  const fabrics = productIds.length
    ? await strapi.entityService.findMany(FABRIC_UID, {
      filters: { productId: { $in: productIds } },
      populate: { brand: true },
      publicationState: 'preview',
      limit: Math.max(productIds.length * 2, 1000),
    })
    : [];
  const brands = await strapi.entityService.findMany(BRAND_UID, {
    filters: {},
    publicationState: 'preview',
    limit: 1000,
  });
  return buildRepairPlan({ sourceRecords: records, invalidRows, fabrics, brands });
}

async function applyRepairPlan(strapi, plan) {
  assertApplySafe(plan);
  const repaired = [];
  for (const operation of plan.operations) {
    if (operation.status !== 'needs_repair') continue;
    const identifier = operation.fabric.id ?? operation.fabric.documentId;
    await strapi.entityService.update(FABRIC_UID, identifier, { data: { brand: operation.relation } });
    repaired.push({
      productId: operation.productId,
      fabricName: operation.fabricName,
      brand: linkedBrandSummary(operation.brand),
    });
  }
  return repaired;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const sourceData = readSourceFiles(options.sources);
  if (sourceData.missing.length || sourceData.invalid.length) {
    console.log(JSON.stringify({
      mode: options.apply ? 'apply' : 'dry-run',
      status: 'blocked',
      message: 'Source files must be present and valid before the repair plan can be evaluated.',
      missingSourceFiles: sourceData.missing,
      invalidSourceFiles: sourceData.invalid,
      writesPerformed: 0,
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  const { createStrapi } = require('@strapi/strapi');
  const app = createStrapi({ appDir: PROJECT_ROOT, distDir: path.join(PROJECT_ROOT, 'dist') });
  await app.register();
  await app.bootstrap();
  try {
    const plan = await buildPlanFromStrapi(app, sourceData);
    const report = {
      mode: options.apply ? 'apply' : 'dry-run',
      status: 'ready',
      summary: plan.summary,
      byBrand: plan.byBrand,
      examples: preferredExamples(plan.operations),
      operations: plan.operations.map((operation) => ({
        productId: operation.productId,
        fabricName: operation.fabricName,
        requestedBrandName: operation.requestedBrandName,
        status: operation.status,
      })),
      writesPerformed: 0,
    };
    if (options.apply) {
      const repaired = await applyRepairPlan(app, plan);
      report.repaired = repaired;
      report.writesPerformed = repaired.length;
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_SOURCE_FILES,
  applyRepairPlan,
  assertApplySafe,
  buildPlanFromStrapi,
  buildRepairPlan,
  collectSourceFabrics,
  fabricCandidates,
  groupByExactProductId,
  main,
  parseArgs,
  preferredExamples,
  readSourceFiles,
  rowsFromJson,
  sourceBrandName,
};
