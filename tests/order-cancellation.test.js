'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const knexFactory = require('knex');
const { createCancellationStore } = require('../src/api/order/services/cancellation');
const routes = require('../dist/src/api/order/routes/order-cancellation').default;
const cancellationPolicy = require('../dist/src/policies/checkout-cancellation-auth').default;

const SESSION = 'cs_test_authoritative_session_123';

async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'checkout-cancel-'));
  const knex = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: path.join(directory, 'orders.db') },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });
  t.after(async () => {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await knex.schema.createTable('orders', table => {
    table.increments('id').primary();
    table.string('order_number');
    table.string('status_order').nullable();
    table.string('payment_status').nullable();
    table.string('stripe_session_id').nullable();
    table.datetime('updated_at').nullable();
  });
  await knex.schema.createTable('orders_user_lnk', table => {
    table.increments('id').primary();
    table.integer('order_id').notNullable();
    table.integer('user_id').notNullable();
  });
  return { knex, store: createCancellationStore(knex, options) };
}

async function insertOrder(knex, overrides = {}) {
  const [id] = await knex('orders').insert({
    order_number: 'ORD-AUTHORIZED',
    status_order: 'pending',
    payment_status: 'pending',
    stripe_session_id: SESSION,
    ...overrides,
  });
  await knex('orders_user_lnk').insert({ order_id: id, user_id: 7 });
  return id;
}

test('eligible token-bound cancellation transitions exactly once and is authorized-idempotent', async t => {
  const { knex, store } = await fixture(t);
  await insertOrder(knex);
  assert.deepEqual(await store.transition({ orderNumber: 'ORD-AUTHORIZED', stripeSessionId: SESSION }), { result: 'cancelled' });
  assert.deepEqual(await store.transition({ orderNumber: 'ORD-AUTHORIZED', stripeSessionId: SESSION }), { result: 'already_cancelled' });
  const order = await knex('orders').first();
  assert.equal(order.status_order, 'cancelled');
  assert.equal(order.payment_status, 'pending');
});

test('stored session must be present, well formed, and exactly match the token session', async t => {
  const { knex, store } = await fixture(t);
  for (const [orderNumber, stripeSessionId] of [
    ['ORD-MISSING', null],
    ['ORD-EMPTY', ''],
    ['ORD-MALFORMED', 'not-a-checkout-session'],
    ['ORD-DIFFERENT', 'cs_test_different_session_456'],
  ]) await insertOrder(knex, { order_number: orderNumber, stripe_session_id: stripeSessionId });

  for (const orderNumber of ['ORD-MISSING', 'ORD-EMPTY', 'ORD-MALFORMED', 'ORD-DIFFERENT']) {
    assert.deepEqual(await store.transition({ orderNumber, stripeSessionId: SESSION }), { result: 'not_found' });
  }
  assert.equal(await knex('orders').where({ status_order: 'cancelled' }).count({ count: '*' }).first().then(row => Number(row.count)), 0);
});

test('missing, unknown, paid, and fulfilment-stage state is never eligible', async t => {
  const { knex, store } = await fixture(t);
  const states = [
    ['ORD-NO-PAYMENT', { payment_status: null }],
    ['ORD-NO-WORKFLOW', { status_order: null }],
    ['ORD-UNKNOWN', { payment_status: 'unknown' }],
    ['ORD-PAID', { payment_status: 'paid' }],
    ['ORD-PROCESSING', { status_order: 'processing' }],
    ['ORD-SHIPPED', { status_order: 'shipped' }],
    ['ORD-DELIVERED', { status_order: 'delivered' }],
    ['ORD-REFUNDED', { payment_status: 'refunded' }],
  ];
  for (const [orderNumber, state] of states) await insertOrder(knex, { order_number: orderNumber, ...state });
  for (const [orderNumber] of states) {
    assert.deepEqual(await store.transition({ orderNumber, stripeSessionId: SESSION }), { result: 'not_eligible' });
  }
});

test('authenticated-owner transition rechecks the authoritative owner inside the transaction', async t => {
  const { knex, store } = await fixture(t);
  await insertOrder(knex);
  assert.deepEqual(await store.transition({ orderNumber: 'ORD-AUTHORIZED', ownerId: 99 }), { result: 'not_found' });
  assert.deepEqual(await store.transition({ orderNumber: 'ORD-AUTHORIZED', ownerId: 7 }), { result: 'cancelled' });
});

test('conditional update loses safely when payment changes after eligibility was read', async t => {
  const { knex, store } = await fixture(t, {
    beforeConditionalUpdate: async (trx, order) => {
      await trx('orders').where({ id: order.id }).update({ payment_status: 'paid' });
    },
  });
  await insertOrder(knex);
  assert.deepEqual(await store.transition({ orderNumber: 'ORD-AUTHORIZED', stripeSessionId: SESSION }), { result: 'not_eligible' });
  const order = await knex('orders').first();
  assert.equal(order.payment_status, 'paid');
  assert.equal(order.status_order, 'pending');
});

test('two concurrent cancellations perform at most one transition', async t => {
  const { knex, store } = await fixture(t);
  await insertOrder(knex);
  const results = await Promise.all([
    store.transition({ orderNumber: 'ORD-AUTHORIZED', stripeSessionId: SESSION }),
    store.transition({ orderNumber: 'ORD-AUTHORIZED', stripeSessionId: SESSION }),
  ]);
  assert.deepEqual(results.map(value => value.result).sort(), ['already_cancelled', 'cancelled']);
  assert.equal((await knex('orders').first()).status_order, 'cancelled');
});

test('ambiguous order identity fails closed with no mutation', async t => {
  const { knex, store } = await fixture(t);
  await insertOrder(knex);
  await insertOrder(knex);
  assert.deepEqual(await store.transition({ orderNumber: 'ORD-AUTHORIZED', stripeSessionId: SESSION }), { result: 'not_found' });
  assert.equal(await knex('orders').where({ status_order: 'pending' }).count({ count: '*' }).first().then(row => Number(row.count)), 2);
});

test('internal route is credential-protected and the policy fails closed', async () => {
  assert.equal(routes.routes.length, 1);
  assert.equal(routes.routes[0].path, '/order-cancellation/transition');
  assert.deepEqual(routes.routes[0].config.policies, ['global::checkout-cancellation-auth']);

  const previous = process.env.CHECKOUT_CANCELLATION_SECRET;
  process.env.CHECKOUT_CANCELLATION_SECRET = 'cancellation-server-only-secret';
  try {
    await assert.rejects(() => cancellationPolicy({ request: { headers: {} } }));
    await assert.rejects(() => cancellationPolicy({ request: { headers: { authorization: 'Bearer normal-user-jwt' } } }));
    assert.equal(await cancellationPolicy({ request: { headers: { authorization: 'Bearer cancellation-server-only-secret' } } }), true);
  } finally {
    if (previous === undefined) delete process.env.CHECKOUT_CANCELLATION_SECRET;
    else process.env.CHECKOUT_CANCELLATION_SECRET = previous;
  }
});
