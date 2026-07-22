'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { seedPilotDatabase, targetPath: defaultPilotDatabase } = require('./ashley-wilde-pilot-seed');

function normalizedName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function validatePilotMappings(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.resolve(__dirname, '..'));
  const databasePath = path.resolve(options.databasePath || defaultPilotDatabase);
  const map = JSON.parse(fs.readFileSync(path.join(projectRoot, 'src/plugins/order-management/shared/ashley-wilde-colour-map.pilot.json'), 'utf8'));
  if (!fs.existsSync(databasePath)) throw new Error(`Pilot database not found at ${databasePath}; seed the isolated pilot database first.`);
  const db = new Database(databasePath, { readonly: true });
  const rows = db.prepare(`
    SELECT f.id, f.document_id AS documentId, f.name, f.published_at AS publishedAt,
           b.name AS brandName
      FROM fabrics f
      LEFT JOIN fabrics_brand_lnk fbl ON fbl.fabric_id = f.id
      LEFT JOIN brands b ON b.id = fbl.brand_id
  `).all();
  db.close();

  const resolved = [];
  const errors = [];
  for (const product of Object.values(map.products)) {
    const names = [product.fabricName, ...(product.approvedAliases || [])].map(normalizedName);
    const candidates = rows.filter((row) => names.includes(normalizedName(row.name)) && normalizedName(row.brandName) === normalizedName(map.supplier));
    const byDocument = new Map();
    for (const row of candidates) {
      const current = byDocument.get(row.documentId);
      if (!current || (current.publishedAt && !row.publishedAt)) byDocument.set(row.documentId, row);
    }
    const logical = [...byDocument.values()];
    const result = {
      supplierProductCode: product.supplierProductCode,
      fabricName: product.fabricName,
      mappedDocumentId: product.fabricDocumentId || null,
      resolvedDocumentId: logical.length === 1 ? logical[0].documentId : null,
    };
    if (!logical.length) {
      result.error = 'fabric_not_found_in_current_catalog';
      errors.push(result);
    } else if (logical.length > 1) {
      result.error = 'ambiguous_catalog_fabric';
      errors.push(result);
    }
    resolved.push(result);
  }

  const cachePath = path.resolve(options.cachePath || path.join(projectRoot, '.tmp', 'ashley-wilde-pilot-resolved.json'));
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify({ generatedAt: new Date().toISOString(), supplier: map.supplier, resolved }, null, 2));
  if (errors.length) {
    const details = errors.map((error) => `${error.supplierProductCode}: ${error.error}`).join('; ');
    throw new Error(`Ashley Wilde pilot mapping validation failed: ${details}`);
  }
  return { databasePath, resolved, errors, cachePath };
}

async function preparePilotFolder(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.resolve(__dirname, '..'));
  const seed = options.seed === false ? null : seedPilotDatabase({ force: false });
  const mappingValidation = options.validate === false ? null : validatePilotMappings({ projectRoot, databasePath: options.databasePath, cachePath: options.cachePath });
  const selection = JSON.parse(await fs.promises.readFile(path.join(__dirname, 'ashley-wilde-pilot-selection.json'), 'utf8'));
  const targetRoot = path.resolve(options.targetRoot || path.join(projectRoot, '.tmp', 'ashley-wilde-pilot-images'));
  await fs.promises.mkdir(targetRoot, { recursive: true });
  const copied = [];
  for (const item of selection.selectedImages) {
    const source = path.resolve(__dirname, item.source);
    const target = path.join(targetRoot, item.relativePath);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.copyFile(source, target);
    copied.push({ source: item.source, relativePath: item.relativePath, target: path.relative(projectRoot, target).replace(/\\/g, '/') });
  }
  return { targetRoot, copied, seed, mappingValidation };
}

if (require.main === module) preparePilotFolder().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { preparePilotFolder, validatePilotMappings };
