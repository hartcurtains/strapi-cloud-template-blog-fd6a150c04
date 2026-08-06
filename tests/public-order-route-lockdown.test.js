'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { startStrapiTestApp } = require('./helpers/strapi-app');

const routeSource = fs.readFileSync(
  path.join(__dirname, '../src/api/order/routes/order.ts'),
  'utf8'
);
const controllerSource = fs.readFileSync(
  path.join(__dirname, '../src/api/order/controllers/order.ts'),
  'utf8'
);

let server;

before(async () => {
  process.env.CHECKOUT_CANCELLATION_SECRET = 'order-regression-cancellation-secret';
  process.env.STRIPE_WEBHOOK_LIFECYCLE_SECRET = 'order-regression-lifecycle-secret';
  server = await startStrapiTestApp();
});

after(async () => {
  if (server) await server.stop();
});

async function jsonRequest(pathname, method = 'GET', authorization, data) {
  const headers = { 'content-type': 'application/json' };
  if (authorization !== undefined) headers.authorization = authorization;
  const init = { method, headers };
  if (!['GET', 'HEAD'].includes(method)) init.body = JSON.stringify(data || {});
  return fetch(`${server.baseUrl}${pathname}`, init);
}

test('core Order routes retain normal Strapi API-token auth and no public CRUD', () => {
  assert.equal((routeSource.match(/auth:\s*false/g) || []).length, 0);
  assert.equal((routeSource.match(/global::server-internal-auth/g) || []).length, 0);
  assert.equal((routeSource.match(/config:\s*\{\s*\}/g) || []).length, 4);
  assert.doesNotMatch(routeSource, /method:\s*['"]DELETE['"]/);
  assert.doesNotMatch(controllerSource, /LOOSE MODE/);
  assert.match(controllerSource, /allowedFields/);
  assert.match(controllerSource, /Protected order fields cannot be set during creation/);
  assert.match(controllerSource, /Payment and workflow fields require a protected transition/);
});

test('Vercel-style Strapi API token can create, find, and update an Order', async () => {
  const orderNumber = `ORD-AUTH-${process.pid}`;
  const created = await jsonRequest('/api/orders', 'POST', `Bearer ${server.orderApiToken}`, {
    data: {
      orderNumber,
      customerName: 'Order Auth Regression',
      customerEmail: 'order-auth@example.test',
      shippingAddress: '{}',
      postcode: 'TEST',
      billingAddress: '{}',
      subtotal: 10,
      shipping: 0,
      total: 10,
      orderItems: [],
      notes: 'created through normal API-token auth',
    },
  });
  const createdPayload = await created.json();
  assert.ok([200, 201].includes(created.status), JSON.stringify(createdPayload));
  assert.ok(createdPayload.data.documentId);

  const found = await jsonRequest(`/api/orders/${createdPayload.data.documentId}`, 'GET', `Bearer ${server.orderApiToken}`);
  assert.equal(found.status, 200, await found.text());

  const updated = await jsonRequest(
    `/api/orders/${createdPayload.data.documentId}`,
    'PUT',
    `Bearer ${server.orderApiToken}`,
    { data: { notes: 'updated through normal API-token auth' } }
  );
  const updatedPayload = await updated.json();
  assert.equal(updated.status, 200, JSON.stringify(updatedPayload));
});

test('anonymous and customer callers cannot use public Order CRUD', async () => {
  const anonymousFind = await jsonRequest('/api/orders');
  assert.ok([401, 403].includes(anonymousFind.status), `anonymous GET returned ${anonymousFind.status}`);

  const anonymousCreate = await jsonRequest('/api/orders', 'POST', undefined, { data: { orderNumber: 'ORD-ANON' } });
  assert.ok([401, 403].includes(anonymousCreate.status), `anonymous POST returned ${anonymousCreate.status}`);

  const customerFind = await jsonRequest('/api/orders', 'GET', `Bearer ${server.customerToken}`);
  assert.ok([401, 403].includes(customerFind.status), `customer GET returned ${customerFind.status}`);

  const customerCreate = await jsonRequest('/api/orders', 'POST', `Bearer ${server.customerToken}`, {
    data: {
      orderNumber: 'ORD-CUSTOMER-DIRECT',
      customerName: 'Direct Customer',
      customerEmail: 'direct-customer@example.test',
      shippingAddress: '{}',
      postcode: 'TEST',
      billingAddress: '{}',
      subtotal: 1,
      shipping: 0,
      total: 1,
      orderItems: [],
    },
  });
  assert.ok([401, 403].includes(customerCreate.status), `customer POST returned ${customerCreate.status}`);
});

test('public callers cannot change payment status or Stripe identifiers', async () => {
  const orderNumber = `ORD-FIELDS-${process.pid}`;
  const created = await jsonRequest('/api/orders', 'POST', `Bearer ${server.orderApiToken}`, {
    data: {
      orderNumber,
      customerName: 'Protected Fields',
      customerEmail: 'protected@example.test',
      shippingAddress: '{}',
      postcode: 'TEST',
      billingAddress: '{}',
      subtotal: 1,
      shipping: 0,
      total: 1,
      orderItems: [],
    },
  });
  const createdPayload = await created.json();
  assert.ok([200, 201].includes(created.status), JSON.stringify(createdPayload));
  const orderId = createdPayload.data.documentId;

  const createProtected = await jsonRequest('/api/orders', 'POST', `Bearer ${server.orderApiToken}`, {
    data: { orderNumber: 'ORD-PROTECTED-CREATE', paymentStatus: 'paid', stripeSessionId: 'cs_test_forged' },
  });
  assert.equal(createProtected.status, 400);

  const updateProtected = await jsonRequest(`/api/orders/${orderId}`, 'PUT', `Bearer ${server.orderApiToken}`, {
    data: { paymentStatus: 'paid', stripeCustomerId: 'cus_forged', stripeSessionId: 'cs_test_forged' },
  });
  assert.equal(updateProtected.status, 400);

  const customerUpdate = await jsonRequest(`/api/orders/${orderId}`, 'PUT', `Bearer ${server.customerToken}`, {
    data: { paymentStatus: 'paid', stripeSessionId: 'cs_test_customer' },
  });
  assert.ok([401, 403].includes(customerUpdate.status));
});

test('dedicated cancellation, session-binding, payment, and webhook lifecycle routes reject missing or wrong secrets', async () => {
  const protectedRoutes = [
    '/api/order-cancellation/transition',
    '/api/order-session-binding/bind',
    '/api/order-payment/transition',
    '/api/stripe-webhook-processing/claim-event',
  ];

  for (const pathname of protectedRoutes) {
    const anonymous = await jsonRequest(pathname, 'POST', undefined, {});
    assert.equal(anonymous.status, 401, `${pathname} anonymous`);
    const wrong = await jsonRequest(pathname, 'POST', 'Bearer wrong-order-secret', {});
    assert.equal(wrong.status, 401, `${pathname} wrong secret`);
  }
});
