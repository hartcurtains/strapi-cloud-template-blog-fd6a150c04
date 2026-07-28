'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(process.cwd(), 'src', 'plugins', 'order-management');
const mediaUploadPath = path.join(root, 'admin', 'src', 'utils', 'ashleyWildeMediaUpload.js');
const componentPath = path.join(root, 'admin', 'src', 'components', 'AshleyWildeFolderImporter.jsx');

function loadMediaUploadModule() {
  const parser = fs.readFileSync(path.join(root, 'admin', 'src', 'utils', 'stagingResponse.js'), 'utf8')
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ')
    .replace(/export async function /g, 'async function ');
  const media = fs.readFileSync(mediaUploadPath, 'utf8')
    .replace(/^import .*stagingResponse.*;\r?\n/m, '')
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ')
    .replace(/export async function /g, 'async function ');
  const source = `${parser}\n${media}\nmodule.exports = { uploadAshleyWildeMedia, normalizeMediaRecord, safeMediaUploadErrorMessage, mediaBindingFor, MEDIA_UPLOAD_UNAUTHORISED_MESSAGE };`;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, Blob, FormData, TextEncoder, console, window: {} });
  return module.exports;
}

function preparedFile() {
  const file = new Blob(['prepared-image'], { type: 'image/jpeg' });
  file.name = 'ALASKAAQ.jpg';
  return file;
}

test('Media staging uses the injected Strapi admin client and preserves the Media Library contract', async () => {
  const utility = loadMediaUploadModule();
  const calls = [];
  const media = await utility.uploadAshleyWildeMedia(preparedFile(), {
    analysisToken: 'header.payload.signature',
    folderFingerprint: 'folder-fingerprint',
    relativePath: 'Ashley/ALASKAAQ.jpg',
    fileFingerprint: 'file-fingerprint',
    adminPost: async (...args) => {
      calls.push(args);
      return { data: [{ id: 42, documentId: 'media-42' }] };
    },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(media)), { id: 42, documentId: 'media-42' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/upload');
  assert.ok(calls[0][1] instanceof FormData);
  assert.equal(calls[0][2].signal, undefined);
  assert.equal(calls[0][1].getAll('files').length, 1);
  assert.equal(calls[0][1].get('data'), null);
  const fileInfo = JSON.parse(calls[0][1].get('fileInfo'));
  assert.deepEqual(fileInfo, {
    name: 'ALASKAAQ.jpg',
    alternativeText: 'ALASKAAQ.jpg',
    caption: 'aw-ashley:signature:folder-fingerprint:Ashley/ALASKAAQ.jpg:file-fingerprint',
  });
});

test('native Media response normalization keeps numeric id and documentId distinct', () => {
  const utility = loadMediaUploadModule();
  assert.deepEqual(JSON.parse(JSON.stringify(utility.normalizeMediaRecord([{
    id: 123,
    documentId: 'media-123',
    name: 'TUNBRIDGEDA.jpg',
    mime: 'image/jpeg',
    size: 19865.2,
    url: '/uploads/TUNBRIDGEDA.jpg',
    hash: 'tunbridge-hash',
    width: 4000,
    height: 3000,
  }]))), {
    id: 123,
    documentId: 'media-123',
    name: 'TUNBRIDGEDA.jpg',
    mime: 'image/jpeg',
    size: 19865.2,
    url: '/uploads/TUNBRIDGEDA.jpg',
    hash: 'tunbridge-hash',
    width: 4000,
    height: 3000,
  });
});

test('raw unauthenticated fetch and legacy token construction are absent from Ashley two-phase staging', () => {
  const utility = fs.readFileSync(mediaUploadPath, 'utf8');
  const component = fs.readFileSync(componentPath, 'utf8');
  assert.doesNotMatch(utility, /\bfetch\s*\(/);
  assert.doesNotMatch(utility, /localStorage|sessionStorage|Authorization\s*:/);
  assert.doesNotMatch(component, /localStorage|sessionStorage|Authorization\s*:/);
  assert.doesNotMatch(component, /STRAPI_API_TOKEN|process\.env/);
  assert.match(component, /const post = useCallback\(\(\.\.\.args\) => getFetchClient\(\)\.post\(\.\.\.args\), \[\]\)/);
  assert.match(component, /uploadAshleyWildeMedia\(row\.file, \{[\s\S]*adminPost: post/);
  assert.match(component, /adminResponse\(post, adminCatalogRoutes\.ashleyWildeFinalise/);
  assert.match(component, /adminResponse\(post, adminCatalogRoutes\.ashleyWildeProgress/);
  assert.doesNotMatch(component, /ashleyWildeFinalise, \{ \.\.\.finaliseBody, phase: 'retryable_upload_failure'/);
});

test('upload and finalisation authentication failures are stage-specific while service failures are not session errors', () => {
  const utility = loadMediaUploadModule();
  assert.equal(
    utility.safeMediaUploadErrorMessage({ status: 401 }),
    'The image upload was not authorised. Refresh your administrator session and retry.',
  );
  assert.equal(
    utility.safeMediaUploadErrorMessage({ status: 403 }),
    'The image upload was not authorised. Refresh your administrator session and retry.',
  );
  assert.match(utility.safeMediaUploadErrorMessage({ status: 503 }), /temporarily unavailable/);

  const component = fs.readFileSync(componentPath, 'utf8');
  assert.match(component, /status === 401 \|\| status === 403\) return 'The image was uploaded, but its staging link could not be authorised\./);
  assert.match(component, /status === 503 .*STAGING_RETRY_MESSAGE/);
  assert.doesNotMatch(component, /Your administrator session expired or is not authorised/);
});

test('finalisation failures keep the uploaded Media bound for retry and do not weaken server checks', () => {
  const component = fs.readFileSync(componentPath, 'utf8');
  const importer = fs.readFileSync(path.join(root, 'server', 'services', 'ashley-wilde-import.js'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'server', 'routes', 'index.js'), 'utf8');
  assert.match(component, /phase: 'retryable_finalisation_failure', mediaRecord: media, mediaId: media\.id/);
  assert.match(importer, /verifyAnalysisToken\(body\?\.analysisToken/);
  assert.match(importer, /validateAshleyMedia/);
  assert.match(routes, /ashleyWildeFinalise[\s\S]*admin::isAuthenticatedAdmin/);
});
