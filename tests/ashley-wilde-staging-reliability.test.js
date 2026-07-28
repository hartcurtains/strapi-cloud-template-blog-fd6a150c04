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

test('a 13 MiB target cannot create a 25.6 MiB multi-file batch', () => {
  const utility = loadBrowserModule(path.join(root, 'admin', 'src', 'utils', 'ashleyWildeFolder.js'), ['partitionUploadRows', 'assertUploadBatch']);
  const rows = [{ size: Math.round(12.8 * 1024 * 1024), filename: 'a.jpg' }, { size: Math.round(12.8 * 1024 * 1024), filename: 'b.jpg' }];
  const result = utility.partitionUploadRows(rows, 10, 13 * 1024 * 1024);
  assert.equal(result.batches.length, 2);
  assert.ok(result.batches.every((batch) => batch.reduce((sum, row) => sum + row.size, 0) <= 13 * 1024 * 1024));
});

test('a file above the normal target but below the individual limit is sent alone', () => {
  const utility = loadBrowserModule(path.join(root, 'admin', 'src', 'utils', 'ashleyWildeFolder.js'), ['partitionUploadRows', 'assertUploadBatch']);
  const result = utility.partitionUploadRows([
    { size: 19 * 1024 * 1024, filename: 'large.jpg' },
    { size: 2 * 1024 * 1024, filename: 'small.jpg' },
  ], 10, 9 * 1024 * 1024);
  assert.equal(JSON.stringify(result.batches.map((batch) => batch.map((row) => row.filename))), JSON.stringify([['large.jpg'], ['small.jpg']]));
  assert.doesNotThrow(() => utility.assertUploadBatch(result.batches[0], 10, 9 * 1024 * 1024));
});

test('a multi-file batch is rejected before FormData/network dispatch when it exceeds the effective target', () => {
  const utility = loadBrowserModule(path.join(root, 'admin', 'src', 'utils', 'ashleyWildeFolder.js'), ['assertUploadBatch']);
  assert.throws(() => utility.assertUploadBatch([
    { size: 8 * 1024 * 1024, filename: 'a.jpg' },
    { size: 6 * 1024 * 1024, filename: 'b.jpg' },
  ], 10, 13 * 1024 * 1024), /exceeds/);
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

test('the conservative policy keeps requests sequential and uses one authoritative timeout', () => {
  const component = fs.readFileSync(path.join(root, 'admin', 'src', 'components', 'AshleyWildeFolderImporter.jsx'), 'utf8');
  assert.equal(policy.maxBatchFiles, 1);
  assert.equal(policy.requestTimeoutMs, 120000);
  assert.match(component, /await stageBatchRequest\(post/);
  assert.match(component, /STAGING_REQUEST_TIMEOUT_MS/);
  assert.match(component, /for \(let index = 0; index < stagingBatches\.length; index \+= 1\)/);
});
