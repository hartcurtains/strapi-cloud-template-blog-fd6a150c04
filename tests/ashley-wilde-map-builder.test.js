'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  allocateCode, applyGenerated, buildInventory, buildMap, cachedFetch,
  hashSimilarity, matchInventory, normalizeCopySuffix, parseInventoryFilename,
  parseProductPage, parseSwatchPage, validateGenerated, validateSearchEvidence,
  mergeStructuredEvidence,
} = require('../scripts/ashley-wilde-map-builder');
const mapping = require('../src/plugins/order-management/shared/ashley-wilde-mapping');

const emptyRegistry = () => ({ schemaVersion: 1, supplier: 'Ashley Wilde', generatedAt: null, codes: {}, unresolved: [] });
const emptyMap = () => ({ schemaVersion: 1, supplier: 'Ashley Wilde', generatedAt: null, products: {} });

function productMap(products) {
  const mappedProducts = {};
  for (const product of products) {
    const colours = {};
    for (const [code, colourName] of Object.entries(product.colours)) {
      colours[code] = {
        resolved: true,
        supplierColourCode: code,
        supplierColourName: colourName,
        internalColourCode: `${product.supplierProductCode}_${code}`,
      };
    }
    mappedProducts[product.supplierProductCode.toLowerCase()] = {
      supplierProductCode: product.supplierProductCode,
      fabricName: product.productName,
      productName: product.productName,
      filenamePrefixes: [product.supplierProductCode],
      colours,
    };
  }
  return {
    schemaVersion: 1,
    supplier: 'Ashley Wilde',
    generatedAt: null,
    products: mappedProducts,
  };
}

test('recursive inventory normalises trailing copied-file markers without changing files', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aw-inventory-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  await fs.promises.mkdir(path.join(root, 'nested'));
  await fs.promises.writeFile(path.join(root, 'nested', 'ALASKAAQ copy 2 (1).jpg'), 'one');
  const products = [{ supplierProductCode: 'ALASKA', productName: 'Alaska', fabricName: 'Alaska', fabricDocumentId: 'alaska' }];
  const result = await buildInventory(root, products);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].supplierColourCode, 'AQ');
  assert.equal(result.files[0].normalizedFilename, 'ALASKAAQ.jpg');
  assert.equal(await fs.promises.readFile(path.join(root, 'nested', 'ALASKAAQ copy 2 (1).jpg'), 'utf8'), 'one');
});

test('copy suffix normalisation recognises harmless trailing forms only', () => {
  assert.equal(normalizeCopySuffix('BERKELEYDO copy'), 'BERKELEYDO');
  assert.equal(normalizeCopySuffix('BERKELEYDO - copy 2'), 'BERKELEYDO');
  assert.equal(normalizeCopySuffix('BERKELEYDO (1)'), 'BERKELEYDO');
  assert.equal(normalizeCopySuffix('COPYRIGHTDO'), 'COPYRIGHTDO');
});

test('longest exact product prefix wins and supplier suffix may be variable length', () => {
  const products = [
    { supplierProductCode: 'ASH', productName: 'Ash', fabricName: 'Ash' },
    { supplierProductCode: 'ASHTON', productName: 'Ashton', fabricName: 'Ashton' },
  ];
  const parsed = parseInventoryFilename('ASHTONDUCKEGG.jpg', products);
  assert.equal(parsed.supplierProductCode, 'ASHTON');
  assert.equal(parsed.supplierColourCode, 'DUCKEGG');
});

test('Kielder filename resolution uses Natural only for NA and Other cols for every other suffix', () => {
  const products = [
    { supplierProductCode: 'KIELDER', productName: 'Kielder Natural', fabricName: 'Kielder Natural', fabricDocumentId: 'kielder-natural' },
    { supplierProductCode: 'KIELDER', productName: 'Kielder Other cols', fabricName: 'Kielder Other cols', fabricDocumentId: 'kielder-other' },
  ];
  const expected = [
    ['KIELDERNA.jpg', 'Kielder Natural', 'kielder-natural', 'NA'],
    ['KIELDERBL.jpg', 'Kielder Other cols', 'kielder-other', 'BL'],
    ['KIELDERGR.jpg', 'Kielder Other cols', 'kielder-other', 'GR'],
    ['KIELDERXX.jpg', 'Kielder Other cols', 'kielder-other', 'XX'],
  ];
  for (const [filename, fabricName, fabricDocumentId, supplierColourCode] of expected) {
    const parsed = parseInventoryFilename(filename, products);
    assert.equal(parsed.status, 'parsed');
    assert.equal(parsed.fabricName, fabricName);
    assert.equal(parsed.fabricDocumentId, fabricDocumentId);
    assert.equal(parsed.supplierProductCode, 'KIELDER');
    assert.equal(parsed.supplierColourCode, supplierColourCode);
    assert.equal(parsed.fabricColourCode, `KIELDER${supplierColourCode}`);
  }
});

test('active importer parsing applies the same exact Kielder split without changing generic parsing', () => {
  const resolvedColour = (supplierColourCode, supplierColourName) => ({
    resolved: true,
    supplierColourCode,
    supplierColourName,
    internalColourCode: supplierColourCode,
  });
  const colourMap = {
    schemaVersion: 1,
    supplier: 'Ashley Wilde',
    generatedAt: null,
    products: {
      'KIELDER|natural': {
        supplierProductCode: 'KIELDER', fabricName: 'Kielder Natural', productName: 'Kielder Natural',
        fabricDocumentId: 'kielder-natural', filenamePrefixes: ['KIELDER'], colours: { NA: resolvedColour('NA', 'Natural') },
      },
      'KIELDER|other': {
        supplierProductCode: 'KIELDER', fabricName: 'Kielder Other cols', productName: 'Kielder Other cols',
        fabricDocumentId: 'kielder-other', filenamePrefixes: ['KIELDER'],
        colours: { BL: resolvedColour('BL', 'Blue'), GR: resolvedColour('GR', 'Green'), XX: resolvedColour('XX', 'Example') },
      },
      ashton: {
        supplierProductCode: 'ASHTON', fabricName: 'Ashton', productName: 'Ashton',
        fabricDocumentId: 'ashton', filenamePrefixes: ['ASHTON'], colours: { DE: resolvedColour('DE', 'Denim') },
      },
    },
  };

  const natural = mapping.parseFilename('KIELDERNA.jpg', colourMap);
  const otherRows = ['BL', 'GR', 'XX'].map((suffix) => mapping.parseFilename(`KIELDER${suffix}.jpg`, colourMap));
  assert.deepEqual([natural.fabricName, natural.supplierProductCode, natural.supplierColourCode, natural.fabricColourCode], ['Kielder Natural', 'KIELDER', 'NA', 'KIELDERNA']);
  for (const row of otherRows) {
    assert.equal(row.fabricName, 'Kielder Other cols');
    assert.equal(row.supplierProductCode, 'KIELDER');
    assert.equal(row.fabricColourCode, `KIELDER${row.supplierColourCode}`);
  }
  assert.deepEqual(
    mapping.parseFilename('ASHTONDE.jpg', colourMap),
    {
      status: 'matched', assetType: 'ordinary_colour', filename: 'ASHTONDE.jpg', productKey: 'ashton',
      productName: 'Ashton', fabricName: 'Ashton', approvedAliases: [], supplierProductCode: 'ASHTON',
      fabricDocumentId: 'ashton', mappingVersion: undefined, supplierColourCode: 'DE',
      supplierColourName: 'Denim', internalColourCode: 'DE', mappingSource: 'approved Ashley Wilde mapping', evidence: null,
    },
  );
});

test('Jett and Malibu filename corrections keep the final two-character supplier code', () => {
  const products = [
    { supplierProductCode: 'JETT', productName: 'Jett', fabricName: 'Jett' },
    { supplierProductCode: 'MALIBU', productName: 'Malibu', fabricName: 'Malibu' },
  ];
  const jett = parseInventoryFilename('JETTDA.jpg', products);
  const malibu = parseInventoryFilename('MALIBUCA.jpg', products);
  assert.equal(jett.supplierProductCode, 'JETT');
  assert.equal(jett.supplierColourCode, 'DA');
  assert.equal(malibu.supplierProductCode, 'MALIBU');
  assert.equal(malibu.supplierColourCode, 'CA');
});

test('product-scoped suffix meanings stay separate and numbered/lifestyle files stay out of colours', () => {
  const colourMap = productMap([
    { supplierProductCode: 'HAWTHORN', productName: 'Hawthorn', colours: { IN: 'Ink' } },
    { supplierProductCode: 'GALATZO', productName: 'Galatzo', colours: { IN: 'Indigo' } },
    { supplierProductCode: 'HAMPTON', productName: 'Hampton', colours: { DE: 'Denim' } },
  ]);
  const hawthorn = mapping.parseFilename('HAWTHORNIN.jpg', colourMap);
  const galatzo = mapping.parseFilename('GALATZOIN.jpg', colourMap);
  assert.equal(hawthorn.supplierColourName, 'Ink');
  assert.equal(galatzo.supplierColourName, 'Indigo');
  assert.equal(mapping.parseFilename('HAMPTONDE.jpg', colourMap).status, 'matched');
  assert.equal(mapping.parseFilename('HAMPTONDE_1.jpg', colourMap).status, 'unknown_colour_code');
  assert.equal(mapping.parseFilename('HAMPTONMAIN.jpg', colourMap).status, 'unknown_colour_code');
  assert.equal(Object.keys(colourMap.products.hampton.colours).length, 1);
});

test('official swatch page and product page parsing retain official URLs and collection', () => {
  const html = '<li class="product-item"><a class="product-item-link" href="/alaska-aqua/">Alaska Aqua</a><img src="https://ashleywildegroup.com/media/alaska.jpg"></li><div>Items 1-1 of 1</div>';
  const parsed = parseSwatchPage(html, 'https://ashleywildegroup.com/fabrics/swatch-search/');
  assert.equal(parsed.total, 1);
  assert.equal(parsed.entries[0].title, 'Alaska Aqua');
  assert.equal(parsed.entries[0].productUrl, 'https://ashleywildegroup.com/alaska-aqua/');
  const product = parseProductPage('<h1>Alaska Aqua</h1><p>Product Code: ALASKA</p><a href="/fabrics/ashley-wilde/alaska-collection/">Alaska Collection</a>', parsed.entries[0].productUrl);
  assert.equal(product.productCode, 'ALASKA');
  assert.equal(product.collection, 'Alaska Collection');
});

test('HTML cache resumes without a second request', async (t) => {
  const cacheDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aw-cache-'));
  t.after(() => fs.promises.rm(cacheDir, { recursive: true, force: true }));
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true, status: 200, text: async () => '<html>official</html>' }; };
  await cachedFetch('https://ashleywildegroup.com/test', { cacheDir, refresh: false, fetchImpl, rateLimitMs: 0 });
  await cachedFetch('https://ashleywildegroup.com/test', { cacheDir, refresh: false, fetchImpl, rateLimitMs: 0 });
  assert.equal(calls, 1);
});

test('web-search adapter validates official-domain evidence and excerpt hashes', () => {
  const evidenceExcerpt = 'Official page says Product Code: ALASKA.';
  const evidenceHash = crypto.createHash('sha256').update(evidenceExcerpt).digest('hex');
  const entries = validateSearchEvidence({ schemaVersion: 1, sourceDomain: 'ashleywildegroup.com', entries: [{
    query: 'site:ashleywildegroup.com "Alaska" "Product Code"', officialUrl: 'https://ashleywildegroup.com/alaska-wine/',
    officialPageTitle: 'Alaska | Ashley Wilde', product: 'Alaska', productCode: 'ALASKA', colour: 'Wine',
    retrievedAt: new Date().toISOString(), evidenceExcerpt, evidenceHash,
  }] });
  const catalogue = {};
  mergeStructuredEvidence(catalogue, entries, [{ productName: 'Alaska', supplierProductCode: 'ALASKA' }], 'web-search-official-index');
  assert.equal(catalogue.ALASKA.colourways[0].colourName, 'Wine');
  assert.throws(() => validateSearchEvidence({ schemaVersion: 1, sourceDomain: 'ashleywildegroup.com', entries: [{ ...entries[0], officialUrl: 'https://retailer.example/alaska' }] }), /incomplete/);
});

test('rate limiting is applied before official requests', async (t) => {
  const cacheDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aw-rate-'));
  t.after(() => fs.promises.rm(cacheDir, { recursive: true, force: true }));
  const started = Date.now();
  await cachedFetch('https://ashleywildegroup.com/rate', { cacheDir, refresh: true, rateLimitMs: 25, fetchImpl: async () => ({ ok: true, status: 200, text: async () => 'ok' }) });
  assert.ok(Date.now() - started >= 20);
});

test('exact and perceptual hashes compare deterministically', () => {
  const sha = crypto.createHash('sha256').update('same').digest('hex');
  assert.equal(sha, crypto.createHash('sha256').update('same').digest('hex'));
  assert.equal(hashSimilarity('11110000', '11110000'), 1);
  assert.equal(hashSimilarity('11110000', '11100000'), 0.875);
});

test('ambiguous or image-less evidence is rejected from the HIGH candidate map', () => {
  const inventory = { files: [{ relativePath: 'A/ALASKAAQ.jpg', supplierProductCode: 'ALASKA', supplierColourCode: 'AQ', fabricName: 'Alaska', fabricDocumentId: 'a' }] };
  const official = { products: { ALASKA: { productName: 'Alaska', supplierProductCode: 'ALASKA', productUrl: 'https://ashleywildegroup.com/alaska-aqua/', colourways: [{ colourName: 'Aqua', supplierColourCodeHint: 'AQ', colourwayUrl: 'https://ashleywildegroup.com/alaska-aqua/', imageUrl: null }] } } };
  const result = matchInventory(inventory, official, emptyRegistry());
  assert.equal(result.evidence[0].confidence, 'MEDIUM');
  assert.deepEqual(result.candidateProducts, {});
});

test('product-scoped supplier-code reuse and same colour names remain separate identities', () => {
  const files = [
    { relativePath: 'B/BERKELEYDO.jpg', supplierProductCode: 'BERKELEY', supplierColourCode: 'DO', fabricName: 'Berkeley', fabricDocumentId: 'b' },
    { relativePath: 'C/CHERINGTONDO.jpg', supplierProductCode: 'CHERINGTON', supplierColourCode: 'DO', fabricName: 'Cherington', fabricDocumentId: 'c' },
  ];
  const official = { products: {
    BERKELEY: { productName: 'Berkeley', supplierProductCode: 'BERKELEY', colourways: [{ colourName: 'Dove', supplierColourCodeHint: 'DO' }] },
    CHERINGTON: { productName: 'Cherington', supplierProductCode: 'CHERINGTON', colourways: [{ colourName: 'Dove', supplierColourCodeHint: 'DO' }] },
  } };
  const result = matchInventory({ files }, official, emptyRegistry());
  assert.equal(result.evidence.length, 2);
  assert.notEqual(`${files[0].fabricDocumentId}/DO`, `${files[1].fabricDocumentId}/DO`);
});

test('deterministic internal-code allocation rejects semantic reuse', () => {
  const registry = { codes: { IN: { colourName: 'Ink', sources: [] } } };
  assert.deepEqual(allocateCode('Ink', 'IN', registry), { code: 'IN', created: false });
  assert.deepEqual(allocateCode('Indigo', 'IN', registry), { code: 'I', created: true });
  assert.deepEqual(allocateCode('Indigo', 'IN', registry), { code: 'I', created: true });
});

test('generated contracts allow repeated supplier codes across fabrics and reject duplicate product identities', () => {
  const registry = { schemaVersion: 1, supplier: 'Ashley Wilde', generatedAt: null, codes: { DO: { colourName: 'Dove', sources: [{ supplierProductCode: 'BERKELEY', supplierColourCode: 'DO' }, { supplierProductCode: 'CHERINGTON', supplierColourCode: 'DO' }] } }, unresolved: [] };
  const product = (name, id) => ({ supplierProductCode: name.toUpperCase(), fabricName: name, fabricDocumentId: id, productName: name, filenamePrefixes: [name], colours: { DO: { resolved: true, supplierColourCode: 'DO', supplierColourName: 'Dove', internalColourCode: 'DO', evidence: { productUrl: 'https://ashleywildegroup.com/official/' } } } });
  const map = { schemaVersion: 1, supplier: 'Ashley Wilde', generatedAt: null, products: { berkeley: product('Berkeley', 'b'), cherington: product('Cherington', 'c') } };
  assert.equal(validateGenerated(map, registry, { fabrics: [{ name: 'Berkeley', documentId: 'b' }, { name: 'Cherington', documentId: 'c' }] }), true);
});

test('dry-run generation writes only generated artefacts and does not mutate approved maps or database', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aw-run-'));
  const outputDir = path.join(root, 'out');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  await fs.promises.writeFile(path.join(root, 'ALASKAAQ.jpg'), 'image');
  const approvedMapFile = path.join(__dirname, '../src/plugins/order-management/shared/ashley-wilde-colour-map.json');
  const before = await fs.promises.readFile(approvedMapFile, 'utf8');
  const result = await buildMap({
    rootDir: root, outputDir,
    catalogue: { source: 'test', warnings: [], fabrics: [{ name: 'Alaska', documentId: 'a', productId: 'ALASKA' }] },
    mappings: { colourMap: emptyMap(), codeRegistry: emptyRegistry(), imageIndex: { schemaVersion: 1, supplier: 'Ashley Wilde', generatedAt: null, images: {}, unresolved: [] } },
    pilotMap: { products: {} },
    official: { sourceDomain: 'ashleywildegroup.com', extractedAt: new Date().toISOString(), warnings: [], products: {} },
  });
  assert.equal(result.counts.supportedFiles, 1);
  assert.equal(await fs.promises.readFile(approvedMapFile, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(outputDir, 'summary.md')), true);
});

test('apply requires explicit confirmation before any replacement', async () => {
  await assert.rejects(applyGenerated({}, { confirm: false }), /requires --confirm/);
});
