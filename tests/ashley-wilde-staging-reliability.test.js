'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.join(process.cwd(), 'src', 'plugins', 'order-management');
const policy = require(path.join(root, 'shared', 'ashley-wilde-upload-policy.json'));

function loadBrowserModule(file, exports) {
  let source = fs.readFileSync(file, 'utf8')
    .replace(/^import uploadPolicy from .*;\r?\n/m, `const uploadPolicy = ${JSON.stringify(policy)};\n`)
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ')
    .replace(/export async function /g, 'async function ');
  source += `\nmodule.exports = { ${exports.join(', ')} };`;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, console, TextEncoder, window: {} });
  return module.exports;
}

test('a prepared 19.4 MiB image is accepted by the Ashley policy', () => {
  const utility = loadBrowserModule(path.join(root, 'admin', 'src', 'utils', 'ashleyWildeFolder.js'), ['partitionUploadRows', 'assertUploadBatch']);
  const result = utility.partitionUploadRows([{ size: Math.round(19.4 * 1024 * 1024), filename: 'prepared.jpg' }]);
  assert.equal(result.batches.length, 1);
  assert.equal(result.oversized.length, 0);
  assert.doesNotThrow(() => utility.assertUploadBatch(result.batches[0]));
});

test('files above 20 MiB remain unsupported', () => {
  const utility = loadBrowserModule(path.join(root, 'admin', 'src', 'utils', 'ashleyWildeFolder.js'), ['partitionUploadRows', 'assertUploadBatch']);
  const result = utility.partitionUploadRows([{ size: 20 * 1024 * 1024 + 1, filename: 'too-large.jpg' }]);
  assert.equal(result.batches.length, 0);
  assert.equal(result.oversized[0].status, 'unsupported_file');
  assert.throws(() => utility.assertUploadBatch(result.oversized), /oversized/);
});

test('Ashley staging policy permits one file and never permits a multi-file upload batch', () => {
  const utility = loadBrowserModule(path.join(root, 'admin', 'src', 'utils', 'ashleyWildeFolder.js'), ['assertUploadBatch']);
  assert.throws(() => utility.assertUploadBatch([
    { size: 8 * 1024 * 1024, filename: 'a.jpg' },
    { size: 6 * 1024 * 1024, filename: 'b.jpg' },
  ]), /file count/);
});

test('text/plain 503 responses are read as text and never passed to JSON.parse', async () => {
  const parser = loadBrowserModule(path.join(root, 'admin', 'src', 'utils', 'stagingResponse.js'), ['parseStagingResponse', 'normalizeStagingError']);
  let jsonCalled = false;
  await assert.rejects(
    () => parser.parseStagingResponse({
      ok: false,
      status: 503,
      headers: { get: () => 'text/plain' },
      json: async () => { jsonCalled = true; throw new Error('JSON.parse should not run'); },
      text: async () => 'upstream connect error or disconnect/reset before headers',
    }),
    (error) => error.code === 'ASHLEY_WILDE_UPSTREAM_UNAVAILABLE' && /upstream connect error/.test(error.upstreamMessage),
  );
  assert.equal(jsonCalled, false);
});

test('the Ashley transport has one Media upload and a JSON-only finalisation request', () => {
  const component = fs.readFileSync(path.join(root, 'admin', 'src', 'components', 'AshleyWildeFolderImporter.jsx'), 'utf8');
  const mediaUpload = fs.readFileSync(path.join(root, 'admin', 'src', 'utils', 'ashleyWildeMediaUpload.js'), 'utf8');
  const routes = require(path.join(root, 'shared', 'routes.json'));
  assert.equal(policy.maxBatchFiles, 1);
  assert.equal(policy.maxFileBytes, 20 * 1024 * 1024);
  assert.equal(routes.ashleyWildeFinalise, '/order-management/ashley-wilde/finalise');
  assert.match(mediaUpload, /ASHLEY_MEDIA_UPLOAD_PATH = '\/upload'/);
  assert.match(mediaUpload, /form\.append\('files', file/);
  assert.match(component, /uploadAshleyWildeMedia\(row\.file/);
  assert.match(component, /adminResponse\(post, adminCatalogRoutes\.ashleyWildeFinalise/);
  assert.doesNotMatch(component, /bulkImageUpload|new\s+FormData\(\)/);
});

test('the alternate bulk uploader uses the shared parser for staging responses', () => {
  const component = fs.readFileSync(path.join(root, 'admin', 'src', 'components', 'BulkImageUploader.jsx'), 'utf8');
  const stagingPath = component.slice(component.indexOf('fetch(adminCatalogRoutes.bulkImageUpload'));
  assert.match(stagingPath, /parseStagingResponse\(response\)/);
  assert.doesNotMatch(stagingPath, /response\.json\(\)/);
  assert.match(component, /STAGING_PARSER_VERSION/);
});
