'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateCodeRegistry, validateColourMap } = require('../src/plugins/order-management/shared/ashley-wilde-mapping');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONVERTED_ROOT = path.join(PROJECT_ROOT, '.tmp', 'ashley-wilde-final-research', 'converted');
const MAP_FILE = path.join(PROJECT_ROOT, 'src', 'plugins', 'order-management', 'shared', 'ashley-wilde-colour-map.json');
const REGISTRY_FILE = path.join(PROJECT_ROOT, 'src', 'plugins', 'order-management', 'shared', 'ashley-wilde-code-registry.json');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort((a, b) => a.localeCompare(b)).map((key) => [key, sortObject(value[key])]));
}

function mappingCount(map) {
  return Object.values(map.products || {}).reduce((total, product) => total + Object.keys(product.colours || {}).length, 0);
}

function mergeProduct(existing, incoming, key) {
  if (!existing) return structuredClone(incoming);
  if (existing.supplierProductCode !== incoming.supplierProductCode || existing.fabricName !== incoming.fabricName) {
    throw new Error(`Approved production product ${key} conflicts with the incoming Ashley Wilde identity.`);
  }
  const merged = { ...structuredClone(existing), ...structuredClone(incoming), colours: { ...structuredClone(existing.colours || {}) } };
  for (const [code, colour] of Object.entries(incoming.colours || {})) {
    const prior = merged.colours[code];
    if (prior && JSON.stringify(prior) !== JSON.stringify(colour)) {
      throw new Error(`Approved production colour ${incoming.supplierProductCode}/${code} conflicts with the incoming identity.`);
    }
    merged.colours[code] = structuredClone(colour);
  }
  return merged;
}

function mergeMaps(existingMap, incomingMap, resolution) {
  const byProduct = new Map();
  for (const [key, product] of Object.entries(existingMap.products || {})) byProduct.set(key, structuredClone(product));
  for (const [key, product] of Object.entries(incomingMap.products || {})) {
    const resolved = resolution.items.find((item) => item.supplierProductCode === product.supplierProductCode && item.productName === product.productName);
    if (!resolved || resolved.status !== 'resolved_unique' || !resolved.resolvedCurrentDocumentId) {
      throw new Error(`Cannot apply ${product.supplierProductCode}: Fabric resolution is not uniquely validated.`);
    }
    const enriched = { ...structuredClone(product), fabricDocumentId: resolved.resolvedCurrentDocumentId };
    byProduct.set(key, mergeProduct(byProduct.get(key), enriched, key));
  }
  const products = Object.fromEntries([...byProduct.entries()].sort(([a], [b]) => a.localeCompare(b)));
  return sortObject({ schemaVersion: 1, supplier: 'Ashley Wilde', generatedAt: new Date().toISOString(), products });
}

function mergeRegistry(existingRegistry, incomingRegistry) {
  const codes = {};
  for (const [code, entry] of Object.entries(existingRegistry.codes || {})) codes[code] = structuredClone(entry);
  for (const [code, entry] of Object.entries(incomingRegistry.codes || {})) {
    const prior = codes[code];
    if (prior && prior.colourName !== entry.colourName) throw new Error(`Internal code ${code} has conflicting canonical names.`);
    const sources = [...(prior?.sources || []), ...(entry.sources || [])];
    codes[code] = { colourName: entry.colourName, sources: [...new Map(sources.map((source) => [`${source.supplierProductCode}/${source.supplierColourCode}`, source])).values()] };
  }
  for (const entry of Object.values(codes)) entry.sources.sort((a, b) => `${a.supplierProductCode}/${a.supplierColourCode}`.localeCompare(`${b.supplierProductCode}/${b.supplierColourCode}`));
  return sortObject({ schemaVersion: 1, supplier: 'Ashley Wilde', generatedAt: new Date().toISOString(), codes, unresolved: [] });
}

function diffMarkdown(beforeMap, afterMap, beforeRegistry, afterRegistry, resolution) {
  const beforeProducts = Object.keys(beforeMap.products || {}).length;
  const afterProducts = Object.keys(afterMap.products || {}).length;
  const beforeMappings = mappingCount(beforeMap);
  const afterMappings = mappingCount(afterMap);
  const beforeCodes = Object.keys(beforeRegistry.codes || {}).length;
  const afterCodes = Object.keys(afterRegistry.codes || {}).length;
  const blockers = resolution.items.filter((item) => /antiquerose|birdsandroses/i.test(item.productName));
  return [
    '# Ashley Wilde production mapping diff', '',
    `Generated: ${afterMap.generatedAt}`, '',
    '| Artifact | Before | After | Delta |', '|---|---:|---:|---:|',
    `| Logical products | ${beforeProducts} | ${afterProducts} | ${afterProducts - beforeProducts} |`,
    `| Product/colour mappings | ${beforeMappings} | ${afterMappings} | ${afterMappings - beforeMappings} |`,
    `| Internal colour codes | ${beforeCodes} | ${afterCodes} | ${afterCodes - beforeCodes} |`, '',
    `- Candidate mappings validated: ${afterMappings}`,
    `- Unique Fabric resolutions: ${resolution.summary.resolvedUnique}`,
    `- Missing Fabrics: ${resolution.summary.missingFabric}`,
    `- Ambiguous Fabrics: ${resolution.summary.ambiguousFabric}`,
    `- Product-code mismatches: ${resolution.summary.productCodeMismatch}`,
    `- Approved production entries overwritten: 0`, '',
    '## Final blocker resolutions', '',
    '| Product | Supplier code | Colour code | Fabric documentId | Internal code |', '|---|---|---|---|---|',
    ...blockers.map((item) => {
      const product = Object.values(afterMap.products).find((candidate) => candidate.supplierProductCode === item.supplierProductCode);
      const colour = product.colours[item.supplierColourCode];
      return `| ${item.productName} | ${item.supplierProductCode} | ${item.supplierColourCode} | ${item.resolvedCurrentDocumentId} | ${colour.internalColourCode} |`;
    }), '',
    'Pilot map and pilot registry were not modified. No media or Colour records were created.',
  ].join('\n') + '\n';
}

function apply({ confirm = false } = {}) {
  if (!confirm) throw new Error('Production mapping merge requires --confirm.');
  const incomingMap = readJson(path.join(CONVERTED_ROOT, 'ashley-wilde-colour-map.repo-compatible.json'));
  const incomingRegistry = readJson(path.join(CONVERTED_ROOT, 'ashley-wilde-code-registry.repo-compatible.json'));
  const resolution = readJson(path.join(CONVERTED_ROOT, 'fabric-resolution-report.json'));
  if (resolution.summary.totalCandidates !== 176 || resolution.summary.resolvedUnique !== 176 || resolution.summary.missingFabric !== 0 || resolution.summary.ambiguousFabric !== 0 || resolution.summary.productCodeMismatch !== 0) {
    throw new Error(`Production merge gate failed: ${JSON.stringify(resolution.summary)}`);
  }
  const beforeMap = readJson(MAP_FILE);
  const beforeRegistry = readJson(REGISTRY_FILE);
  const afterMap = mergeMaps(beforeMap, incomingMap, resolution);
  const afterRegistry = mergeRegistry(beforeRegistry, incomingRegistry);
  validateColourMap(afterMap, 'merged Ashley Wilde production colour map');
  validateCodeRegistry(afterRegistry, 'merged Ashley Wilde production code registry');
  const diffFile = path.join(CONVERTED_ROOT, 'production-map-diff.md');
  writeJson(MAP_FILE, afterMap);
  writeJson(REGISTRY_FILE, afterRegistry);
  fs.writeFileSync(diffFile, diffMarkdown(beforeMap, afterMap, beforeRegistry, afterRegistry, resolution), 'utf8');
  return { mapFile: MAP_FILE, registryFile: REGISTRY_FILE, diffFile, products: Object.keys(afterMap.products).length, mappings: mappingCount(afterMap), codes: Object.keys(afterRegistry.codes).length };
}

if (require.main === module) {
  apply({ confirm: process.argv.includes('--confirm') });
}

module.exports = { apply, diffMarkdown, mappingCount, mergeMaps, mergeRegistry, sortObject };
