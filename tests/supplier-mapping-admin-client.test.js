'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const clientSource = fs.readFileSync(path.join(process.cwd(), 'src', 'plugins', 'order-management', 'admin', 'src', 'utils', 'supplierMappingClient.js'), 'utf8');
const { ACTIVE_REFRESH_ERROR, safeAdminJsonRequest } = Function(`${clientSource.replace(/^export\s+/gm, '')}; return { ACTIVE_REFRESH_ERROR, safeAdminJsonRequest };`)();

const root = path.join(process.cwd(), 'src', 'plugins', 'order-management');
const pageSource = fs.readFileSync(path.join(root, 'admin', 'src', 'pages', 'SupplierColourMappingsPage.jsx'), 'utf8');
const routeSource = fs.readFileSync(path.join(root, 'server', 'routes', 'index.js'), 'utf8');
const pluginSource = fs.readFileSync(path.join(root, 'strapi-server.js'), 'utf8');
const routes = require(path.join(root, 'shared', 'routes.json'));

function response({ status = 200, contentType = 'application/json; charset=utf-8', body = '{}' }) {
  let jsonCalls = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return name.toLowerCase() === 'content-type' ? contentType : null; } },
    async json() { jsonCalls += 1; return JSON.parse(body); },
    async text() { return body; },
    get jsonCalls() { return jsonCalls; },
  };
}

function installBrowser(fetchImpl) {
  const previousWindow = global.window;
  const previousFetch = global.fetch;
  global.window = { strapi: { backendURL: 'https://catalog.example.test' }, localStorage: { getItem: () => null } };
  global.fetch = fetchImpl;
  return () => { global.window = previousWindow; global.fetch = previousFetch; };
}

test('activation success remains visible when active-version refresh returns JSON', async () => {
  assert.match(pageSource, /Mapping version activated\./);
  assert.match(pageSource, /try\s*\{\s*await refresh\(\);\s*\}\s*catch/);
  assert.equal(ACTIVE_REFRESH_ERROR, 'The mapping was activated, but the active version could not be refreshed.');
  assert.match(pageSource, /fallbackMessage:\s*ACTIVE_REFRESH_ERROR/);
});

test('post-activation refresh uses the registered plugin route and receives active JSON', async () => {
  const calls = [];
  const restore = installBrowser(async (url, options) => { calls.push({ url, options }); return response({ body: JSON.stringify({ success: true, data: { version: { supplier: 'Ashley Wilde', mappingCount: 562 }, rows: Array(562).fill({}) } }) }); });
  try {
    const result = await safeAdminJsonRequest(`${routes.supplierMappingsActive}?supplier=Ashley%20Wilde`, { fallbackMessage: ACTIVE_REFRESH_ERROR });
    assert.equal(result.data.version.mappingCount, 562);
    assert.equal(calls[0].url, `https://catalog.example.test${routes.supplierMappingsActive}?supplier=Ashley%20Wilde`);
    assert.equal(calls[0].options.method, 'GET');
  } finally { restore(); }
});

test('404 HTML is consumed as text and never passed to JSON.parse', async () => {
  const html = '<!DOCTYPE html><html><body>Not found</body></html>';
  const failingResponse = response({ status: 404, contentType: 'text/html; charset=utf-8', body: html });
  const restore = installBrowser(async () => failingResponse);
  try {
    await assert.rejects(() => safeAdminJsonRequest('/order-management/supplier-colour-mappings/active', { fallbackMessage: ACTIVE_REFRESH_ERROR }), (error) => error.message === ACTIVE_REFRESH_ERROR && failingResponse.jsonCalls === 0);
  } finally { restore(); }
});

test('redirected admin HTML produces a controlled error without displaying HTML', async () => {
  const failingResponse = response({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!DOCTYPE html><html><title>Strapi Admin</title></html>' });
  const restore = installBrowser(async () => failingResponse);
  try {
    await assert.rejects(() => safeAdminJsonRequest('/order-management/supplier-colour-mappings/active', { fallbackMessage: ACTIVE_REFRESH_ERROR }), (error) => error.message === ACTIVE_REFRESH_ERROR && !error.message.includes('<!DOCTYPE'));
  } finally { restore(); }
});

test('success message is not replaced by a secondary refresh error', () => {
  assert.match(pageSource, /setMessage\('Mapping version activated\.'\); setConfirm\(false\);\s*try/);
  assert.match(pageSource, /catch \(refreshError\) \{ setError\(errorMessage\(refreshError\)\); \}/);
});

test('active version refresh preserves the server-reported 562-row result', () => {
  assert.match(pageSource, /setActive\(payload\?\.data \|\| payload \|\| null\)/);
});

test('export active JSON uses the real API route and safe JSON response handling', () => {
  assert.match(pageSource, /safeAdminJsonRequest\(`\$\{adminCatalogRoutes\.supplierMappingsExport\}\?documentId=/);
  assert.match(routeSource, /method: 'GET',[\s\S]*?path: relativePath\(adminCatalogRoutes\.supplierMappingsExport\)[\s\S]*?handler: 'import-export\.exportSupplierMapping'/);
  assert.match(pageSource, /anchor\.download = `\$\{payload\.supplier \|\| 'supplier'\}-\$\{payload\.mappingVersion \|\| 'mapping'\}\.json`/);
});

test('retrying refresh does not invoke activation', () => {
  assert.equal((pageSource.match(/supplierMappingsApply/g) || []).length, 1);
  assert.equal((pageSource.match(/safeAdminJsonRequest\(/g) || []).length, 3);
});

test('route registration is present in the plugin server entry and does not use the API fallback path', () => {
  assert.match(pluginSource, /routes:\s*require\(['"]\.\/server\/routes['"]\)/);
  assert.match(routeSource, /path: relativePath\(adminCatalogRoutes\.supplierMappingsActive\)/);
  assert.equal(routes.supplierMappingsActive, '/order-management/supplier-colour-mappings/active');
  assert.equal(routes.supplierMappingsActive.startsWith('/api/'), false);
});

test('the existing catalogue mutation guard remains outside this refresh/export change', () => {
  assert.doesNotMatch(pageSource, /api::colour\.colour|api::fabric\.fabric|api::fabric-colour-asset/);
  assert.doesNotMatch(pageSource, /activateMapping|createMappingVersion/);
});
