'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { startStrapiTestApp } = require('./helpers/strapi-app');
const surface = require('../src/catalog/catalog-mutation-surface');
const uploadConfig = require('../src/catalog/catalog-upload-config');
const adminCatalogRoutes = require('../src/plugins/order-management/shared/routes');

let server;

const ADMIN_ONLY_CATALOG_READS = new Set([
  'mechanism-finishes',
  'made-to-measure-configurations',
]);

before(async () => { server = await startStrapiTestApp(); });
after(async () => { if (server) await server.stop(); });

function concrete(path) {
  return path
    .replace(':model', encodeURIComponent('api::fabric.fabric'))
    .replace(':sourceId', 'missing-source-document-id')
    .replace(':id', 'missing-document-id');
}

async function jsonRequest(path, method = 'GET', authorization, data = {}) {
  const headers = { 'content-type': 'application/json' };
  if (authorization !== undefined) headers.authorization = authorization;
  const init = { method, headers };
  if (!['GET', 'HEAD'].includes(method)) init.body = JSON.stringify(data);
  return fetch(`${server.baseUrl}${path}`, init);
}

async function catalogCounts() {
  const counts = {};
  for (const entity of surface.CATALOG_ENTITIES) {
    counts[entity.uid] = await server.app.db.query(entity.uid).count();
  }
  counts.uploads = await server.app.db.query('plugin::upload.file').count();
  return counts;
}

async function capturedMultipart(path, authorization, form, fileSizes) {
  const request = new Request(`${server.baseUrl}${path}`, {
    method: 'POST',
    headers: { authorization },
    body: form,
  });
  const payloadBytes = (await request.clone().arrayBuffer()).byteLength;
  const response = await fetch(request);
  const body = await response.text();
  return {
    fileCount: fileSizes.length,
    fileSizes,
    totalFileBytes: fileSizes.reduce((total, size) => total + size, 0),
    payloadBytes,
    status: response.status,
    contentType: response.headers.get('content-type'),
    body,
  };
}

test('initialized Strapi router contains the complete protected mutation matrix', () => {
  const allRegistered = server.app.server.listRoutes().flatMap(layer =>
    (layer.methods || []).map(method => ({ method, path: layer.path }))
  );
  const registered = allRegistered.filter(route => surface.MUTATION_METHODS.includes(route.method));
  const catalogCollections = new Set(surface.CATALOG_ENTITIES.map(entity => `/api/${entity.collection}`));
  const intentionallyReadOnlyPosts = new Set([
    '/api/order-management/export',
    '/order-management/export',
    '/order-management/parse-pdf',
  ]);
  const nonCatalogUploadMutations = new Set([
    'POST /upload/folders',
    'PUT /upload/folders/:id',
    'PUT /upload/configuration',
    'PUT /upload/settings',
  ]);

  for (const expected of surface.expectedContentApiMutations()) {
    assert.ok(
      registered.some(route => route.method === expected.method && route.path === expected.path),
      `missing initialized route ${expected.method} ${expected.path}`
    );
    assert.ok(surface.matchCatalogMutation(expected.method, concrete(expected.path)));
  }

  for (const expected of surface.CUSTOM_MUTATIONS) {
    assert.ok(
      registered.some(route => route.method === expected.method && route.path === expected.path),
      `missing initialized custom route ${expected.method} ${expected.path}`
    );
  }

  for (const expected of surface.UPLOAD_MUTATIONS) {
    assert.ok(
      registered.some(route => route.method === expected.method && route.path === expected.path),
      `missing initialized upload route ${expected.method} ${expected.path}`
    );
    assert.ok(surface.matchCatalogMutation(expected.method, concrete(expected.path)));
  }

  for (const route of registered) {
    const isCatalogContentApi = [...catalogCollections].some(prefix => route.path === prefix || route.path.startsWith(`${prefix}/`));
    const isOrderManagementPost = route.method === 'POST' && (
      route.path.startsWith('/api/order-management/') || route.path.startsWith('/order-management/')
    );
    const isUploadMutation = (route.path === '/api/upload' || route.path.startsWith('/api/upload/') ||
      route.path === '/upload' || route.path.startsWith('/upload/')) &&
      !nonCatalogUploadMutations.has(`${route.method} ${route.path}`);
    if (isCatalogContentApi || isUploadMutation || (isOrderManagementPost && !intentionallyReadOnlyPosts.has(route.path))) {
      assert.ok(
        surface.matchCatalogMutation(route.method, concrete(route.path)),
        `initialized catalog mutation is outside the protected surface: ${route.method} ${route.path}`
      );
    }
  }

  const contentManagerMutations = registered.filter(route =>
    route.path.startsWith('/content-manager/collection-types/:model')
  );
  assert.ok(contentManagerMutations.length > 0, 'content-manager collection mutation routes were not initialized');
  for (const route of contentManagerMutations) {
    for (const entity of surface.CATALOG_ENTITIES) {
      const path = route.path.replace(':model', encodeURIComponent(entity.uid)).replace(':id', 'document-id');
      assert.ok(surface.matchCatalogMutation(route.method, path), `${route.method} ${path}`);
    }
  }

  const plugin = server.app.plugin('order-management');
  assert.ok(plugin.controllers['import-export'].bulkImageUpload);
  assert.ok(registered.some(route => route.method === 'POST' && route.path === adminCatalogRoutes.bulkImageUpload));
  for (const expected of [
    { method: 'POST', path: adminCatalogRoutes.ashleyWildeAnalyse },
    { method: 'POST', path: adminCatalogRoutes.ashleyWildeFinalise },
    { method: 'GET', path: adminCatalogRoutes.ashleyWildeHistory },
    { method: 'GET', path: adminCatalogRoutes.ashleyWildeMode },
  ]) {
    assert.ok(
      allRegistered.some(route => route.method === expected.method && route.path === expected.path),
      `missing initialized Ashley Wilde admin route ${expected.method} ${expected.path}`
    );
  }
  for (const routePath of [
    adminCatalogRoutes.ashleyWildeAnalyse,
    adminCatalogRoutes.ashleyWildeFinalise,
    adminCatalogRoutes.ashleyWildeHistory,
    adminCatalogRoutes.ashleyWildeMode,
  ]) {
    const route = plugin.routes.find(item => item.path === routePath.replace(adminCatalogRoutes.base, ''));
    assert.ok(route, `missing plugin route definition for ${routePath}`);
    assert.deepEqual(route.config.policies, ['admin::isAuthenticatedAdmin']);
    assert.notEqual(route.config.auth, false);
  }
});

test('required public catalog reads remain reachable', async () => {
  for (const entity of surface.CATALOG_ENTITIES.filter(entity => !ADMIN_ONLY_CATALOG_READS.has(entity.collection))) {
    const response = await jsonRequest(`/api/${entity.collection}`);
    assert.equal(response.status, 200, `GET /api/${entity.collection}`);
  }
});

test('mechanism finishes and MTM configurations are admin-only direct reads', async () => {
  for (const collection of ADMIN_ONLY_CATALOG_READS) {
    const anonymous = await jsonRequest(`/api/${collection}`);
    assert.equal(anonymous.status, 403, `anonymous GET /api/${collection}`);

    const customer = await jsonRequest(`/api/${collection}`, 'GET', `Bearer ${server.customerToken}`);
    assert.equal(customer.status, 403, `customer GET /api/${collection}`);

    const internal = await jsonRequest(`/api/${collection}`, 'GET', `Bearer ${server.internalToken}`);
    assert.equal(internal.status, 200, await internal.clone().text());

    const admin = await jsonRequest(`/api/${collection}`, 'GET', `Bearer ${server.adminToken}`);
    assert.equal(admin.status, 200, await admin.clone().text());
  }

  const publicOptions = await jsonRequest('/api/storefront/configurator-options');
  assert.equal(publicOptions.status, 200, await publicOptions.clone().text());
});

test('order-management export and relation data are protected from public access', async () => {
  const routes = [
    { method: 'POST', path: '/api/order-management/export', body: {} },
    { method: 'POST', path: '/order-management/export', body: {} },
    { method: 'GET', path: '/api/order-management/relation-data' },
    { method: 'GET', path: '/order-management/relation-data' },
  ];
  const untrustedCredentials = [
    undefined,
    `Bearer ${server.customerToken}`,
    `Bearer ${server.forgedAdminToken}`,
    'Bearer wrong-internal-token',
  ];

  for (const route of routes) {
    for (const credential of untrustedCredentials) {
      const response = await jsonRequest(route.path, route.method, credential, route.body || {});
      assert.ok([401, 403].includes(response.status), `${route.method} ${route.path} credential ${credential || 'anonymous'}`);
    }

    const authorized = await jsonRequest(route.path, route.method, `Bearer ${server.internalToken}`, route.body || {});
    assert.equal(authorized.status, 200, `${route.method} ${route.path}: ${await authorized.clone().text()}`);
  }
});

test('folder history and analysis are private to genuine Strapi administrators', async () => {
  for (const credential of [
    undefined,
    `Bearer ${server.customerToken}`,
    `Bearer ${server.forgedAdminToken}`,
    `Bearer ${server.internalToken}`,
    'Bearer wrong-ashley-wilde-token',
  ]) {
    const history = await jsonRequest(adminCatalogRoutes.ashleyWildeHistory, 'GET', credential);
    assert.equal(history.status, 401, `history credential ${credential || 'anonymous'}`);
  }
  const adminHistory = await jsonRequest(adminCatalogRoutes.ashleyWildeHistory, 'GET', `Bearer ${server.adminToken}`);
  assert.equal(adminHistory.status, 200, await adminHistory.clone().text());
  assert.deepEqual((await adminHistory.json()).data, []);

  const importer = require('../src/plugins/order-management/server/services/ashley-wilde-import');
  const baseHistory = {
    supplier: 'Ashley Wilde', totalFiles: 3, matchedFiles: 2, uploadedFiles: 1,
    alreadyCompleteFiles: 0, skippedFiles: 1, conflictFiles: 0, failedFiles: 0,
    mappingSchemaVersion: 1, manifestSummary: {}, incrementAttempt: true,
  };
  await importer.upsertHistory(server.app, {
    ...baseHistory, folderName: 'Completed', folderFingerprint: 'a'.repeat(64), status: 'completed', lastUploadedAt: '2026-07-17T10:00:00.000Z',
  });
  await importer.upsertHistory(server.app, {
    ...baseHistory, folderName: 'Partial', folderFingerprint: 'b'.repeat(64), status: 'partial', conflictFiles: 1, lastUploadedAt: '2026-07-18T10:00:00.000Z',
  });
  await importer.upsertHistory(server.app, {
    ...baseHistory, folderName: 'Failed', folderFingerprint: 'c'.repeat(64), status: 'failed', failedFiles: 2, lastUploadedAt: '2026-07-19T10:00:00.000Z',
  });
  await importer.upsertHistory(server.app, {
    ...baseHistory, folderName: 'Completed', folderFingerprint: 'a'.repeat(64), status: 'completed', lastUploadedAt: '2026-07-17T10:00:00.000Z',
  });
  const persisted = await jsonRequest(adminCatalogRoutes.ashleyWildeHistory, 'GET', `Bearer ${server.adminToken}`);
  const persistedRows = (await persisted.json()).data;
  assert.deepEqual(persistedRows.map((item) => item.status), ['failed', 'partial', 'completed']);
  assert.equal(persistedRows.find((item) => item.folderName === 'Completed').manifestSummary.attemptCount, 2);

  const anonymousAnalysis = await jsonRequest(adminCatalogRoutes.ashleyWildeAnalyse, 'POST', undefined, {});
  assert.equal(anonymousAnalysis.status, 401);
  for (const credential of [
    `Bearer ${server.customerToken}`,
    `Bearer ${server.forgedAdminToken}`,
    `Bearer ${server.internalToken}`,
    'Bearer wrong-ashley-wilde-token',
  ]) {
    const rejectedAnalysis = await jsonRequest(adminCatalogRoutes.ashleyWildeAnalyse, 'POST', credential, {});
    assert.equal(rejectedAnalysis.status, 401, `analysis credential ${credential}`);
  }
  const adminAnalysis = await jsonRequest(adminCatalogRoutes.ashleyWildeAnalyse, 'POST', `Bearer ${server.adminToken}`, {});
  assert.equal(adminAnalysis.status, 400);
  const adminMode = await jsonRequest(adminCatalogRoutes.ashleyWildeMode, 'GET', `Bearer ${server.adminToken}`);
  assert.equal(adminMode.status, 200, await adminMode.clone().text());
});

test('every catalog CRUD mutation rejects anonymous, customer, forged admin, malformed and wrong credentials pre-body', async () => {
  const beforeCounts = await catalogCounts();
  const bodyBefore = server.counters.body;
  const controllersBefore = server.counters.controllers;
  const credentials = [
    undefined,
    `Bearer ${server.customerToken}`,
    `Bearer ${server.forgedAdminToken}`,
    'Bearer wrong-internal-token',
    'Bearer ',
    'not-a-bearer-token',
  ];

  for (const route of surface.expectedContentApiMutations()) {
    for (const credential of credentials) {
      const response = await jsonRequest(concrete(route.path), route.method, credential, { data: { price_per_metre: 999999 } });
      assert.equal(response.status, 401, `${route.method} ${route.path} ${credential || 'anonymous'}`);
    }
  }

  for (const route of surface.CUSTOM_MUTATIONS) {
    for (const credential of credentials) {
      const response = await jsonRequest(route.path, route.method, credential, { data: {} });
      assert.equal(response.status, 401, `${route.method} ${route.path} ${credential || 'anonymous'}`);
    }
  }


  for (const route of surface.UPLOAD_MUTATIONS) {
    for (const credential of credentials) {
      const response = await jsonRequest(concrete(route.path), route.method, credential, { data: {} });
      assert.equal(response.status, 401, `${route.method} ${route.path} ${credential || 'anonymous'}`);
    }
  }

  assert.equal(server.counters.body, bodyBefore);
  assert.equal(server.counters.controllers, controllersBefore);
  assert.deepEqual(await catalogCounts(), beforeCounts);
});

test('initialized content-manager catalog actions reject before body parsing and mutation', async () => {
  const routes = server.app.server.listRoutes().flatMap(layer =>
    (layer.methods || [])
      .filter(method => surface.MUTATION_METHODS.includes(method))
      .filter(() => layer.path.startsWith('/content-manager/collection-types/:model'))
      .map(method => ({ method, path: layer.path }))
  );
  assert.ok(routes.length > 0);

  const beforeCounts = await catalogCounts();
  const bodyBefore = server.counters.body;
  const controllersBefore = server.counters.controllers;

  for (const entity of surface.CATALOG_ENTITIES) {
    for (const route of routes) {
      const path = route.path
        .replace(':model', encodeURIComponent(entity.uid))
        .replace(':sourceId', 'missing-source-document-id')
        .replace(':id', 'missing-document-id');
      for (const credential of [undefined, `Bearer ${server.customerToken}`]) {
        const response = await jsonRequest(path, route.method, credential, { data: {} });
        assert.equal(response.status, 401, `${route.method} ${path} ${credential || 'anonymous'}`);
      }
    }
  }

  assert.equal(server.counters.body, bodyBefore);
  assert.equal(server.counters.controllers, controllersBefore);
  assert.deepEqual(await catalogCounts(), beforeCounts);
});

test('internal and genuine admin credentials mutate intended routes while field allowlists reject unknown fields', async () => {
  const fabricCreate = await jsonRequest('/api/fabrics', 'POST', `Bearer ${server.internalToken}`, {
    data: {
      name: 'Authorization Fabric', productId: 'AUTH-FABRIC', slug: 'auth-fabric', pattern: 'Plain',
      composition: 'Cotton', patternRepeat_cm: 0, usableWidth_cm: 140, availability: 'in_stock',
      price_per_metre: 25, is_featured: false, is_curtain: true, is_blind: true, is_cushion: true,
    },
  });
  const fabricPayload = await fabricCreate.json();
  assert.equal(fabricCreate.status, 201, JSON.stringify(fabricPayload));
  const fabric = fabricPayload.data;

  const adminCreate = await jsonRequest('/api/linings', 'POST', `Bearer ${server.adminToken}`, {
    data: { liningType: 'Admin Lining', colour: 'Ivory', price_per_metre: 12 },
  });
  const adminCreatePayload = await adminCreate.json();
  assert.equal(adminCreate.status, 201, JSON.stringify(adminCreatePayload));

  const rejectedField = await jsonRequest(`/api/fabrics/${fabric.documentId}`, 'PUT', `Bearer ${server.internalToken}`, {
    data: { price_per_metre: 30, forged_admin_override: true },
  });
  assert.equal(rejectedField.status, 400);
  const unchanged = await server.app.documents('api::fabric.fabric').findOne({ documentId: fabric.documentId });
  assert.equal(Number(unchanged.price_per_metre), 25);

  const update = await jsonRequest(`/api/fabrics/${fabric.documentId}`, 'PUT', `Bearer ${server.adminToken}`, {
    data: { price_per_metre: 30 },
  });
  const updatePayload = await update.json();
  assert.equal(update.status, 200, JSON.stringify(updatePayload));
  const changed = await server.app.documents('api::fabric.fabric').findOne({ documentId: fabric.documentId });
  assert.equal(Number(changed.price_per_metre), 30);
});

test('registered import routes accept their intended genuine admin and internal callers', async () => {
  const adminImport = await jsonRequest(
    adminCatalogRoutes.import,
    'POST',
    `Bearer ${server.adminToken}`,
    { data: {} }
  );
  assert.equal(adminImport.status, 200, await adminImport.text());

  const internalImport = await jsonRequest(
    '/api/order-management/import',
    'POST',
    `Bearer ${server.internalToken}`,
    { data: {} }
  );
  assert.equal(internalImport.status, 200, await internalImport.text());
});

test('unauthorized multipart is rejected before body parsing and authorized upload limits come from production config', async () => {
  const beforeCounts = await catalogCounts();
  const bodyBefore = server.counters.body;
  const controllersBefore = server.counters.controllers;

  for (const path of [adminCatalogRoutes.bulkImageUpload, '/api/upload', '/upload']) {
    for (const credential of [undefined, `Bearer ${server.customerToken}`]) {
      const form = new FormData();
      form.append('files', new Blob([Buffer.from('not parsed')], { type: 'image/png' }), 'blocked.png');
      const response = await fetch(`${server.baseUrl}${path}`, {
        method: 'POST', headers: credential ? { authorization: credential } : {}, body: form,
      });
      assert.equal(response.status, 401, `POST ${path}`);
    }
  }
  assert.equal(server.counters.body, bodyBefore);
  assert.equal(server.counters.controllers, controllersBefore);
  assert.deepEqual(await catalogCounts(), beforeCounts);

  const tooMany = new FormData();
  for (let index = 0; index < uploadConfig.maxFileCount + 1; index += 1) {
    tooMany.append('files', new Blob([Buffer.from([index])], { type: 'image/png' }), `limit-${index}.png`);
  }
  const tooManyResponse = await fetch(`${server.baseUrl}${adminCatalogRoutes.bulkImageUpload}`, {
    method: 'POST', headers: { authorization: `Bearer ${server.adminToken}` }, body: tooMany,
  });
  assert.equal(tooManyResponse.status, 413);
  assert.deepEqual(await catalogCounts(), beforeCounts);

  const oversizedFile = new FormData();
  oversizedFile.append(
    'files',
    new Blob([Buffer.alloc(uploadConfig.maxFileSize + 1)], { type: 'image/png' }),
    'oversized.png'
  );
  const oversizedResponse = await fetch(`${server.baseUrl}${adminCatalogRoutes.bulkImageUpload}`, {
    method: 'POST', headers: { authorization: `Bearer ${server.adminToken}` }, body: oversizedFile,
  });
  assert.equal(oversizedResponse.status, 413);
  assert.deepEqual(await catalogCounts(), beforeCounts);

  const aggregateUpload = new FormData();
  const aggregatePartSize = Math.floor(uploadConfig.maxTotalSize / 3) + 1;
  assert.ok(aggregatePartSize < uploadConfig.maxFileSize);
  const aggregatePart = new Blob([Buffer.alloc(aggregatePartSize)], { type: 'image/png' });
  for (let index = 0; index < 3; index += 1) {
    aggregateUpload.append('files', aggregatePart, `aggregate-${index}.png`);
  }
  const aggregateResponse = await fetch(`${server.baseUrl}${adminCatalogRoutes.bulkImageUpload}`, {
    method: 'POST', headers: { authorization: `Bearer ${server.adminToken}` }, body: aggregateUpload,
  });
  assert.equal(aggregateResponse.status, 413);
  assert.deepEqual(await catalogCounts(), beforeCounts);
});

test('genuine admin reaches the exact registered bulk uploader controller without an internal token', async () => {
  const onePixelPng = fs.readFileSync(path.join(process.cwd(), 'favicon.png'));
  const form = new FormData();
  form.append('files', new Blob([onePixelPng], { type: 'image/png' }), 'AUTH-FABRIC.png');
  form.append('productType', 'fabrics');
  form.append('matchBy', 'productId');
  form.append('createAsColour', 'false');
  const controllersBefore = server.counters.controllers;

  const response = await fetch(`${server.baseUrl}${adminCatalogRoutes.bulkImageUpload}`, {
    method: 'POST', headers: { authorization: `Bearer ${server.adminToken}` }, body: form,
  });
  const payload = await response.json();
  assert.match(response.headers.get('content-type') || '', /^application\/json/);
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.ok(server.counters.controllers > controllersBefore);
  assert.equal(payload.success, true);
  assert.equal(payload.results.uploaded, 1);
});

test('bulk upload captures the small, oversized, and six-file limit boundaries safely', async () => {
  const onePixelPng = fs.readFileSync(path.join(process.cwd(), 'favicon.png'));
  const smallForm = new FormData();
  smallForm.append('files', new Blob([onePixelPng], { type: 'image/png' }), 'boundary-small.png');
  smallForm.append('productType', 'fabrics');
  smallForm.append('matchBy', 'productId');
  smallForm.append('createAsColour', 'false');
  const controllersBeforeSmall = server.counters.controllers;
  const small = await capturedMultipart(
    adminCatalogRoutes.bulkImageUpload,
    `Bearer ${server.adminToken}`,
    smallForm,
    [onePixelPng.length]
  );
  assert.equal(small.status, 200, small.body);
  assert.match(small.contentType || '', /^application\/json/);
  assert.ok(server.counters.controllers > controllersBeforeSmall);

  const largeSize = uploadConfig.maxFileSize + 1;
  const largeForm = new FormData();
  largeForm.append('files', new Blob([Buffer.alloc(largeSize)], { type: 'image/png' }), 'boundary-large.png');
  const controllersBeforeLarge = server.counters.controllers;
  const large = await capturedMultipart(
    adminCatalogRoutes.bulkImageUpload,
    `Bearer ${server.adminToken}`,
    largeForm,
    [largeSize]
  );
  assert.equal(large.status, 413, large.body);
  assert.match(large.contentType || '', /^application\/json/);
  assert.deepEqual(JSON.parse(large.body), { error: 'The server rejected this upload because the request was too large.' });
  assert.equal(server.counters.controllers, controllersBeforeLarge);

  const sixPartSize = Math.floor(uploadConfig.maxTotalSize / 6) + 1;
  const sixForm = new FormData();
  for (let index = 0; index < 6; index += 1) {
    sixForm.append('files', new Blob([Buffer.alloc(sixPartSize)], { type: 'image/png' }), `boundary-six-${index}.png`);
  }
  const controllersBeforeSix = server.counters.controllers;
  const six = await capturedMultipart(
    adminCatalogRoutes.bulkImageUpload,
    `Bearer ${server.adminToken}`,
    sixForm,
    Array.from({ length: 6 }, () => sixPartSize)
  );
  assert.equal(six.status, 413, six.body);
  assert.match(six.contentType || '', /^application\/json/);
  assert.deepEqual(JSON.parse(six.body), { error: 'The server rejected this upload because the request was too large.' });
  assert.equal(server.counters.controllers, controllersBeforeSix);
});

test('initialized abandonment route is server-only and accepts no client-selected state', async () => {
  const orderNumber = `ORD-ABANDON-${process.pid}`;
  const createdOrder = await server.app.db.query('api::order.order').create({
    data: {
      orderNumber,
      customerName: 'Abandonment Test',
      customerEmail: 'abandonment@example.test',
      shippingAddress: '{}',
      postcode: 'TEST',
      billingAddress: '{}',
      subtotal: 10,
      shipping: 0,
      total: 10,
      orderItems: [],
      paymentStatus: 'pending',
      statusOrder: 'pending',
    },
  });

  const route = server.app.server.listRoutes().find(layer =>
    layer.path === '/api/order-abandonment/transition' && layer.methods?.includes('POST')
  );
  assert.ok(route, 'production abandonment route was not initialized');

  const body = { orderNumber };
  for (const credential of [
    undefined,
    `Bearer ${server.customerToken}`,
    'Bearer wrong-abandonment-token',
    `Bearer ${server.adminToken}`,
  ]) {
    const response = await jsonRequest('/api/order-abandonment/transition', 'POST', credential, body);
    assert.equal(response.status, 401, credential || 'anonymous');
  }

  const arbitrary = await jsonRequest(
    '/api/order-abandonment/transition',
    'POST',
    `Bearer ${server.abandonmentToken}`,
    { orderNumber, paymentStatus: 'paid', statusOrder: 'delivered' }
  );
  assert.equal(arbitrary.status, 400);

  const genericPut = await jsonRequest(
    `/api/orders/${createdOrder.documentId}`,
    'PUT',
    `Bearer ${server.internalToken}`,
    { data: { paymentStatus: 'paid', statusOrder: 'delivered' } }
  );
  assert.equal(genericPut.status, 400);
  const afterGenericPut = await server.app.db.query('api::order.order').findOne({ where: { orderNumber } });
  assert.equal(afterGenericPut.paymentStatus, 'pending');
  assert.equal(afterGenericPut.statusOrder, 'pending');

  const transition = await jsonRequest(
    '/api/order-abandonment/transition',
    'POST',
    `Bearer ${server.abandonmentToken}`,
    body
  );
  assert.equal(transition.status, 200, await transition.clone().text());
  assert.deepEqual(await transition.json(), { result: 'transitioned' });

  const stored = await server.app.db.query('api::order.order').findOne({ where: { orderNumber } });
  assert.equal(stored.paymentStatus, 'failed');
  assert.equal(stored.statusOrder, 'cancelled');
});
