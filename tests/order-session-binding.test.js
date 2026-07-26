'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const knexFactory = require('knex');
const { createSessionBindingStore } = require('../src/api/order/services/session-binding');

const SESSION = 'cs_test_authoritative_session_123';

async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'session-binding-'));
  const knex = knexFactory({
    client: 'better-sqlite3', connection: { filename: path.join(directory, 'orders.db') },
    useNullAsDefault: true, pool: { min: 1, max: 1 },
  });
  t.after(async () => { await knex.destroy(); fs.rmSync(directory, { recursive: true, force: true }); });
  await knex.schema.createTable('orders', table => {
    table.increments('id').primary();
    table.string('order_number');
    table.string('status_order').nullable();
    table.string('payment_status').nullable();
    table.string('stripe_session_id').nullable();
    table.string('stripe_customer_id').nullable();
    table.datetime('updated_at').nullable();
  });
  return { knex, store: createSessionBindingStore(knex, options) };
}

async function insertOrder(knex, overrides = {}) {
  await knex('orders').insert({
    order_number: 'ORD-BIND', status_order: 'pending', payment_status: 'pending',
    stripe_session_id: null, stripe_customer_id: null, ...overrides,
  });
}

test('binds and confirms the Stripe-created Session and customer IDs; identical binding is idempotent', async t => {
  const { knex, store } = await fixture(t);
  await insertOrder(knex);
  assert.deepEqual(await store.bind({ orderNumber: 'ORD-BIND', stripeSessionId: SESSION, stripeCustomerId: 'cus_test_customer_123' }), { result: 'bound' });
  assert.equal((await knex('orders').first()).stripe_session_id, SESSION);
  assert.equal((await knex('orders').first()).stripe_customer_id, 'cus_test_customer_123');
  assert.equal((await knex('orders').first()).payment_status, 'pending');
  assert.deepEqual(await store.bind({ orderNumber: 'ORD-BIND', stripeSessionId: SESSION, stripeCustomerId: 'cus_test_customer_123' }), { result: 'already_bound' });
});

test('production-shaped pending order with null payment status is normalized during binding', async t => {
  const { knex, store } = await fixture(t);
  await insertOrder(knex, { payment_status: null });
  assert.deepEqual(await store.bind({ orderNumber: 'ORD-BIND', stripeSessionId: SESSION, stripeCustomerId: 'cus_test_customer_123' }), { result: 'bound' });
  assert.deepEqual(await knex('orders').first().select('payment_status', 'stripe_session_id', 'stripe_customer_id'), {
    payment_status: 'pending', stripe_session_id: SESSION, stripe_customer_id: 'cus_test_customer_123',
  });
});

test('a different existing Session ID conflicts and is never replaced', async t => {
  const { knex, store } = await fixture(t);
  await insertOrder(knex, { stripe_session_id: 'cs_test_original_session_456' });
  assert.deepEqual(await store.bind({ orderNumber: 'ORD-BIND', stripeSessionId: SESSION, stripeCustomerId: 'cus_test_customer_123' }), { result: 'conflict' });
  assert.equal((await knex('orders').first()).stripe_session_id, 'cs_test_original_session_456');
});

test('missing and ambiguous order identity fail closed', async t => {
  const { knex, store } = await fixture(t);
  assert.deepEqual(await store.bind({ orderNumber: 'ORD-MISSING', stripeSessionId: SESSION, stripeCustomerId: 'cus_test_customer_123' }), { result: 'not_found' });
  await insertOrder(knex);
  await insertOrder(knex);
  assert.deepEqual(await store.bind({ orderNumber: 'ORD-BIND', stripeSessionId: SESSION, stripeCustomerId: 'cus_test_customer_123' }), { result: 'not_found' });
  assert.equal(await knex('orders').whereNotNull('stripe_session_id').count({ count: '*' }).first().then(row => Number(row.count)), 0);
});

test('paid, cancelled, processing, and malformed states are ineligible', async t => {
  const { knex, store } = await fixture(t);
  const states = [
    ['ORD-PAID', { payment_status: 'paid' }],
    ['ORD-CANCELLED', { status_order: 'cancelled' }],
    ['ORD-PROCESSING', { status_order: 'processing' }],
    ['ORD-UNPAID-UNKNOWN', { payment_status: 'unknown' }],
  ];
  for (const [order_number, state] of states) await insertOrder(knex, { order_number, ...state });
  for (const [orderNumber] of states) {
    assert.deepEqual(await store.bind({ orderNumber, stripeSessionId: SESSION, stripeCustomerId: 'cus_test_customer_123' }), { result: 'not_eligible' });
  }
  assert.equal(await knex('orders').whereNotNull('stripe_session_id').count({ count: '*' }).first().then(row => Number(row.count)), 0);
});

test('conditional race recheck never attaches after the order becomes paid', async t => {
  const { knex, store } = await fixture(t, {
    beforeConditionalUpdate: async db => { await db('orders').where({ order_number: 'ORD-BIND' }).update({ payment_status: 'paid' }); },
  });
  await insertOrder(knex);
  assert.deepEqual(await store.bind({ orderNumber: 'ORD-BIND', stripeSessionId: SESSION, stripeCustomerId: 'cus_test_customer_123' }), { result: 'not_eligible' });
  assert.equal((await knex('orders').first()).stripe_session_id, null);
});

test('the protected route reuses the dedicated server credential policy', async () => {
  const routes = require('../dist/src/api/order/routes/order-session-binding').default;
  assert.equal(routes.routes.length, 1);
  assert.equal(routes.routes[0].path, '/order-session-binding/bind');
  assert.deepEqual(routes.routes[0].config.policies, ['global::checkout-cancellation-auth']);
});
