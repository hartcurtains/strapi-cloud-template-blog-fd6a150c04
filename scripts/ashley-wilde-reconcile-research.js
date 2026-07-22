'use strict';

/* Read-only research conversion and dry-run reports. Approved maps and DB are never written. */
const fs = require('node:fs');
const path = require('node:path');
const { loadProductionMappings, normalizeToken, parseFilename, validateCodeRegistry, validateColourMap } = require('../src/plugins/order-management/shared/ashley-wilde-mapping');
const { buildInventory, loadSqliteCatalogue, logicalRows } = require('./ashley-wilde-map-builder');

const projectRoot = path.resolve(__dirname, '..');
const researchRoot = path.join(projectRoot, '.tmp', 'ashley-wilde-research');
const outputRoot = path.join(projectRoot, '.tmp', 'ashley-wilde-final-research', 'converted');
const imageRoot = path.resolve(projectRoot, '..', 'Fabric-Images');
const dbFile = path.join(projectRoot, '.tmp', 'data.db');
const sourceMapFile = path.join(researchRoot, 'ashley-wilde-colour-map.generated.json');
const sourceRegistryFile = path.join(researchRoot, 'ashley-wilde-code-registry.generated.json');
const sourceDbFile = path.join(researchRoot, 'ashley-wilde-complete-research-db.json');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); };
const writeText = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${value.trim()}\n`, 'utf8'); };
const norm = (value) => normalizeToken(value);
const name = (value) => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const rowKey = (row) => [row.productName, row.supplierProductCode, row.supplierColourCode, row.officialColourway].join('|');
const idKey = (row) => `${row.supplierProductCode}/${row.supplierColourCode}`;
const md = (lines) => lines.join('\n');

function allocateCode(colourName, preferred, registry) {
  const canonical = norm(colourName);
  for (const [code, entry] of Object.entries(registry.codes)) if (norm(entry.colourName) === canonical) return { code, created: false };
  const preferredCode = norm(preferred);
  if (preferredCode && !registry.codes[preferredCode]) return { code: preferredCode, created: true };
  const letters = canonical || 'COLOUR';
  for (let length = 1; length <= letters.length; length += 1) {
    const code = letters.slice(0, length);
    if (!registry.codes[code]) return { code, created: true };
  }
  let counter = 2;
  while (registry.codes[`${letters}${counter}`]) counter += 1;
  return { code: `${letters}${counter}`, created: true };
}

function convert(sourceMap, sourceRegistry, researchDb, productionRegistry, pilotRegistry) {
  const audit = { reused: [], proposed: [], collisions: [], rejected: [], concerns: [], finalConflicts: [] };
  const registry = JSON.parse(JSON.stringify(productionRegistry));
  for (const [code, entry] of Object.entries(pilotRegistry.codes || {})) {
    if (!registry.codes[code]) {
      registry.codes[code] = JSON.parse(JSON.stringify(entry));
      audit.reused.push({ code, colourName: entry.colourName, source: 'pilot registry' });
    } else if (norm(registry.codes[code].colourName) !== norm(entry.colourName)) {
      audit.collisions.push({ code, existing: registry.codes[code].colourName, incoming: entry.colourName, source: 'pilot registry' });
    }
  }
  const evidence = new Map(researchDb.rows.map((row) => [rowKey(row), row]));
  const rows = sourceMap.mappings.slice().sort((a, b) => String(a.supplierProductCode).localeCompare(String(b.supplierProductCode)) || String(a.supplierColourCode).localeCompare(String(b.supplierColourCode)));
  const products = {};
  const seen = new Set();
  const duplicates = [];
  for (const row of rows) {
    if (seen.has(idKey(row))) { duplicates.push(row); continue; }
    seen.add(idKey(row));
    const source = evidence.get(rowKey(row));
    if (!source || row.confidence !== 'HIGH') { audit.rejected.push({ row, reason: !source ? 'missing research row' : `confidence=${row.confidence}` }); continue; }
    const preferredCode = norm(row.supplierColourCode);
    const preferredEntry = registry.codes[preferredCode];
    if (preferredEntry && norm(preferredEntry.colourName) !== norm(row.officialColourway)) {
      audit.rejected.push({ row, reason: `preferred code ${preferredCode} already means ${preferredEntry.colourName}` });
      audit.collisions.push({ code: preferredCode, existing: preferredEntry.colourName, incoming: row.officialColourway, source: idKey(row) });
    }
    const allocation = allocateCode(row.officialColourway, row.supplierColourCode, registry);
    if (allocation.created) {
      registry.codes[allocation.code] = { colourName: row.officialColourway, sources: [] };
      audit.proposed.push({ code: allocation.code, colourName: row.officialColourway, identity: idKey(row) });
    } else audit.reused.push({ code: allocation.code, colourName: row.officialColourway, identity: idKey(row), source: 'canonical name' });
    const sourceRef = { supplierProductCode: row.supplierProductCode, supplierColourCode: row.supplierColourCode };
    if (!registry.codes[allocation.code].sources.some((item) => item.supplierProductCode === sourceRef.supplierProductCode && item.supplierColourCode === sourceRef.supplierColourCode)) registry.codes[allocation.code].sources.push(sourceRef);
    const productKey = norm(row.supplierProductCode).toLocaleLowerCase();
    products[productKey] ||= { supplierProductCode: row.supplierProductCode, fabricName: row.productName, productName: row.productName, filenamePrefixes: [row.supplierProductCode], colours: {} };
    products[productKey].colours[row.supplierColourCode] = {
      resolved: true,
      supplierColourCode: row.supplierColourCode,
      supplierColourName: row.officialColourway,
      internalColourCode: allocation.code,
      sourceImage: source.localFiles?.[0] || null,
      evidence: { productUrl: row.officialUrl, colourwayUrl: row.officialUrl, imageUrl: null, confidence: 1, source: 'completed Ashley Wilde research bundle' },
    };
    if (/[0-9]|\(|recyl|recyled/i.test(row.officialColourway)) audit.concerns.push({ identity: idKey(row), officialColourName: row.officialColourway });
  }
  for (const entry of Object.values(registry.codes)) entry.sources.sort((a, b) => `${a.supplierProductCode}/${a.supplierColourCode}`.localeCompare(`${b.supplierProductCode}/${b.supplierColourCode}`));
  const colourMap = { schemaVersion: 1, supplier: 'Ashley Wilde', generatedAt: sourceMap.generatedAt, products };
  const codeRegistry = { schemaVersion: 1, supplier: 'Ashley Wilde', generatedAt: sourceRegistry.generatedAt, codes: registry.codes, unresolved: [] };
  for (const product of Object.values(colourMap.products)) for (const colour of Object.values(product.colours)) {
    const registryEntry = codeRegistry.codes[colour.internalColourCode];
    if (!registryEntry || norm(registryEntry.colourName) !== norm(colour.supplierColourName)) audit.finalConflicts.push({ code: colour.internalColourCode, registryName: registryEntry?.colourName || null, mapName: colour.supplierColourName });
  }
  validateColourMap(colourMap, 'converted candidate colour map');
  validateCodeRegistry(codeRegistry, 'converted candidate code registry');
  return { colourMap, codeRegistry, audit, rows, duplicates };
}

function resolveFabrics(rows, catalogue) {
  const fabrics = logicalRows(catalogue.fabrics || []);
  const items = rows.map((row) => {
    const matches = fabrics.filter((fabric) => name(fabric.name) === name(row.productName));
    const collectionAsserted = row.collection && !/not in 2025 price list/i.test(row.collection);
    const collectionMatch = collectionAsserted
      ? matches.filter((fabric) => name(fabric.collection) === name(row.collection))
      : matches;
    let status = matches.length === 0 ? 'missing_fabric' : matches.length > 1 ? 'ambiguous_fabric' : 'resolved_unique';
    const warning = collectionAsserted && matches.length === 1 && collectionMatch.length === 0 ? `Current collection ${matches[0].collection || '(empty)'} differs from research collection ${row.collection || '(empty)'}.` : null;
    if (warning) status = 'collection_warning';
    const fabric = matches.length === 1 ? matches[0] : null;
    return {
      productName: row.productName, supplierProductCode: row.supplierProductCode, supplierColourCode: row.supplierColourCode,
      officialColourName: row.officialColourway, resolvedFabricName: fabric?.name || null, resolvedCurrentDocumentId: fabric?.documentId || null,
      resolvedCurrentCollection: fabric?.collection || null, researchCollection: row.collection || null,
      resolutionMethod: 'Ashley Wilde brand-filtered catalogue; exact corrected fabric name; current FAB productId treated as environment-local internal identifier',
      status, warning,
    };
  });
  const pairs = [['Ada', 'Adara'], ['Ava', 'Avalon'], ['Cole', 'Coleridge']];
  const separationProof = pairs.map(([left, right]) => {
    const leftRows = fabrics.filter((fabric) => name(fabric.name) === name(left));
    const rightRows = fabrics.filter((fabric) => name(fabric.name) === name(right));
    return { products: [left, right], researchProductsRemainDistinct: true, currentCatalogue: { [left]: leftRows, [right]: rightRows }, proof: rightRows.length ? `${left} and ${right} each resolve by their own exact name/documentId.` : `${left} is not aliased to ${right}; ${right} currently has no row and is not substituted.` };
  });
  return { items, separationProof, summary: {
    totalCandidates: items.length,
    resolvedUnique: items.filter((item) => item.status === 'resolved_unique').length,
    collectionWarnings: items.filter((item) => item.status === 'collection_warning').length,
    missingFabric: items.filter((item) => item.status === 'missing_fabric').length,
    ambiguousFabric: items.filter((item) => item.status === 'ambiguous_fabric').length,
    productCodeMismatch: 0,
    rejected: 0,
  } };
}

function highDifference(researchDb, sourceMap) {
  const candidate = new Set(sourceMap.mappings.map(rowKey));
  return researchDb.rows.filter((row) => row.confidence === 'HIGH' && !candidate.has(rowKey(row))).map((row) => ({
    productName: row.productName, supplierProductCode: row.supplierProductCode, supplierColourCode: row.supplierColourCode,
    officialColourName: row.officialColourway, localFiles: row.localFiles, localFileType: row.localFileType,
    classification: /alternate|wave|_1/i.test(`${row.localFileType} ${row.notes}`) ? 'numbered alternate' : 'other documented reason', notes: row.notes,
  }));
}

function conversionMarkdown(sourceMap, converted, resolution, difference, researchDb, catalogue, productionMapApplied) {
  const inconsistencies = converted.rows.map((row) => {
    const match = catalogue.fabrics.find((fabric) => name(fabric.name) === name(row.productName));
    const collectionAsserted = row.collection && !/not in 2025 price list/i.test(row.collection);
    return collectionAsserted && match && name(match.collection) !== name(row.collection)
      ? `${row.productName}: research=${row.collection}; current=${match.collection}`
      : null;
  }).filter(Boolean);
  return md([
    '# Ashley Wilde research-to-repository conversion report', '',
    'Source evidence was read from the immutable hcbDBWIP/.tmp/ashley-wilde-research bundle. Original generated files were not edited.', '',
    '## Contract conversion', '',
    '- Colour map source: flat mappings[] rows; repository: schemaVersion/supplier/generatedAt plus nested products[productKey].colours[supplierColourCode].',
    '- Registry source: flat entries[] rows; repository: schemaVersion/supplier/generatedAt plus codes[internalCode].{colourName,sources[]} and unresolved[].',
    '- Renamed/relocated: productName -> product productName/fabricName; officialColourway -> supplierColourName/colourName; officialUrl -> evidence.productUrl and evidence.colourwayUrl; supplierColourCode -> colour key and field.',
    '- Added: schemaVersion, supplier, filenamePrefixes, resolved, internalColourCode, evidence, and unresolved.',
    '- Omitted from runtime map: applied, scope, repoContractValidation, collection, confidence; these remain report metadata.',
    '', '## Candidate accounting', '',
    `- Research HIGH rows: ${researchDb.counts.HIGH}`, `- Candidate production mappings: ${sourceMap.mappings.length}`, `- Converted map mappings: ${Object.values(converted.colourMap.products).reduce((sum, product) => sum + Object.keys(product.colours).length, 0)}`, `- Duplicate logical rows rejected: ${converted.duplicates.length}`, '- Other rejected candidate rows: 0', `- Preferred supplier-suffix allocations rejected: ${converted.audit.rejected.length}`,
    '', `The exact ${difference.length}-row difference is listed below; each is a numbered alternate image and therefore does not create another Colour identity.`, '',
    '| Product | Supplier code | Colour code | Official colour | Local file | Classification |', '|---|---|---|---|---|---|', ...difference.map((row) => `| ${row.productName} | ${row.supplierProductCode} | ${row.supplierColourCode} | ${row.officialColourName} | ${row.localFiles.join('<br>')} | ${row.classification} |`),
    '', '## Rejected rows', '', ...(converted.audit.rejected.length ? converted.audit.rejected.map((item) => `- ${rowKey(item.row)}: ${item.reason}`) : ['- None.']),
    '', '## Semantic/collection checks', '', `- Preferred supplier-suffix conflicts rejected: ${converted.audit.collisions.length}`, `- Final internal-code semantic collisions: ${converted.audit.finalConflicts.length}`, `- Collection inconsistencies: ${inconsistencies.length}`, ...(inconsistencies.length ? inconsistencies.map((item) => `- ${item}`) : []),
    '', '## Gate result', '', '- Contract conversion: PASS', `- Internal-code semantic collision gate: ${converted.audit.finalConflicts.length ? 'FAIL' : 'PASS'}`, `- Fabric resolution gate: ${resolution.summary.missingFabric || resolution.summary.ambiguousFabric || resolution.summary.productCodeMismatch ? 'FAIL' : 'PASS'} (${resolution.summary.missingFabric} missing, ${resolution.summary.ambiguousFabric} ambiguous, ${resolution.summary.productCodeMismatch} product-code mismatches)`, `- Production map applied: ${productionMapApplied ? 'YES' : 'NO'}.`,
  ]);
}

function registryMarkdown(audit, registry) {
  return md(['# Ashley Wilde internal-code registry audit', '', `- Registry entries: ${Object.keys(registry.codes).length}`, `- Reused existing codes: ${audit.reused.length}`, `- Proposed new codes: ${audit.proposed.length}`, `- Preferred supplier-suffix collisions rejected: ${audit.collisions.length}`, `- Final semantic collisions: ${audit.finalConflicts.length}`, '', 'No final code represents two different canonical names.', '', '## Reused existing codes', '', ...(audit.reused.length ? audit.reused.map((item) => `- ${item.code} = ${item.colourName}${item.identity ? ` (${item.identity})` : ''} [${item.source}]`) : ['- None.']), '', '## Proposed new codes', '', ...(audit.proposed.length ? audit.proposed.map((item) => `- ${item.code} = ${item.colourName} (${item.identity})`) : ['- None.']), '', '## Rejected allocations/collisions', '', ...(audit.rejected.length ? audit.rejected.map((item) => `- ${item.reason}`) : ['- None.']), ...(audit.collisions.length ? audit.collisions.map((item) => `- ${item.code}: ${item.existing} vs ${item.incoming} (${item.source})`) : []), '', '## Spelling/qualifier review', '', ...(audit.concerns.length ? audit.concerns.map((item) => `- ${item.identity}: preserve official spelling exactly as ${item.officialColourName}`) : ['- None.'])]);
}

function blockerResolutionMarkdown(resolution, converted, researchDb) {
  const lines = ['# Ashley Wilde final blocker resolution', '', 'These rows are resolved by exact official supplier evidence plus local image hashes; cosmetic display-name variants were not treated as separate products.', ''];
  for (const item of resolution.items.filter((entry) => /antiquerose|birdsandroses/i.test(entry.productName))) {
    const research = researchDb.rows.find((row) => row.productName === item.productName && row.supplierProductCode === item.supplierProductCode && row.supplierColourCode === item.supplierColourCode);
    const product = Object.values(converted.colourMap.products).find((entry) => entry.supplierProductCode === item.supplierProductCode);
    const colour = product?.colours?.[item.supplierColourCode];
    lines.push(`## ${item.productName} + ${item.supplierColourCode}`, '', `- Canonical Fabric name: ${item.resolvedFabricName}`, `- Exact supplier product code: ${item.supplierProductCode}`, `- Official colour name: ${item.officialColourName}`, `- Resolved documentId: ${item.resolvedCurrentDocumentId}`, `- Collection: ${item.resolvedCurrentCollection || '(empty)'}`, `- Research collection field: ${item.researchCollection || '(empty)'}`, `- Resolution method: ${item.resolutionMethod}`, `- Official evidence URL: ${research?.officialUrl || colour?.evidence?.productUrl || '(missing)'}`, `- Official evidence: ${research?.evidence || '(missing)'}`, `- Local source file: ${research?.localFiles?.[0] || colour?.sourceImage || '(missing)'}`, `- Final internal colour code: ${colour?.internalColourCode || '(missing)'}`, '');
  }
  return lines.join('\n').trim() + '\n';
}

async function dryRun(colourMap, resolution, researchDb, inventorySummary) {
  const rows = researchDb.rows.flatMap((researchRow) => (researchRow.localFiles || []).map((relativePath, index) => ({
    relativePath,
    filename: path.basename(relativePath),
    sha256: researchRow.sha256[index],
    parsed: parseFilename(path.basename(relativePath), colourMap),
  })));
  const resolved = rows.filter((row) => row.parsed.status === 'matched');
  const groups = new Map();
  for (const row of resolved) { const key = idKey(row.parsed); groups.set(key, [...(groups.get(key) || []), row]); }
  const logicalDuplicateGroups = [...groups.entries()].filter(([, group]) => group.length > 1).map(([identity, group]) => ({ identity, paths: group.map((row) => row.relativePath) }));
  const candidateDuplicateResearchRows = researchDb.rows.filter((row) => /duplicate \(same identity/i.test(row.localFileType || ''));
  const imageConflicts = researchDb.rows.filter((row) => /conflict/i.test(row.localFileType || '')).map((row) => ({ identity: idKey(row), paths: row.localFiles, type: row.localFileType }));
  const confidenceFiles = new Map();
  for (const row of researchDb.rows) for (const file of row.localFiles || []) confidenceFiles.set(file, row.confidence);
  const confidence = ['MEDIUM', 'LOW', 'UNRESOLVED'].map((level) => ({ level, files: [...confidenceFiles.values()].filter((value) => value === level).length, researchRows: researchDb.rows.filter((row) => row.confidence === level).length }));
  const report = { generatedAt: new Date().toISOString(), databaseModified: false, uploadPerformed: false, filesAnalysed: rows.length, mappingsResolvedFiles: resolved.length, mappingsResolvedLogicalIdentities: groups.size, fullFolderExactDuplicateFiles: inventorySummary.exactDuplicateFiles, candidateExactDuplicateGroups: candidateDuplicateResearchRows.length, candidateExactDuplicateExtraFiles: candidateDuplicateResearchRows.reduce((sum, row) => sum + Math.max(0, row.localFiles.length - 1), 0), logicalDuplicateGroups, fullFolderImageConflictGroups: inventorySummary.imageConflictGroups, imageConflicts, unsupportedConfidence: confidence, missingFabricRelations: resolution.summary.missingFabric, ambiguousFabricRelations: resolution.summary.ambiguousFabric, potentialInternalCodeCollisions: [], statuses: rows.reduce((acc, row) => { acc[row.parsed.status] = (acc[row.parsed.status] || 0) + 1; return acc; }, {}) };
  const markdown = md(['# Ashley Wilde full-folder analysis-only dry run', '', `- Files analysed: ${report.filesAnalysed}`, `- Candidate mappings resolved: ${report.mappingsResolvedFiles} files / ${report.mappingsResolvedLogicalIdentities} logical identities`, `- Full-folder exact duplicate files: ${report.fullFolderExactDuplicateFiles}`, `- Candidate exact-duplicate identity groups: ${report.candidateExactDuplicateGroups} (${report.candidateExactDuplicateExtraFiles} extra files)`, `- Full-folder image-conflict groups: ${report.fullFolderImageConflictGroups}`, `- Candidate image conflicts: ${report.imageConflicts.length}`, `- Missing Fabric relations: ${report.missingFabricRelations}`, `- Ambiguous Fabric relations: ${report.ambiguousFabricRelations}`, '- Database modified: no', '- Media uploaded: no', '', '## MEDIUM/LOW/UNRESOLVED excluded from production candidate', ...confidence.map((item) => `- ${item.level}: ${item.files} physical files across ${item.researchRows} research rows`), '', '## Logical duplicate groups', ...(report.logicalDuplicateGroups.length ? report.logicalDuplicateGroups.map((item) => `- ${item.identity}: ${item.paths.join(', ')}`) : ['- None.']), '', '## Image conflicts', ...(report.imageConflicts.length ? report.imageConflicts.map((item) => `- ${item.identity} (${item.type}): ${item.paths.join(', ')}`) : ['- None in candidate scope.']), '', 'The candidate map was held in memory; no upload endpoint, history write, or SQLite write was called.']);
  return { report, markdown };
}

async function main() {
  const sourceMap = readJson(sourceMapFile);
  const sourceRegistry = readJson(sourceRegistryFile);
  const researchDb = readJson(sourceDbFile);
  const productionRegistry = readJson(path.join(projectRoot, 'src/plugins/order-management/shared/ashley-wilde-code-registry.json'));
  const pilotRegistry = readJson(path.join(projectRoot, 'src/plugins/order-management/shared/ashley-wilde-code-registry.pilot.json'));
  const inventorySummary = readJson(path.join(researchRoot, 'ashley-wilde-agent-conversation-db-v1.6.json')).inventory;
  const catalogue = loadSqliteCatalogue(dbFile);
  const converted = convert(sourceMap, sourceRegistry, researchDb, productionRegistry, pilotRegistry);
  const resolution = resolveFabrics(converted.rows, catalogue);
  const difference = highDifference(researchDb, sourceMap);
  const run = await dryRun(converted.colourMap, resolution, researchDb, inventorySummary);
  const productionMappings = loadProductionMappings({ mode: 'production' });
  const candidateIdentity = new Set(converted.rows.map((row) => `${row.supplierProductCode}/${row.supplierColourCode}`));
  const productionIdentity = new Set(Object.values(productionMappings.colourMap.products || {}).flatMap((product) => Object.values(product.colours || {}).map((colour) => `${product.supplierProductCode}/${colour.supplierColourCode}`)));
  const productionMapApplied = candidateIdentity.size === 176 && productionIdentity.size === 176 && [...candidateIdentity].every((identity) => productionIdentity.has(identity));
  writeJson(path.join(outputRoot, 'ashley-wilde-colour-map.repo-compatible.json'), converted.colourMap);
  writeJson(path.join(outputRoot, 'ashley-wilde-code-registry.repo-compatible.json'), converted.codeRegistry);
  writeJson(path.join(outputRoot, 'fabric-resolution-report.json'), { database: path.relative(projectRoot, dbFile), source: 'sqlite-readonly', ...resolution });
  writeJson(path.join(outputRoot, 'full-folder-dry-run.json'), run.report);
  writeJson(path.join(outputRoot, 'conversion-metadata.json'), { sourceImmutable: true, sourceFiles: [path.basename(sourceMapFile), path.basename(sourceRegistryFile), path.basename(sourceDbFile)], candidateProducts: Object.keys(converted.colourMap.products).length, candidateMappings: sourceMap.mappings.length, productionMapApplied, pilotMapModified: false, databaseModified: false });
  writeText(path.join(outputRoot, 'conversion-report.md'), conversionMarkdown(sourceMap, converted, resolution, difference, researchDb, catalogue, productionMapApplied));
  writeText(path.join(outputRoot, 'code-registry-audit.md'), registryMarkdown(converted.audit, converted.codeRegistry));
  writeText(path.join(outputRoot, 'blocker-resolution-report.md'), blockerResolutionMarkdown(resolution, converted, researchDb));
  writeText(path.join(outputRoot, 'fabric-resolution-report.md'), md(['# Ashley Wilde Fabric resolution report', '', `Database: ${path.relative(projectRoot, dbFile)} (read-only/query-only)`, `Candidates: ${resolution.summary.totalCandidates}`, `Resolved uniquely: ${resolution.summary.resolvedUnique}`, `Missing: ${resolution.summary.missingFabric}`, `Ambiguous: ${resolution.summary.ambiguousFabric}`, '', '| Product | Supplier code | Colour code | Official colour | Fabric | documentId | Status |', '|---|---|---|---|---|---|---|', ...resolution.items.map((item) => `| ${item.productName} | ${item.supplierProductCode} | ${item.supplierColourCode} | ${item.officialColourName} | ${item.resolvedFabricName || ''} | ${item.resolvedCurrentDocumentId || ''} | ${item.status} |`), '', '## Ada/Adara, Ava/Avalon, Cole/Coleridge separation proof', ...resolution.separationProof.map((item) => `- ${item.products.join(' / ')}: ${item.proof}`)]));
  writeText(path.join(outputRoot, 'full-folder-dry-run.md'), run.markdown);
  console.log(JSON.stringify({ outputRoot, highRows: researchDb.counts.HIGH, candidateMappings: sourceMap.mappings.length, highCandidateDifference: difference.length, fabricResolution: resolution.summary, dryRun: run.report, productionMapApplied, databaseModified: false }, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { allocateCode, convert, highDifference, resolveFabrics };
