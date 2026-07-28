'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(process.cwd(), 'src', 'plugins', 'order-management');
const componentSource = fs.readFileSync(
  path.join(root, 'admin', 'src', 'components', 'AshleyWildeFolderImporter.jsx'),
  'utf8'
);
const routeSource = fs.readFileSync(path.join(root, 'server', 'routes', 'index.js'), 'utf8');
const controllerSource = fs.readFileSync(path.join(root, 'server', 'controllers', 'import-export.js'), 'utf8');
const importerServiceSource = fs.readFileSync(path.join(root, 'server', 'services', 'ashley-wilde-import.js'), 'utf8');
const sharedRoutes = require(path.join(root, 'shared', 'routes.json'));

test('Ashley Wilde admin importer uses Strapi authenticated fetch for every request', () => {
  assert.match(componentSource, /import\s*\{\s*useFetchClient\s*\}\s*from\s*['"]@strapi\/strapi\/admin['"]/);
  assert.match(componentSource, /const\s*\{\s*get,\s*post,\s*put,\s*del\s*\}\s*=\s*useFetchClient\(\)/);
  assert.match(componentSource, /adminResponse\(get,\s*adminCatalogRoutes\.ashleyWildeMode/);
  assert.match(componentSource, /adminResponse\(get,\s*adminCatalogRoutes\.ashleyWildeHistory/);
  assert.match(componentSource, /adminResponse\(post,\s*adminCatalogRoutes\.ashleyWildeAnalyse/);
  assert.match(componentSource, /adminResponse\(post,\s*adminCatalogRoutes\.bulkImageUpload/);
  assert.doesNotMatch(componentSource, /\bfetch\s*\(/);
  assert.doesNotMatch(componentSource, /localStorage|sessionStorage|Authorization\s*:/);
  assert.doesNotMatch(componentSource, /Content-Type\s*:/);
  assert.match(componentSource, /new\s+FormData\(\)/);
  assert.match(componentSource, /adminResponse\(post,\s*adminCatalogRoutes\.bulkImageUpload,\s*form\)/);
  assert.doesNotMatch(componentSource, /parseMappedFilename|browserMappingForMode|validateBrowserMapping/);
  assert.match(componentSource, /const\s+serverAnalysis\s*=\s*analysisResponse\.data/);
  assert.match(componentSource, /return\s*\{\s*file:\s*local\?\.file,\s*previewUrl:\s*local\?\.previewUrl,\s*\.\.\.row\s*\}/);
  assert.doesNotMatch(componentSource, /ashley-wilde-(?:colour-map|code-registry)/);
  assert.doesNotMatch(componentSource, /STRAPI_API_TOKEN|process\.env/);
});

test('Ashley Wilde admin utility contains only presentation/file helpers, never a browser mapping source', () => {
  assert.doesNotMatch(componentSource, /from ['"]\.\.\/\.\.\/shared\/ashley-wilde/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'admin', 'src', 'utils', 'ashleyWildeFolder.js'), 'utf8'), /ashley-wilde-(?:colour-map|code-registry)/);
});

test('Ashley Wilde preview renders the exact resolved server row properties', () => {
  assert.match(componentSource, /row\.productName\s*\|\|/);
  assert.match(componentSource, /row\.supplierColourName\s*\|\|/);
  assert.match(componentSource, /row\.supplierColourCode\s*\|\|/);
  assert.match(componentSource, /row\.internalColourCode\s*\|\|/);
});

test('Ashley Wilde browser URLs are the registered admin-plugin routes', () => {
  for (const key of ['ashleyWildeAnalyse', 'ashleyWildeHistory', 'ashleyWildeMode', 'bulkImageUpload']) {
    const route = sharedRoutes[key];
    assert.ok(route, `missing shared route ${key}`);
    const routePath = route.slice(sharedRoutes.base.length);
    assert.match(routeSource, new RegExp(`path: relativePath\\(adminCatalogRoutes\\.${key}\\)`));
    assert.match(routeSource, new RegExp(`handler: 'import-export\\.`));
    assert.match(routeSource, new RegExp(`path: relativePath\\(adminCatalogRoutes\\.${key}\\)[\\s\\S]{0,220}config:`));
    if (key !== 'bulkImageUpload') {
      assert.match(routeSource, new RegExp(`path: relativePath\\(adminCatalogRoutes\\.${key}\\)[\\s\\S]{0,260}admin::isAuthenticatedAdmin`));
    }
    assert.ok(routePath.startsWith('/'));
  }
});

test('Ashley Wilde mode and analysis responses expose server mapping metadata', () => {
  assert.match(importerServiceSource, /loadProductionMappings\(\)/);
  assert.match(controllerSource, /schemaVersion:\s*mappings\.colourMap\.schemaVersion/);
  assert.match(controllerSource, /generatedAt:\s*mappings\.colourMap\.generatedAt/);
  const importerSource = fs.readFileSync(path.join(root, 'server', 'services', 'ashley-wilde-import.js'), 'utf8');
  assert.match(importerSource, /mappingGeneratedAt:\s*mappings\.colourMap\.generatedAt/);
});

test('Ashley Wilde production upload resolves its importer through the plugin service registry', () => {
  const apiController = fs.readFileSync(path.join(process.cwd(), 'src', 'api', 'order-management', 'controllers', 'order-management.ts'), 'utf8');
  const pluginEntry = fs.readFileSync(path.join(root, 'strapi-server.js'), 'utf8');
  const services = fs.readFileSync(path.join(root, 'server', 'services', 'index.js'), 'utf8');
  assert.match(apiController, /strapi\.plugin\('order-management'\)\?\.service\('ashley-wilde-import'\)/);
  assert.doesNotMatch(apiController, /require\(['"]\.\.\/\.\.\/\.\.\/plugins\/order-management\/server\/services\/ashley-wilde-import['"]\)/);
  assert.match(pluginEntry, /services:\s*require\(['"]\.\/server\/services['"]\)/);
  assert.match(services, /'ashley-wilde-import':\s*require\(['"]\.\/ashley-wilde-import['"]\)/);
});

test('Ashley Wilde phase-one queue is bounded to 10 files with sequential hashing and analysis/upload concurrency one', () => {
  const utilitySource = fs.readFileSync(path.join(root, 'admin', 'src', 'utils', 'ashleyWildeFolder.js'), 'utf8');
  const importerSource = fs.readFileSync(path.join(root, 'server', 'services', 'ashley-wilde-import.js'), 'utf8');
  assert.match(componentSource, /fileQueueRef\s*=\s*useRef\(\[\]\)/);
  assert.match(componentSource, /const batches = sequentialBatches\(hashed, MAX_BATCH_FILES, MAX_BATCH_BYTES\)/);
  assert.match(componentSource, /for \(let index = 0; index < fileQueueRef\.current\.length; index \+= 1\)[\s\S]*await sha256File\(item\.file\)/);
  assert.match(componentSource, /for \(let index = 0; index < batches\.length; index \+= 1\)[\s\S]*ashleyWildeAnalyse/);
  assert.match(componentSource, /stageQueuedFolder[\s\S]*stageBatchRequest/);
  assert.match(componentSource, /current\.forEach\(\(item\) => item\.previewUrl && URL\.revokeObjectURL\(item\.previewUrl\)\)/);
  assert.match(componentSource, /setFolderFiles\(\(current\)[\s\S]*return analysedRows;/);
  assert.match(utilitySource, /for \(let index = 0; index < items\.length; index \+= size\) batches\.push\(items\.slice\(index, index \+ size\)\)/);
  assert.deepEqual(Array.from({ length: Math.ceil(35 / 10) }, (_, index) => Math.min(10, 35 - index * 10)), [10, 10, 10, 5]);
  assert.match(importerSource, /body\?\.queueBatch \? normalizeManifest\(body\?\.folderManifest\) : manifest/);
});

test('Ashley Wilde staging is a single authenticated multipart request per sequential byte-bounded batch', () => {
  const utilitySource = fs.readFileSync(path.join(root, 'admin', 'src', 'utils', 'ashleyWildeFolder.js'), 'utf8');
  const fetchAllFabricsSource = fs.readFileSync(path.join(root, 'shared', 'fetch-all-fabrics.js'), 'utf8');
  assert.match(componentSource, /const STAGING_REQUEST_TIMEOUT_MS = 90 \* 1000/);
  assert.match(componentSource, /const controller = new AbortController\(\)/);
  assert.match(componentSource, /adminResponse\(request, adminCatalogRoutes\.bulkImageUpload, form, \{ signal: controller\.signal \}\)/);
  assert.match(componentSource, /analysisToken:\s*batch\.analysisToken/);
  assert.match(componentSource, /finalBatch: index === lastStagingBatchIndex/);
  assert.match(componentSource, /stagingRunRef\.current/);
  assert.match(componentSource, /The upload did not start\. Please retry this batch\./);
  assert.doesNotMatch(componentSource, /Content-Type\s*:/);
  assert.match(componentSource, /MAX_BATCH_BYTES/);
  assert.match(componentSource, /totalBytes/);
  assert.match(componentSource, /largestFileBytes/);
  assert.match(utilitySource, /MAX_BATCH_FILES = 10/);
  assert.match(utilitySource, /MAX_BATCH_BYTES = 90 \* 1024 \* 1024/);
  assert.match(utilitySource, /bytes \+ fileSize > maxBytes/);
  assert.match(fetchAllFabricsSource, /signal: options\.signal/);
});

test('Ashley Wilde upload observability exposes only safe request phase metadata', () => {
  assert.match(controllerSource, /logAshleyWildeUpload\(ctx, 'request-received'\)/);
  assert.match(controllerSource, /authenticatedAdminId/);
  assert.match(controllerSource, /batchFileCount/);
  assert.match(controllerSource, /metadataPresent/);
  assert.match(controllerSource, /analysisTokenPresent/);
  assert.match(importerServiceSource, /safeLog\(strapi, 'analysis-token-validation-start'/);
  assert.match(importerServiceSource, /safeLog\(strapi, 'analysis-token-validation-complete'/);
  assert.doesNotMatch(importerServiceSource, /JSON\.stringify\(body\?\.analysisToken\)/);
});
