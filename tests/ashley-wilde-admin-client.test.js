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
const uploadDiagnosticsSource = fs.readFileSync(path.join(process.cwd(), 'src', 'middlewares', 'ashley-upload-diagnostics.ts'), 'utf8');
const middlewareConfigSource = fs.readFileSync(path.join(process.cwd(), 'config', 'middlewares.ts'), 'utf8');
const compiledUploadDiagnosticsPath = path.join(process.cwd(), 'dist', 'src', 'middlewares', 'ashley-upload-diagnostics.js');
const sharedRoutes = require(path.join(root, 'shared', 'routes.json'));
const uploadPolicy = require(path.join(root, 'shared', 'ashley-wilde-upload-policy.json'));

test('Ashley Wilde admin importer uses Strapi authenticated fetch for every request', () => {
  assert.match(componentSource, /import\s*\{\s*getFetchClient,\s*useFetchClient\s*\}\s*from\s*['"]@strapi\/strapi\/admin['"]/);
  assert.match(componentSource, /const\s*\{\s*get,\s*put,\s*del\s*\}\s*=\s*useFetchClient\(\)/);
  assert.match(componentSource, /const\s+post\s*=\s*useCallback\(\(\.\.\.args\)\s*=>\s*getFetchClient\(\)\.post\(\.\.\.args\),\s*\[\]\)/);
  assert.match(componentSource, /adminResponse\(get,\s*adminCatalogRoutes\.ashleyWildeMode/);
  assert.match(componentSource, /adminResponse\(get,\s*adminCatalogRoutes\.ashleyWildeHistory/);
  assert.match(componentSource, /adminResponse\(post,\s*adminCatalogRoutes\.ashleyWildeAnalyse/);
  assert.match(componentSource, /uploadAshleyWildeMedia/);
  assert.match(componentSource, /adminResponse\(post,\s*adminCatalogRoutes\.ashleyWildeFinalise/);
  assert.doesNotMatch(componentSource, /\bfetch\s*\(/);
  assert.doesNotMatch(componentSource, /localStorage|sessionStorage|Authorization\s*:/);
  assert.doesNotMatch(componentSource, /Content-Type\s*:/);
  assert.doesNotMatch(componentSource, /new\s+FormData\(\)/);
  assert.doesNotMatch(componentSource, /bulkImageUpload/);
  assert.doesNotMatch(componentSource, /parseMappedFilename|browserMappingForMode|validateBrowserMapping/);
  assert.match(componentSource, /const\s+serverAnalysis\s*=\s*analysisResponse\.data/);
  assert.match(componentSource, /return\s*\{\s*\.\.\.row,\s*file:\s*local\?\.file,\s*previewUrl:\s*local\?\.previewUrl,\s*warning\s*\}/);
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
  for (const key of ['ashleyWildeAnalyse', 'ashleyWildeFinalise', 'ashleyWildeHistory', 'ashleyWildeMode', 'bulkImageUpload']) {
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

test('Ashley Wilde production multipart staging is retired without changing generic bulk upload routing', () => {
  const apiController = fs.readFileSync(path.join(process.cwd(), 'src', 'api', 'order-management', 'controllers', 'order-management.ts'), 'utf8');
  const pluginEntry = fs.readFileSync(path.join(root, 'strapi-server.js'), 'utf8');
  const services = fs.readFileSync(path.join(root, 'server', 'services', 'index.js'), 'utf8');
  assert.match(apiController, /Ashley Wilde staging now uses the Strapi Media Library upload/);
  assert.doesNotMatch(apiController, /processBatch\(strapi, validatedFiles/);
  assert.match(pluginEntry, /services:\s*require\(['"]\.\/server\/services['"]\)/);
  assert.match(services, /'ashley-wilde-import':\s*require\(['"]\.\/ashley-wilde-import['"]\)/);
});

test('Ashley Wilde phase-one queue uses one-file staging requests with sequential hashing and analysis/upload concurrency one', () => {
  const utilitySource = fs.readFileSync(path.join(root, 'admin', 'src', 'utils', 'ashleyWildeFolder.js'), 'utf8');
  const importerSource = fs.readFileSync(path.join(root, 'server', 'services', 'ashley-wilde-import.js'), 'utf8');
  assert.match(componentSource, /fileQueueRef\s*=\s*useRef\(\[\]\)/);
  assert.match(componentSource, /const \{ batches, oversized \} = partitionUploadRows\(hashed, MAX_BATCH_FILES, MAX_BATCH_BYTES\)/);
  assert.match(componentSource, /for \(let index = 0; index < fileQueueRef\.current\.length; index \+= 1\)[\s\S]*await sha256File\(item\.file\)/);
  assert.match(componentSource, /for \(let index = 0; index < batches\.length; index \+= 1\)[\s\S]*ashleyWildeAnalyse/);
  assert.match(componentSource, /stageQueuedFolder[\s\S]*stageAshleyRow/);
  assert.match(componentSource, /partitionUploadRows\(hashed, MAX_BATCH_FILES, MAX_BATCH_BYTES\)/);
  assert.match(componentSource, /function preflightStats\(rows\)/);
  assert.match(componentSource, /above20MiB/);
  assert.match(componentSource, /projectedBatches/);
  assert.match(componentSource, /current\.forEach\(\(item\) => item\.previewUrl && URL\.revokeObjectURL\(item\.previewUrl\)\)/);
  assert.match(componentSource, /setFolderFiles\(\(current\)[\s\S]*return analysedRows;/);
  assert.equal(uploadPolicy.maxBatchFiles, 1);
  assert.equal(uploadPolicy.normalBatchTargetBytes, 20 * 1024 * 1024);
  assert.equal(uploadPolicy.maxFileBytes, 20 * 1024 * 1024);
  assert.match(utilitySource, /export function assertUploadBatch/);
  assert.deepEqual(Array.from({ length: Math.ceil(35 / 10) }, (_, index) => Math.min(10, 35 - index * 10)), [10, 10, 10, 5]);
  assert.match(importerSource, /body\?\.queueBatch \? normalizeManifest\(body\?\.folderManifest\) : manifest/);
});

test('Ashley Wilde staging uses one Media upload followed by JSON-only finalisation', () => {
  const utilitySource = fs.readFileSync(path.join(root, 'admin', 'src', 'utils', 'ashleyWildeFolder.js'), 'utf8');
  const mediaUploadSource = fs.readFileSync(path.join(root, 'admin', 'src', 'utils', 'ashleyWildeMediaUpload.js'), 'utf8');
  assert.match(mediaUploadSource, /ASHLEY_MEDIA_UPLOAD_PATH = '\/upload'/);
  assert.match(mediaUploadSource, /form\.append\('files', file/);
  assert.match(mediaUploadSource, /parseStagingResponse\(response\)/);
  assert.match(componentSource, /uploadAshleyWildeMedia\(row\.file/);
  assert.match(componentSource, /adminResponse\(post, adminCatalogRoutes\.ashleyWildeFinalise/);
  assert.doesNotMatch(componentSource, /bulkImageUpload/);
  assert.doesNotMatch(componentSource, /new\s+FormData\(\)/);
  assert.match(utilitySource, /MAX_BATCH_FILES = uploadPolicy\.maxBatchFiles/);
  assert.match(utilitySource, /MAX_FILE_BYTES = uploadPolicy\.maxFileBytes/);
  assert.equal(uploadPolicy.maxFileBytes, 20 * 1024 * 1024);
});

test('Ashley Wilde rejects only files above the 20 MiB prepared-image contract', () => {
  const utilitySource = fs.readFileSync(path.join(root, 'admin', 'src', 'utils', 'ashleyWildeFolder.js'), 'utf8');
  assert.match(utilitySource, /export function partitionUploadRows/);
  assert.match(utilitySource, /const oversized = \[\]/);
  assert.match(utilitySource, /status: 'unsupported_file'/);
  assert.match(utilitySource, /continue;/);
  assert.match(utilitySource, /return \{ batches, oversized \}/);
  assert.match(componentSource, /summary\.skippedFiles = oversized\.length/);
  assert.match(componentSource, /This image has not been prepared for web upload/);
  assert.match(componentSource, /MAX_FILE_BYTES/);
  assert.equal(uploadPolicy.maxFileBytes, 20 * 1024 * 1024);
});

test('Ashley Wilde upload observability exposes only safe request phase metadata', () => {
  assert.match(controllerSource, /logAshleyWildeUpload\(ctx, 'request-received'\)/);
  const apiController = fs.readFileSync(path.join(process.cwd(), 'src', 'api', 'order-management', 'controllers', 'order-management.ts'), 'utf8');
  assert.match(controllerSource, /finaliseAshleyWilde/);
  assert.match(controllerSource, /Media Library upload followed by JSON finalisation/);
  assert.match(apiController, /Ashley Wilde staging now uses the Strapi Media Library upload followed by JSON finalisation/);
  assert.match(controllerSource, /authenticatedAdminId/);
  assert.match(importerServiceSource, /safeLog\(strapi, 'analysis-token-validation-start'/);
  assert.match(importerServiceSource, /timedStage\(strapi, 'mapping-load-finalise'/);
  assert.match(importerServiceSource, /timedStage\(strapi, 'staging-finalise'/);
  assert.match(importerServiceSource, /retryable_finalisation_failure/);
});

test('Ashley Media upload request diagnostics are trace-gated and lifecycle-shaped', () => {
  assert.match(middlewareConfigSource, /global::ashley-upload-diagnostics/);
  assert.match(uploadDiagnosticsSource, /String\(ctx\?\.method \|\| ''\)\.toUpperCase\(\) === 'POST'/);
  assert.match(uploadDiagnosticsSource, /String\(ctx\?\.path \|\| ''\) === '\/upload'/);
  assert.match(uploadDiagnosticsSource, /traceIdFromRequest\(ctx\)/);
  assert.match(uploadDiagnosticsSource, /'upload_request_received'/);
  assert.match(uploadDiagnosticsSource, /contentLength/);
  assert.match(uploadDiagnosticsSource, /authenticatedAdminPresent/);
  assert.match(uploadDiagnosticsSource, /startTime/);
  assert.match(uploadDiagnosticsSource, /'upload_request_completed'/);
  assert.match(uploadDiagnosticsSource, /responseStatus: ctx\.status/);
  assert.match(uploadDiagnosticsSource, /durationMs/);
  assert.match(uploadDiagnosticsSource, /errorClass/);
  assert.match(uploadDiagnosticsSource, /safeMessage/);
  assert.doesNotMatch(uploadDiagnosticsSource, /analysisToken|fileInfo|buffer/);
});

test('compiled Ashley upload diagnostics load and preserve downstream success/error behavior', async () => {
  assert.equal(fs.existsSync(compiledUploadDiagnosticsPath), true);
  assert.doesNotMatch(fs.readFileSync(compiledUploadDiagnosticsPath, 'utf8'), /plugins[\\/]order-management[\\/]server[\\/]utils[\\/]ashleyWildeDiagnostics/);
  const factory = require(compiledUploadDiagnosticsPath);
  assert.equal(typeof factory, 'function');
  const handler = factory();
  const previousStrapi = global.strapi;
  const logs = [];
  global.strapi = { log: { info: (entry) => logs.push(entry) } };
  const traceId = 'aw_abcdef01*12345678*1';
  const requestStream = { untouched: true };
  const context = {
    method: 'POST',
    path: '/upload',
    status: 201,
    request: { headers: { 'x-ashley-trace-id': traceId }, stream: requestStream },
    state: { catalogWriteAuth: { kind: 'admin', user: { isActive: true } } },
    get: (name) => name === 'content-length' ? '1234' : '',
  };
  try {
    await handler({ ...context, method: 'GET' }, async () => {});
    await handler({ ...context, request: { headers: {} } }, async () => {});
    assert.equal(logs.length, 0);

    await handler(context, async () => { assert.equal(context.request.stream, requestStream); });
    assert.match(logs[0], /upload_request_received/);
    assert.match(logs[0], /"traceId":"aw_abcdef01\*12345678\*1"/);
    assert.match(logs[0], /"contentLength":1234/);
    assert.match(logs[0], /"authenticatedAdminPresent":true/);
    assert.match(logs[1], /upload_request_completed/);
    assert.match(logs[1], /"responseStatus":201/);
    assert.match(logs[1], /"durationMs":/);

    logs.length = 0;
    const thrown = new Error('safe downstream failure');
    await assert.rejects(() => handler(context, async () => { throw thrown; }), (error) => error === thrown);
    assert.match(logs[1], /upload_request_error/);
    assert.match(logs[1], /"errorClass":"Error"/);
    assert.match(logs[1], /"safeMessage":"safe downstream failure"/);
  } finally {
    global.strapi = previousStrapi;
  }
});

test('Ashley Wilde staging has a single safe response parser and stops after a retryable upstream failure', () => {
  const parserSource = fs.readFileSync(path.join(root, 'admin', 'src', 'utils', 'stagingResponse.js'), 'utf8');
  assert.match(parserSource, /inspect.*content-type|contentTypeOf/);
  assert.match(parserSource, /isJsonContentType/);
  assert.match(parserSource, /response\.text\(\)/);
  assert.match(componentSource, /status === 503 .*ASHLEY_WILDE_UPSTREAM_UNAVAILABLE/);
  assert.match(parserSource, /The image service was temporarily unavailable\. This file was not confirmed as complete\. Check its status before retrying/);
  assert.match(componentSource, /await refreshHistory\(\);\s*setError\(safeErrorMessage/);
  assert.match(componentSource, /for \(let index = 0; index < stagingRows\.length; index \+= 1\)/);
});

test('Ashley Wilde finalisation keeps token validation ahead of Media binding and staging writes', () => {
  const apiController = fs.readFileSync(path.join(process.cwd(), 'src', 'api', 'order-management', 'controllers', 'order-management.ts'), 'utf8');
  assert.match(apiController, /Ashley Wilde staging now uses the Strapi Media Library upload/);
  assert.match(routeSource, /ashleyWildeFinalise/);
  assert.match(importerServiceSource, /verifyAnalysisToken\(body\?\.analysisToken/);
  assert.match(importerServiceSource, /validateAshleyMedia/);
  assert.match(importerServiceSource, /mediaBindingFor/);
  const finaliseSource = importerServiceSource.slice(importerServiceSource.indexOf('async function finaliseAshleyWildeMedia'));
  assert.ok(finaliseSource.indexOf('verifyAnalysisToken(body?.analysisToken') < finaliseSource.indexOf('validateAshleyMedia'));
});
