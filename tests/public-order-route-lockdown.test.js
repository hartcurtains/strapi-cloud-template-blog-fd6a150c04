'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const policy = require('../dist/src/policies/server-internal-auth');

const routeSource = fs.readFileSync(
  path.join(__dirname, '../src/api/order/routes/order.ts'),
  'utf8'
);
const controllerSource = fs.readFileSync(
  path.join(__dirname, '../src/api/order/controllers/order.ts'),
  'utf8'
);

test('generic order routes require the server credential and expose no hard-delete route', async () => {
  assert.equal((routeSource.match(/auth: false/g) || []).length, 4);
  assert.equal((routeSource.match(/global::server-internal-auth/g) || []).length, 4);
  assert.doesNotMatch(routeSource, /method:\s*['"]DELETE['"]/);
  assert.doesNotMatch(controllerSource, /LOOSE MODE/);
  assert.match(controllerSource, /allowedFields/);
  assert.match(controllerSource, /Protected order fields cannot be set during creation/);
  assert.match(controllerSource, /Payment and workflow fields require a protected transition/);
});

test('internal policy rejects anonymous, customer and wrong credentials before controller work', async () => {
  const previous = process.env.STRAPI_API_TOKEN;
  process.env.STRAPI_API_TOKEN = 'server-only-order-token';
  try {
    assert.equal(await policy({ request: { headers: {} }, state: {} }), false);
    assert.equal(await policy({ request: { headers: { authorization: 'Bearer customer-jwt' } }, state: { user: { role: { type: 'authenticated' } } } }), false);
    assert.equal(await policy({ request: { headers: { authorization: 'Bearer wrong-token' } }, state: {} }), false);
    assert.equal(await policy({ request: { headers: { authorization: 'Bearer server-only-order-token' } }, state: {} }), true);
    assert.equal(await policy({ request: { headers: {} }, state: { user: { role: { type: 'administrator' } } } }), false);
  } finally {
    if (previous === undefined) delete process.env.STRAPI_API_TOKEN;
    else process.env.STRAPI_API_TOKEN = previous;
  }
});
