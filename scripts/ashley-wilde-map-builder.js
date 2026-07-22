'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  SUPPLIER, SUPPORTED_EXTENSIONS, loadProductionMappings, normalizeRelativePath,
  normalizeToken, validateCodeRegistry, validateColourMap,
} = require('../src/plugins/order-management/shared/ashley-wilde-mapping');

const SOURCE_DOMAIN = 'ashleywildegroup.com';
const SOURCE_ROOT = `https://${SOURCE_DOMAIN}`;
const USER_AGENT = 'AshleyWildeLocalMapper/1.0 (local catalogue reconciliation; no upload)';
const PROJECT_DIR = path.resolve(__dirname, '..');
const SHARED_DIR = path.join(PROJECT_DIR, 'src/plugins/order-management/shared');
const DEFAULT_IMAGE_ROOT = path.resolve(PROJECT_DIR, '../Fabric-Images');
const DEFAULT_OUTPUT_DIR = path.join(PROJECT_DIR, '.tmp/ashley-wilde-generated');
const DEFAULT_CACHE_DIR = path.join(PROJECT_DIR, '.tmp/ashley-wilde-crawl-cache');
const PILOT_MAP = path.join(SHARED_DIR, 'ashley-wilde-colour-map.pilot.json');
const MAP_FILE = path.join(SHARED_DIR, 'ashley-wilde-colour-map.json');
const REGISTRY_FILE = path.join(SHARED_DIR, 'ashley-wilde-code-registry.json');
const IMAGE_EXTENSIONS = new Set(SUPPORTED_EXTENSIONS);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function contentHash(value) {
  return crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function normalizeCopySuffix(stem) {
  let value = String(stem || '').normalize('NFKC').trim();
  let previous;
  do {
    previous = value;
    value = value
      .replace(/\s*-?\s*copy(?:\s+\d+|\s*\(\d+\))?\s*$/i, '')
      .replace(/\s*\(\d+\)\s*$/i, '')
      .trim();
  } while (value !== previous);
  return value;
}

function normalizeName(value) {
  return normalizeToken(normalizeCopySuffix(String(value || '').replace(/\.[^.]+$/, '')));
}

async function walk(root, current = root) {
  const output = [];
  const entries = await fs.promises.readdir(current, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) output.push(...await walk(root, absolute));
    else if (entry.isFile()) output.push({ absolute, relativePath: normalizeRelativePath(path.relative(root, absolute)) });
  }
  return output;
}

async function sha256File(filename) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filename);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

function logicalRows(rows) {
  const byDocument = new Map();
  for (const row of rows || []) {
    const key = row.documentId || row.id;
    const previous = byDocument.get(key);
    if (!previous || (previous.publishedAt && !row.publishedAt)) byDocument.set(key, row);
  }
  return [...byDocument.values()];
}

function loadSqliteCatalogue(dbFile = path.join(PROJECT_DIR, '.tmp/data.db')) {
  if (!fs.existsSync(dbFile)) return { source: 'none', fabrics: [], warnings: [`Catalogue database not found: ${path.basename(dbFile)}`] };
  let db;
  try {
    const Database = require('better-sqlite3');
    db = new Database(dbFile, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    if (!tables.has('fabrics')) throw new Error('fabrics table is missing');
    const columns = new Set(db.prepare('PRAGMA table_info(fabrics)').all().map((row) => row.name));
    const select = ['id', 'document_id AS documentId', 'name', 'collection', 'description', 'product_id AS productId', 'published_at AS publishedAt']
      .filter((expression) => columns.has(expression.split(/\s+/)[0]));
    let rows = db.prepare(`SELECT ${select.join(', ')} FROM fabrics`).all();
    if (tables.has('brands') && tables.has('fabrics_brand_lnk')) {
      const brand = db.prepare('SELECT id FROM brands WHERE lower(trim(name)) = lower(trim(?))').get(SUPPLIER);
      if (brand) {
        const links = db.prepare('SELECT fabric_id FROM fabrics_brand_lnk WHERE brand_id = ?').all(brand.id);
        const ids = new Set(links.map((link) => link.fabric_id));
        rows = rows.filter((row) => ids.has(row.id));
      }
    }
    return { source: 'sqlite-readonly', fabrics: logicalRows(rows), warnings: [] };
  } catch (error) {
    return { source: 'none', fabrics: [], warnings: [`Read-only catalogue load failed: ${error.message}`] };
  } finally {
    if (db) db.close();
  }
}

function knownProducts(catalogue, pilotMap, approvedMap = { products: {} }) {
  const values = [];
  for (const fabric of catalogue.fabrics || []) {
    if (!fabric.name) continue;
    const catalogueCode = normalizeName(fabric.productId);
    // Existing FAB...#### values are internal catalogue IDs, not Ashley Wilde
    // supplier product codes. Official Ashley Wilde codes use the product name.
    const supplierProductCode = catalogueCode && !/^FAB[A-Z0-9]+\d{3,}$/.test(catalogueCode)
      ? catalogueCode : normalizeName(fabric.name);
    values.push({
      productName: String(fabric.name).trim(), fabricName: String(fabric.name).trim(),
      supplierProductCode,
      fabricDocumentId: fabric.documentId || null, strapiCollection: fabric.collection || null,
      strapiDescription: fabric.description || null,
    });
  }
  for (const product of Object.values(pilotMap.products || {})) {
    if (!values.some((item) => normalizeName(item.fabricName) === normalizeName(product.fabricName))) values.push({
      productName: product.productName, fabricName: product.fabricName,
      supplierProductCode: product.supplierProductCode, fabricDocumentId: product.fabricDocumentId || null,
      strapiCollection: null, strapiDescription: null,
    });
  }
  for (const product of Object.values(approvedMap.products || {})) {
    if (!values.some((item) => normalizeName(item.supplierProductCode) === normalizeName(product.supplierProductCode))) values.push({
      productName: product.productName, fabricName: product.fabricName,
      supplierProductCode: product.supplierProductCode, fabricDocumentId: product.fabricDocumentId || null,
      strapiCollection: null, strapiDescription: null,
    });
  }
  return values.sort((a, b) => normalizeName(b.supplierProductCode).length - normalizeName(a.supplierProductCode).length || a.fabricName.localeCompare(b.fabricName));
}

function parseInventoryFilename(filename, products) {
  const extension = path.extname(filename).toLowerCase();
  const rawStem = path.basename(filename, extension);
  const cleanStem = normalizeCopySuffix(rawStem);
  const normalizedStem = normalizeName(cleanStem);
  const candidates = [];
  for (const product of products) {
    const prefixes = new Set([product.supplierProductCode, product.productName, product.fabricName].map(normalizeName).filter(Boolean));
    for (const prefix of prefixes) {
      if (normalizedStem.startsWith(prefix) && normalizedStem.length > prefix.length) candidates.push({ product, prefix });
    }
  }
  if (!candidates.length) return { status: 'unknown_mapping_product', rawStem, cleanStem, normalizedStem };
  const longest = Math.max(...candidates.map((candidate) => candidate.prefix.length));
  const winners = candidates.filter((candidate) => candidate.prefix.length === longest);
  const identities = new Set(winners.map((candidate) => candidate.product.fabricDocumentId || normalizeName(candidate.product.fabricName)));
  if (identities.size !== 1) return { status: 'ambiguous_filename', rawStem, cleanStem, normalizedStem };
  const winner = winners[0];
  return {
    status: 'parsed', rawStem, cleanStem, normalizedStem,
    supplierProductCode: normalizeName(winner.product.supplierProductCode),
    supplierColourCode: normalizedStem.slice(winner.prefix.length),
    fabricName: winner.product.fabricName, productName: winner.product.productName,
    fabricDocumentId: winner.product.fabricDocumentId || null,
    strapiCollection: winner.product.strapiCollection || null,
    strapiDescription: winner.product.strapiDescription || null,
  };
}

async function buildInventory(rootDir, products, previousFiles = [], refreshHashes = false, previousGeneratedAt = null) {
  const files = (await walk(rootDir)).filter((file) => IMAGE_EXTENSIONS.has(path.extname(file.relativePath).toLowerCase()));
  const inventory = [];
  const hashes = new Map();
  const identities = new Map();
  const previousByPath = new Map((previousFiles || []).map((row) => [row.relativePath, row]));
  for (const file of files) {
    const stats = await fs.promises.stat(file.absolute);
    const parsed = parseInventoryFilename(path.basename(file.relativePath), products);
    const previous = previousByPath.get(file.relativePath);
    const unchanged = previous?.modifiedMs === stats.mtimeMs
      || (!previous?.modifiedMs && previousGeneratedAt && stats.mtimeMs <= Date.parse(previousGeneratedAt));
    const sha256 = !refreshHashes && previous?.size === stats.size && unchanged && /^[a-f0-9]{64}$/.test(previous.sha256 || '')
      ? previous.sha256
      : await sha256File(file.absolute); // deliberately sequential: image bytes are never accumulated
    const parts = file.relativePath.split('/');
    const row = {
      topLevelFolder: parts.length > 1 ? parts[0] : '', relativeFolder: parts.slice(0, -1).join('/'),
      relativePath: file.relativePath, filename: path.basename(file.relativePath), extension: path.extname(file.relativePath).toLowerCase(),
      size: stats.size, modifiedMs: stats.mtimeMs, normalizedBasename: normalizeName(path.basename(file.relativePath, path.extname(file.relativePath))),
      normalizedFilename: `${normalizeName(normalizeCopySuffix(path.basename(file.relativePath, path.extname(file.relativePath))))}${path.extname(file.relativePath).toLowerCase()}`,
      sha256, ...parsed,
    };
    inventory.push(row);
    if (!hashes.has(sha256)) hashes.set(sha256, []);
    hashes.get(sha256).push(file.relativePath);
    if (parsed.supplierProductCode && parsed.supplierColourCode) {
      const key = `${parsed.supplierProductCode}/${parsed.supplierColourCode}`;
      if (!identities.has(key)) identities.set(key, []);
      identities.get(key).push(row);
    }
  }
  const exactDuplicates = [...hashes.entries()].filter(([, paths]) => paths.length > 1).map(([sha256, paths]) => ({ sha256, paths }));
  const conflictingImages = [...identities.entries()].filter(([, rows]) => new Set(rows.map((row) => row.sha256)).size > 1)
    .map(([identity, rows]) => ({ identity, paths: rows.map((row) => row.relativePath), hashes: [...new Set(rows.map((row) => row.sha256))] }));
  return {
    files: inventory, exactDuplicates, conflictingImages,
    uniqueProductPrefixes: [...new Set(inventory.map((row) => row.supplierProductCode).filter(Boolean))].sort(),
    uniqueProductColourPairs: [...identities.keys()].sort(),
  };
}

function decodeHtml(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function absoluteOfficialUrl(value) {
  try {
    const url = new URL(decodeHtml(value), SOURCE_ROOT);
    return url.hostname === SOURCE_DOMAIN || url.hostname.endsWith(`.${SOURCE_DOMAIN}`) ? url.href : null;
  } catch { return null; }
}

function parseSwatchPage(html, sourceUrl, fetchedAt = new Date().toISOString()) {
  const blocks = String(html || '').match(/<li[^>]+class=["'][^"']*product-item[^"']*["'][\s\S]*?<\/li>/gi) || [];
  const entries = [];
  for (const block of blocks) {
    const link = block.match(/<a[^>]+class=["'][^"']*product-item-link[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a[^>]+href=["']([^"']+)["'][^>]+class=["'][^"']*product-item-link[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const title = decodeHtml(link[2]);
    const image = block.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["'][^>]*>/i);
    entries.push({ title, productUrl: absoluteOfficialUrl(link[1]), imageUrl: image ? absoluteOfficialUrl(image[1]) : null, sourceUrl, fetchedAt });
  }
  const total = Number((String(html).match(/Items?\s+[\d,]+-[\d,]+\s+of\s+([\d,]+)/i) || [])[1]?.replace(/,/g, '')) || entries.length;
  return { entries, total };
}

function parseProductPage(html, url, fetchedAt = new Date().toISOString()) {
  const text = decodeHtml(html);
  const title = decodeHtml((String(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]);
  const productCodeBlock = (String(html).match(/Product\s*Code\s*:?\s*(?:<[^>]+>\s*)*([A-Z0-9_-]+)/i) || [])[1]
    || (text.match(/Product\s*Code\s*:?\s*([A-Z0-9_-]+)/i) || [])[1];
  const productCode = decodeHtml(productCodeBlock);
  const collection = decodeHtml((String(html).match(/<a[^>]+href=["'][^"']*\/fabrics\/ashley-wilde\/[^"']+-collection\/?["'][^>]*>([\s\S]*?)<\/a>/i) || [])[1]);
  return { title, productCode: normalizeName(productCode || title.split(/\s+/)[0]), collection: collection || null, productUrl: url, fetchedAt };
}

function splitOfficialTitle(title, known) {
  const normalized = normalizeName(title);
  const matches = known.filter((product) => normalized.startsWith(normalizeName(product.productName)) && normalized.length > normalizeName(product.productName).length);
  if (!matches.length) return null;
  matches.sort((a, b) => normalizeName(b.productName).length - normalizeName(a.productName).length);
  const product = matches[0];
  const words = String(title).trim();
  const colourName = words.slice(product.productName.length).trim();
  return colourName ? { product, colourName } : null;
}

function seedPilotOfficial(pilotMap) {
  const products = {};
  for (const product of Object.values(pilotMap.products || {})) {
    const key = normalizeName(product.supplierProductCode);
    if (!products[key]) products[key] = { supplier: SUPPLIER, productName: product.productName, supplierProductCode: key, collection: null, collectionUrl: null, productUrl: null, colourways: [] };
    for (const colour of Object.values(product.colours || {})) {
      if (!colour.resolved || !colour.evidence) continue;
      products[key].productUrl ||= colour.evidence.productUrl || null;
      products[key].colourways.push({
        colourName: colour.supplierColourName, supplierColourCodeHint: colour.supplierColourCode,
        colourwayUrl: colour.evidence.colourwayUrl || colour.evidence.productUrl || null,
        imageUrl: colour.evidence.imageUrl || null, sourceUrl: colour.evidence.colourwayUrl || colour.evidence.productUrl || null,
        fetchedAt: colour.evidence.fetchedAt || null, source: 'approved-pilot-evidence',
      });
    }
  }
  return products;
}

function validateSearchEvidence(value, label = 'web-search evidence') {
  if (!value || value.schemaVersion !== 1 || value.sourceDomain !== SOURCE_DOMAIN || !Array.isArray(value.entries)) throw new Error(`${label} has an invalid header`);
  const expanded = value.entries.flatMap((entry) => Array.isArray(entry.colours) && entry.colours.length
    ? entry.colours.map((colour) => ({ ...entry, colours: undefined, colour }))
    : [entry]);
  return expanded.map((entry, index) => {
    const officialUrl = absoluteOfficialUrl(entry.officialUrl);
    if (!entry.query || !officialUrl || !entry.officialPageTitle || !entry.product || !entry.retrievedAt || !entry.evidenceExcerpt) throw new Error(`${label} entry ${index + 1} is incomplete`);
    const expectedHash = crypto.createHash('sha256').update(String(entry.evidenceExcerpt), 'utf8').digest('hex');
    if (entry.evidenceHash && entry.evidenceHash !== expectedHash) throw new Error(`${label} entry ${index + 1} has an invalid excerpt hash`);
    return { ...entry, officialUrl, evidenceHash: expectedHash };
  });
}

function mergeStructuredEvidence(catalogue, evidence, products, adapter) {
  for (const entry of evidence || []) {
    const known = products.find((product) => normalizeName(product.productName) === normalizeName(entry.product) || normalizeName(product.supplierProductCode) === normalizeName(entry.productCode));
    if (!known) continue;
    const code = normalizeName(entry.productCode || known.supplierProductCode);
    if (!catalogue[code]) catalogue[code] = { supplier: SUPPLIER, productName: known.productName, supplierProductCode: code, collection: null, collectionUrl: null, productUrl: null, colourways: [] };
    const product = catalogue[code];
    product.productName = entry.product;
    product.productUrl ||= entry.officialUrl;
    product.collection ||= entry.collection || null;
    product.collectionUrl ||= entry.collectionUrl ? absoluteOfficialUrl(entry.collectionUrl) : null;
    product.evidence ||= [];
    product.evidence.push({ adapter, query: entry.query, officialUrl: entry.officialUrl, officialPageTitle: entry.officialPageTitle, retrievedAt: entry.retrievedAt, evidenceExcerpt: entry.evidenceExcerpt, evidenceHash: entry.evidenceHash });
    if (entry.colour) {
      const previous = product.colourways.find((colour) => normalizeName(colour.colourName) === normalizeName(entry.colour));
      const colourway = { colourName: entry.colour, supplierColourCodeHint: entry.supplierColourCodeHint || null, colourwayUrl: entry.officialUrl, imageUrl: entry.imageUrl ? absoluteOfficialUrl(entry.imageUrl) : null, sourceUrl: entry.officialUrl, fetchedAt: entry.retrievedAt, source: adapter, evidenceHash: entry.evidenceHash };
      if (previous) Object.assign(previous, colourway);
      else product.colourways.push(colourway);
    }
  }
}

async function loadEvidenceAdapter(filename, products, catalogue, adapter, warnings) {
  if (!fs.existsSync(filename)) return 0;
  try {
    const parsed = JSON.parse(await fs.promises.readFile(filename, 'utf8'));
    const entries = validateSearchEvidence(parsed, `${adapter} evidence`);
    if (parsed.entries.length !== entries.length || parsed.entries.some((entry, index) => entry.evidenceHash !== entries[index]?.evidenceHash)) {
      await writeJson(filename, { ...parsed, entries });
    }
    mergeStructuredEvidence(catalogue, entries, products, adapter);
    return entries.length;
  } catch (error) {
    warnings.push(`${adapter} cache rejected: ${error.message}`);
    return 0;
  }
}

function makeSearchQueries(products, catalogue) {
  const queries = [];
  for (const product of products) {
    const code = normalizeName(product.supplierProductCode);
    const known = catalogue[code];
    if (!known?.productUrl || !known.collection) queries.push({ type: 'product', product: product.productName, query: `site:${SOURCE_DOMAIN} "${product.productName}" "Product Code"` });
    if (!known?.colourways?.length) queries.push({ type: 'swatches', product: product.productName, query: `site:${SOURCE_DOMAIN}/fabrics/swatch-search "${product.productName}"` });
  }
  return queries;
}

function cacheName(url) { return `${crypto.createHash('sha256').update(url).digest('hex')}.html`; }
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cachedFetch(url, options) {
  const file = path.join(options.cacheDir, cacheName(url));
  if (!options.refresh && fs.existsSync(file)) return { html: await fs.promises.readFile(file, 'utf8'), fromCache: true };
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (options.rateLimitMs) await delay(options.rateLimitMs);
    try {
      const response = await (options.fetchImpl || fetch)(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, redirect: 'follow' });
      const html = await response.text();
      if (response.ok && !/challenge-error-text|Bad gateway/i.test(html)) {
        await fs.promises.mkdir(options.cacheDir, { recursive: true });
        await fs.promises.writeFile(file, html, 'utf8');
        return { html, fromCache: false };
      }
      if (/challenge-error-text|Bad gateway|Enable JavaScript and cookies to continue/i.test(html)) {
        const blocked = new Error(`Official HTTP adapter blocked (${response.status || 'interstitial'})`);
        blocked.permanent = true;
        throw blocked;
      }
      if (response.status !== 429 && response.status < 500) {
        const permanent = new Error(`HTTP ${response.status}`);
        permanent.permanent = true;
        throw permanent;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (error.permanent) break;
    }
    await delay(250 * (2 ** attempt));
  }
  if (fs.existsSync(file)) return { html: await fs.promises.readFile(file, 'utf8'), fromCache: true, stale: true };
  throw lastError || new Error('Official page fetch failed');
}

async function crawlOfficial(products, pilotMap, options = {}) {
  const catalogue = seedPilotOfficial(pilotMap);
  const warnings = [];
  const extractedAt = new Date().toISOString();
  // Adapter order: approved/cache seed, direct HTTP, browser-rendered cache, web-search cache.
  // Browser and web-search adapters are structured cache inputs because this local Node
  // command deliberately owns no browser session or search-engine credentials.
  if (!options.refresh && !options.allowNetwork) {
    await loadEvidenceAdapter(path.join(options.cacheDir, 'browser-evidence.json'), products, catalogue, 'browser-rendered-official', warnings);
    await loadEvidenceAdapter(path.join(options.cacheDir, 'web-search-evidence.json'), products, catalogue, 'web-search-official-index', warnings);
    return { products: catalogue, warnings, extractedAt, sourceDomain: SOURCE_DOMAIN, pendingSearchQueries: makeSearchQueries(products, catalogue) };
  }
  const base = `${SOURCE_ROOT}/fabrics/swatch-search/?manufacturer=Ashley+Wilde`;
  try {
    let page = 1;
    let seen = 0;
    do {
      const url = `${base}&p=${page}`;
      const response = await cachedFetch(url, options);
      const parsed = parseSwatchPage(response.html, url, extractedAt);
      if (!parsed.entries.length) throw new Error(`No swatches parsed from page ${page}`);
      for (const entry of parsed.entries) {
        const split = splitOfficialTitle(entry.title, products);
        if (!split) continue;
        const code = normalizeName(split.product.supplierProductCode);
        if (!catalogue[code]) catalogue[code] = { supplier: SUPPLIER, productName: split.product.productName, supplierProductCode: code, collection: null, collectionUrl: null, productUrl: entry.productUrl, colourways: [] };
        const existing = catalogue[code].colourways.find((colour) => normalizeName(colour.colourName) === normalizeName(split.colourName));
        const colourway = { colourName: split.colourName, supplierColourCodeHint: null, colourwayUrl: entry.productUrl, imageUrl: entry.imageUrl, sourceUrl: url, fetchedAt: extractedAt, source: 'official-swatch-search' };
        if (existing) Object.assign(existing, colourway);
        else catalogue[code].colourways.push(colourway);
        catalogue[code].productUrl ||= entry.productUrl;
      }
      seen += parsed.entries.length;
      page += 1;
      if (page > 100) throw new Error('Swatch pagination safety limit reached');
      if (seen >= parsed.total) break;
    } while (true);
  } catch (error) { warnings.push(`Official refresh unavailable; cached/pilot evidence retained: ${error.message}`); }
  await loadEvidenceAdapter(path.join(options.cacheDir, 'browser-evidence.json'), products, catalogue, 'browser-rendered-official', warnings);
  await loadEvidenceAdapter(path.join(options.cacheDir, 'web-search-evidence.json'), products, catalogue, 'web-search-official-index', warnings);
  for (const product of Object.values(catalogue)) product.colourways.sort((a, b) => a.colourName.localeCompare(b.colourName));
  return { products: catalogue, warnings, extractedAt, sourceDomain: SOURCE_DOMAIN, pendingSearchQueries: makeSearchQueries(products, catalogue) };
}

async function imageHash(filename) {
  const sharp = require('sharp');
  const { data } = await sharp(filename).resize(16, 16, { fit: 'fill' }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const average = data.reduce((sum, value) => sum + value, 0) / data.length;
  return [...data].map((value) => value >= average ? '1' : '0').join('');
}

function hashSimilarity(left, right) {
  if (!left || !right || left.length !== right.length) return null;
  let equal = 0;
  for (let i = 0; i < left.length; i += 1) if (left[i] === right[i]) equal += 1;
  return equal / left.length;
}

async function compareCachedOfficialImages(inventory, official, cacheDir) {
  const comparisons = new Map();
  const localHashCache = new Map();
  const officialHashCache = new Map();
  const imageDir = path.join(cacheDir, 'images');
  for (const [productCode, product] of Object.entries(official.products || {})) {
    const localRows = inventory.files.filter((row) => row.supplierProductCode === productCode);
    if (!localRows.length) continue;
    const officialImages = [];
    for (const colour of product.colourways || []) {
      if (!colour.imageUrl) continue;
      const cached = path.join(imageDir, `${crypto.createHash('sha256').update(colour.imageUrl).digest('hex')}.img`);
      if (!fs.existsSync(cached)) continue;
      let hashes = officialHashCache.get(cached);
      if (!hashes) {
        hashes = { sha256: await sha256File(cached), perceptual: await imageHash(cached) };
        officialHashCache.set(cached, hashes);
      }
      officialImages.push({ colour, ...hashes });
    }
    if (!officialImages.length) continue;
    const identities = new Map();
    for (const row of localRows) {
      const key = `${row.supplierProductCode}/${row.supplierColourCode}`;
      if (!identities.has(key)) identities.set(key, []);
      identities.get(key).push(row);
    }
    for (const [identity, rows] of identities) {
      if (new Set(rows.map((row) => row.sha256)).size !== 1) continue;
      const row = rows[0];
      let localPerceptual = localHashCache.get(row.absolutePath || row.relativePath);
      if (!localPerceptual) {
        const absolute = path.join(inventory.rootDir, ...row.relativePath.split('/'));
        localPerceptual = await imageHash(absolute);
        localHashCache.set(row.relativePath, localPerceptual);
      }
      const scores = officialImages.map((candidate) => ({
        ...candidate, exact: candidate.sha256 === row.sha256 ? 1 : 0,
        perceptual: hashSimilarity(localPerceptual, candidate.perceptual),
      })).sort((a, b) => b.exact - a.exact || b.perceptual - a.perceptual || a.colour.colourName.localeCompare(b.colour.colourName));
      const best = scores[0];
      const second = scores[1];
      const uniqueStrong = best.exact === 1
        || (best.perceptual >= 0.92 && (!second || best.perceptual - second.perceptual >= 0.03));
      comparisons.set(identity, { colour: best.colour, exactSimilarity: best.exact, perceptualSimilarity: best.perceptual, runnerUpSimilarity: second?.perceptual ?? null, uniqueStrong });
    }
  }
  return comparisons;
}

function suffixCompatible(suffix, colourName) {
  const left = normalizeName(suffix);
  const right = normalizeName(colourName);
  return Boolean(left && right && (right.startsWith(left) || normalizeName(right.split(/\s+/).map((word) => word[0]).join('')) === left));
}

function allocateCode(colourName, preferred, registry) {
  const canonical = normalizeName(colourName);
  for (const [code, entry] of Object.entries(registry.codes)) if (normalizeName(entry.colourName) === canonical) return { code, created: false };
  const preferredCode = normalizeName(preferred);
  if (preferredCode && (!registry.codes[preferredCode] || normalizeName(registry.codes[preferredCode].colourName) === canonical)) return { code: preferredCode, created: true };
  const letters = canonical || 'COLOUR';
  for (let length = 1; length <= letters.length; length += 1) {
    const code = letters.slice(0, length);
    if (!registry.codes[code]) return { code, created: true };
  }
  let counter = 2;
  while (registry.codes[`${letters}${counter}`]) counter += 1;
  return { code: `${letters}${counter}`, created: true };
}

function matchInventory(inventory, official, approvedRegistry, comparisons = new Map()) {
  const registry = JSON.parse(JSON.stringify(approvedRegistry));
  const evidence = [];
  const newCodes = [];
  const candidateProducts = {};
  const byIdentity = new Map();
  for (const row of inventory.files) {
    if (!row.supplierProductCode || !row.supplierColourCode) {
      evidence.push({ relativePath: row.relativePath, localProduct: null, supplierColourCode: null, confidence: 'UNRESOLVED', reason: row.status });
      continue;
    }
    const identity = `${row.supplierProductCode}/${row.supplierColourCode}`;
    if (!byIdentity.has(identity)) byIdentity.set(identity, []);
    byIdentity.get(identity).push(row);
  }
  for (const [identity, rows] of byIdentity) {
    const row = rows[0];
    const product = official.products[row.supplierProductCode];
    if (!product) {
      evidence.push({ relativePath: row.relativePath, localProduct: row.supplierProductCode, supplierColourCode: row.supplierColourCode, confidence: 'UNRESOLVED', reason: 'No exact official product evidence.', duplicatePaths: rows.slice(1).map((item) => item.relativePath) });
      continue;
    }
    const compatible = product.colourways.filter((colour) => colour.supplierColourCodeHint === row.supplierColourCode || suffixCompatible(row.supplierColourCode, colour.colourName));
    const candidates = compatible.length ? compatible : product.colourways;
    const imageComparison = comparisons.get(identity);
    let confidence = 'UNRESOLVED';
    let reason = 'No official colourway candidate.';
    let colour = null;
    if (imageComparison?.uniqueStrong) {
      colour = imageComparison.colour;
      const heuristic = suffixCompatible(row.supplierColourCode, colour.colourName) || colour.supplierColourCodeHint === row.supplierColourCode;
      confidence = heuristic ? 'HIGH' : 'LOW';
      reason = heuristic ? 'Exact product with a strong unique cached official-image match and compatible supplier suffix.' : 'Strong image result conflicts with the supplier suffix.';
    } else if (candidates.length === 1) {
      [colour] = candidates;
      const heuristic = suffixCompatible(row.supplierColourCode, colour.colourName) || colour.supplierColourCodeHint === row.supplierColourCode;
      confidence = heuristic ? 'MEDIUM' : 'LOW';
      reason = heuristic ? 'Exact product and unique official colour with compatible supplier suffix; official image evidence is unavailable.' : 'Exact product but image/suffix evidence is weak.';
    } else if (candidates.length > 1) {
      confidence = 'LOW'; reason = 'Several official colourways remain plausible.';
    }
    const item = {
      relativePath: row.relativePath, duplicatePaths: rows.slice(1).map((entry) => entry.relativePath),
      localProduct: row.supplierProductCode, supplierColourCode: row.supplierColourCode,
      officialProductName: product.productName, officialProductCode: product.supplierProductCode,
      officialColourName: colour?.colourName || null, officialCollection: product.collection || null,
      officialUrl: colour?.colourwayUrl || product.productUrl || null, officialImageUrl: colour?.imageUrl || null,
      exactSimilarity: imageComparison?.exactSimilarity ?? null, perceptualSimilarity: imageComparison?.perceptualSimilarity ?? null,
      suffixCompatible: colour ? suffixCompatible(row.supplierColourCode, colour.colourName) : false,
      confidence, reason,
    };
    evidence.push(item);
    if (confidence !== 'HIGH') continue;
    const allocation = allocateCode(colour.colourName, row.supplierColourCode, registry);
    if (allocation.created) {
      registry.codes[allocation.code] = { colourName: colour.colourName, sources: [] };
      newCodes.push({ code: allocation.code, colourName: colour.colourName, identity });
    }
    const source = { supplierProductCode: row.supplierProductCode, supplierColourCode: row.supplierColourCode };
    if (!registry.codes[allocation.code].sources.some((entry) => entry.supplierProductCode === source.supplierProductCode && entry.supplierColourCode === source.supplierColourCode)) registry.codes[allocation.code].sources.push(source);
    if (!candidateProducts[row.supplierProductCode]) candidateProducts[row.supplierProductCode] = {
      supplierProductCode: row.supplierProductCode, fabricName: row.fabricName, fabricDocumentId: row.fabricDocumentId,
      productName: product.productName, filenamePrefixes: [row.supplierProductCode], colours: {},
    };
    candidateProducts[row.supplierProductCode].colours[row.supplierColourCode] = {
      resolved: true, supplierColourCode: row.supplierColourCode, supplierColourName: colour.colourName,
      internalColourCode: allocation.code, sourceImage: row.relativePath,
      evidence: { productUrl: product.productUrl, colourwayUrl: colour.colourwayUrl, imageUrl: colour.imageUrl, confidence: 1, reason },
    };
  }
  for (const entry of Object.values(registry.codes)) entry.sources.sort((a, b) => `${a.supplierProductCode}/${a.supplierColourCode}`.localeCompare(`${b.supplierProductCode}/${b.supplierColourCode}`));
  return { evidence, candidateProducts, registry, newCodes };
}

function csvEscape(value) { const text = value == null ? '' : String(value); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function makeReviewCsv(evidence) {
  const fields = ['relativePath', 'localProduct', 'supplierColourCode', 'officialProductName', 'officialColourName', 'officialCollection', 'confidence', 'reason', 'officialUrl'];
  return `${fields.join(',')}\n${evidence.filter((item) => item.confidence !== 'HIGH').map((item) => fields.map((field) => csvEscape(item[field])).join(',')).join('\n')}\n`;
}

function validateGenerated(colourMap, registry, catalogue) {
  validateColourMap(colourMap, 'generated colour map');
  validateCodeRegistry(registry, 'generated code registry');
  const semantic = new Map();
  const identities = new Set();
  for (const [code, entry] of Object.entries(registry.codes)) {
    const name = normalizeName(entry.colourName);
    if (semantic.has(code) && semantic.get(code) !== name) throw new Error(`Internal code ${code} has conflicting meanings`);
    semantic.set(code, name);
  }
  for (const product of Object.values(colourMap.products)) {
    const matches = logicalRows((catalogue.fabrics || []).filter((fabric) => fabric.documentId === product.fabricDocumentId || normalizeName(fabric.name) === normalizeName(product.fabricName)));
    if (matches.length !== 1) throw new Error(`${product.fabricName} does not resolve to exactly one logical Ashley Wilde fabric`);
    for (const colour of Object.values(product.colours)) {
      const identity = `${product.supplierProductCode}/${colour.supplierColourCode}`;
      if (identities.has(identity)) throw new Error(`Duplicate product/supplier code pair: ${identity}`);
      identities.add(identity);
      if (!colour.evidence?.productUrl && !colour.evidence?.colourwayUrl) throw new Error(`${identity} lacks official evidence`);
    }
  }
  return true;
}

async function writeJson(filename, value) {
  await fs.promises.mkdir(path.dirname(filename), { recursive: true });
  await fs.promises.writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function summaryMarkdown(counts, warnings, collectionDisagreements) {
  return `# Ashley Wilde mapping generator summary\n\nGenerated: ${counts.generatedAt}\n\n- Supported files: ${counts.supportedFiles}\n- Unique product prefixes: ${counts.uniqueProductPrefixes}\n- Unique product/supplier-code pairs: ${counts.uniqueProductColourPairs}\n- Exact duplicate groups: ${counts.exactDuplicates}\n- Conflicting image identities: ${counts.conflictingImages}\n- Official products found: ${counts.officialProducts}\n- Official collections found: ${counts.officialCollections}\n- HIGH: ${counts.HIGH}\n- MEDIUM: ${counts.MEDIUM}\n- LOW: ${counts.LOW}\n- UNRESOLVED: ${counts.UNRESOLVED}\n- Newly proposed internal codes: ${counts.newCodes}\n- Approved mappings preserved: ${counts.approvedMappingsPreserved}\n- Production map touched: no\n\n## Warnings\n\n${warnings.length ? warnings.map((warning) => `- ${warning}`).join('\n') : '- None'}\n\n## Collection disagreements\n\n${collectionDisagreements.length ? collectionDisagreements.map((entry) => `- ${entry.product}: official=${entry.official}; Strapi=${entry.strapi}; folder=${entry.folder}`).join('\n') : '- None confirmed.'}\n`;
}

async function buildMap(options = {}) {
  if (options.crawl && !options.crawlAdapter) throw new Error('No official Ashley Wilde crawl adapter is configured');
  const rootDir = path.resolve(options.rootDir || DEFAULT_IMAGE_ROOT);
  const outputDir = path.resolve(options.outputDir || (options.rootDir ? path.join(rootDir, '.ashley-wilde-generated') : DEFAULT_OUTPUT_DIR));
  const cacheDir = path.resolve(options.cacheDir || DEFAULT_CACHE_DIR);
  const pilotMap = options.pilotMap || JSON.parse(await fs.promises.readFile(PILOT_MAP, 'utf8'));
  const approved = options.mappings || loadProductionMappings();
  const catalogue = options.catalogue || loadSqliteCatalogue(options.dbFile);
  const products = knownProducts(catalogue, pilotMap, approved.colourMap);
  let previousFiles = [];
  let previousGeneratedAt = null;
  const previousInventoryFile = path.join(outputDir, 'local-image-inventory.json');
  if (fs.existsSync(previousInventoryFile)) {
    try {
      const previousInventory = JSON.parse(await fs.promises.readFile(previousInventoryFile, 'utf8'));
      previousFiles = previousInventory.files || [];
      previousGeneratedAt = previousInventory.generatedCounts?.generatedAt || previousInventory.crawlTimestamp || null;
    } catch { previousFiles = []; }
  }
  const inventory = await buildInventory(rootDir, products, previousFiles, Boolean(options.refreshHashes), previousGeneratedAt);
  const targetCodes = new Set(inventory.uniqueProductPrefixes);
  const targetProducts = products.filter((product) => targetCodes.has(normalizeName(product.supplierProductCode)));
  const official = options.official || await crawlOfficial(targetProducts, pilotMap, {
    cacheDir, refresh: Boolean(options.refresh), allowNetwork: Boolean(options.refresh),
    fetchImpl: options.fetchImpl, rateLimitMs: options.rateLimitMs === undefined ? 750 : options.rateLimitMs,
  });
  inventory.rootDir = rootDir;
  const comparisons = await compareCachedOfficialImages(inventory, official, cacheDir);
  delete inventory.rootDir;
  const matched = matchInventory(inventory, official, approved.codeRegistry, comparisons);
  const generatedAt = new Date().toISOString();
  const colourMap = { schemaVersion: 1, supplier: SUPPLIER, generatedAt, products: matched.candidateProducts };
  const registry = { ...matched.registry, schemaVersion: 1, supplier: SUPPLIER, generatedAt };
  const hashInput = { official: official.products, inventory: inventory.files.map(({ relativePath, sha256 }) => ({ relativePath, sha256 })), products: colourMap.products, codes: registry.codes };
  const mappingVersion = contentHash(hashInput);
  colourMap.mappingVersion = mappingVersion;
  registry.mappingVersion = mappingVersion;
  const countsByConfidence = matched.evidence.reduce((result, item) => { result[item.confidence] = (result[item.confidence] || 0) + 1; return result; }, {});
  const collectionDisagreements = matched.evidence.filter((entry) => entry.officialCollection).map((entry) => {
    const row = inventory.files.find((item) => item.relativePath === entry.relativePath);
    return { product: entry.localProduct, official: entry.officialCollection, strapi: row?.strapiCollection || '', folder: row?.topLevelFolder || '' };
  }).filter((entry) => normalizeName(entry.official) !== normalizeName(entry.strapi) || !normalizeName(entry.folder).includes(normalizeName(entry.official).replace(/COLLECTION$/, '')));
  const approvedCount = Object.values(approved.colourMap.products || {}).reduce((sum, product) => sum + Object.keys(product.colours || {}).length, 0);
  const counts = {
    generatedAt, mappingVersion, supportedFiles: inventory.files.length,
    uniqueProductPrefixes: inventory.uniqueProductPrefixes.length, uniqueProductColourPairs: inventory.uniqueProductColourPairs.length,
    exactDuplicates: inventory.exactDuplicates.length, conflictingImages: inventory.conflictingImages.length,
    officialProducts: Object.keys(official.products).length,
    officialCollections: new Set(Object.values(official.products).map((product) => product.collection).filter(Boolean)).size,
    HIGH: countsByConfidence.HIGH || 0, MEDIUM: countsByConfidence.MEDIUM || 0,
    LOW: countsByConfidence.LOW || 0, UNRESOLVED: countsByConfidence.UNRESOLVED || 0,
    newCodes: matched.newCodes.length, approvedMappingsPreserved: approvedCount,
  };
  const header = { schemaVersion: 1, sourceDomain: SOURCE_DOMAIN, crawlTimestamp: official.extractedAt, mappingVersion, generatedCounts: counts, unresolvedCount: counts.MEDIUM + counts.LOW + counts.UNRESOLVED };
  const artefacts = {
    officialCatalogue: path.join(outputDir, 'official-catalogue.json'), localInventory: path.join(outputDir, 'local-image-inventory.json'),
    colourMap: path.join(outputDir, 'ashley-wilde-colour-map.generated.json'), registry: path.join(outputDir, 'ashley-wilde-code-registry.generated.json'),
    evidence: path.join(outputDir, 'mapping-evidence.json'), review: path.join(outputDir, 'mapping-review.csv'), summary: path.join(outputDir, 'summary.md'),
  };
  await writeJson(artefacts.officialCatalogue, { ...header, supplier: SUPPLIER, products: official.products, warnings: official.warnings });
  await writeJson(path.join(cacheDir, 'pending-web-search-queries.json'), { schemaVersion: 1, sourceDomain: SOURCE_DOMAIN, generatedAt, queries: official.pendingSearchQueries || [] });
  await writeJson(artefacts.localInventory, { ...header, supplier: SUPPLIER, rootLabel: 'Fabric-Images', ...inventory });
  await writeJson(artefacts.colourMap, colourMap);
  await writeJson(artefacts.registry, registry);
  await writeJson(artefacts.evidence, { ...header, supplier: SUPPLIER, entries: matched.evidence, newCodes: matched.newCodes, collectionDisagreements });
  await fs.promises.writeFile(artefacts.review, makeReviewCsv(matched.evidence), 'utf8');
  await fs.promises.writeFile(artefacts.summary, summaryMarkdown(counts, [...catalogue.warnings, ...official.warnings], collectionDisagreements), 'utf8');
  const allFiles = (await walk(rootDir)).filter((file) => {
    const outputPrefix = `${outputDir}${path.sep}`;
    return file.absolute !== outputDir && !file.absolute.startsWith(outputPrefix);
  });
  const imageIndex = {
    schemaVersion: 1, supplier: SUPPLIER, generatedAt,
    images: Object.fromEntries(inventory.files.map((row) => [row.relativePath, {
      sha256: row.sha256, size: row.size, status: row.status === 'parsed' ? 'matched' : row.status,
      supplierProductCode: row.supplierProductCode || null, supplierColourCode: row.supplierColourCode || null,
    }])),
    unresolved: inventory.files.filter((row) => row.status !== 'parsed').map((row) => ({ relativePath: row.relativePath, status: row.status })),
  };
  return {
    rootDir, outputDir, catalogue, inventory, official, colourMap, registry,
    evidence: matched.evidence, newCodes: matched.newCodes, counts, artefacts, collectionDisagreements,
    scanned: allFiles.length, indexed: inventory.files.length, unresolved: imageIndex.unresolved, imageIndex,
  };
}

async function applyGenerated(result, options = {}) {
  if (!options.confirm) throw new Error('--apply requires --confirm');
  validateGenerated(result.colourMap, result.registry, result.catalogue);
  const backupDir = path.join(result.outputDir, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await fs.promises.mkdir(backupDir, { recursive: true });
  await fs.promises.copyFile(MAP_FILE, path.join(backupDir, path.basename(MAP_FILE)));
  await fs.promises.copyFile(REGISTRY_FILE, path.join(backupDir, path.basename(REGISTRY_FILE)));
  const tempMap = `${MAP_FILE}.tmp-${process.pid}`;
  const tempRegistry = `${REGISTRY_FILE}.tmp-${process.pid}`;
  await fs.promises.writeFile(tempMap, `${JSON.stringify(result.colourMap, null, 2)}\n`, 'utf8');
  await fs.promises.writeFile(tempRegistry, `${JSON.stringify(result.registry, null, 2)}\n`, 'utf8');
  await fs.promises.rename(tempMap, MAP_FILE);
  await fs.promises.rename(tempRegistry, REGISTRY_FILE);
  return { backupDir };
}

function printReview(result) {
  const rows = result.evidence.filter((entry) => entry.confidence !== 'HIGH');
  for (const entry of rows) console.log(`${entry.confidence}\t${entry.localProduct || '-'}\t${entry.supplierColourCode || '-'}\t${entry.officialColourName || '-'}\t${entry.reason}`);
  for (const entry of result.newCodes) console.log(`NEW_CODE\t${entry.code}\t${entry.colourName}\t${entry.identity}`);
}

async function cli(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  if (args.has('--apply') && !args.has('--confirm')) throw new Error('--apply requires --confirm');
  const result = await buildMap({ refresh: args.has('--refresh') });
  if (args.has('--review')) printReview(result);
  if (args.has('--apply')) await applyGenerated(result, { confirm: args.has('--confirm') });
  console.log(JSON.stringify({ ...result.counts, artefacts: result.artefacts, productionMapTouched: args.has('--apply') }, null, 2));
}

if (require.main === module) cli().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = {
  allocateCode, applyGenerated, buildInventory, buildMap, cachedFetch, contentHash,
  compareCachedOfficialImages, hashSimilarity, imageHash, loadSqliteCatalogue, logicalRows, matchInventory,
  normalizeCopySuffix, parseInventoryFilename, parseProductPage, parseSwatchPage,
  sha256File, splitOfficialTitle, suffixCompatible, validateGenerated,
  validateSearchEvidence, mergeStructuredEvidence, makeSearchQueries, walk,
};
