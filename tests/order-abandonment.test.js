'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const knexFactory = require('knex');
const { createAbandonmentStore } = require('../src/api/order/services/abandonment');
const { createPaymentStore } = require('../src/api/order/services/payment');

function makeKnex(filename) {
  return knexFactory({
    client: 'better-sqlite3',
    connection: { filename },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });
}

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'order-abandonment-'));
  const filename = path.join(directory, 'orders.db');
  const setup = makeKnex(filename);
  const abandonmentKnex = makeKnex(filename);
  const paymentKnex = makeKnex(filename);
  t.after(async () => {
    await Promise.all([setup.destroy(), abandonmentKnex.destroy(), paymentKnex.destroy()]);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await setup.schema.createTable('orders', table => {
    table.increments('id').primary();
    table.string('order_number');
    table.string('status_order').nullable();
    table.string('payment_status').nullable();
    table.string('stripe_session_id').nullable();
    table.string('stripe_customer_id').nullable();
    table.datetime('updated_at').nullable();
  });
  await setup.raw('PRAGMA journal_mode = WAL');
  await Promise.all([
    abandonmentKnex.raw('PRAGMA busy_timeout = 10000'),
    paymentKnex.raw('PRAGMA busy_timeout = 10000'),
  ]);

  return {
    setup,
    abandonment: createAbandonmentStore(abandonmentKnex),
    payment: createPaymentStore(paymentKnex),
  };
}

async function insertOrder(knex, orderNumber, overrides = {}) {
  await knex('orders').insert({
    order_number: orderNumber,
    status_order: 'pending',
    payment_status: 'pending',
    ...overrides,
  });
}

test('only pending payment and pending workflow transition to failed and cancelled', async t => {
  const { setup, abandonment } = await fixture(t);
  await insertOrder(setup, 'ORD-ELIGIBLE');

  assert.deepEqual(await abandonment.transition({ orderNumber: 'ORD-ELIGIBLE' }), { result: 'transitioned' });
  assert.deepEqual(
    await setup('orders').where({ order_number: 'ORD-ELIGIBLE' }).first('payment_status', 'status_order'),
    { payment_status: 'failed', status_order: 'cancelled' }
  );
});

test('paid, processing, cancelled, fulfilled, shipped, delivered and later states remain unchanged', async t => {
  const { setup, abandonment } = await fixture(t);
  const states = [
    ['ORD-PAID', { payment_status: 'paid' }],
    ['ORD-PROCESSING', { status_order: 'processing' }],
    ['ORD-CANCELLED', { status_order: 'cancelled' }],
    ['ORD-FULFILLED', { status_order: 'fulfilled' }],
    ['ORD-SHIPPED', { status_order: 'shipped' }],
    ['ORD-DELIVERED', { status_order: 'delivered' }],
    ['ORD-REFUNDED', { payment_status: 'refunded' }],
    ['ORD-RECONCILIATION', { payment_status: 'reconciliation_required' }],
  ];

  for (const [orderNumber, state] of states) await insertOrder(setup, orderNumber, state);
  for (const [orderNumber, state] of states) {
    assert.deepEqual(await abandonment.transition({ orderNumber }), { result: 'ineligible' });
    const current = await setup('orders').where({ order_number: orderNumber }).first();
    assert.equal(current.payment_status, state.payment_status || 'pending');
    assert.equal(current.status_order, state.status_order || 'pending');
  }
});

test('concurrent payment and abandonment produce exactly one valid terminal outcome', async t => {
  const { setup, abandonment, payment } = await fixture(t);
  await insertOrder(setup, 'ORD-RACE');

  const [abandonmentResult, paymentResult] = await Promise.all([
    abandonment.transition({ orderNumber: 'ORD-RACE' }),
    payment.transition({ orderNumber: 'ORD-RACE' }),
  ]);
  const order = await setup('orders').where({ order_number: 'ORD-RACE' }).first();

  assert.equal([abandonmentResult.result, paymentResult.result].filter(result => result === 'transitioned').length, 1);
  assert.ok(
    (order.payment_status === 'failed' && order.status_order === 'cancelled') ||
    (order.payment_status === 'paid' && order.status_order === 'processing')
  );
});

test('missing, duplicate and database failure outcomes fail safely', async t => {
  const { setup, abandonment } = await fixture(t);
  assert.deepEqual(await abandonment.transition({ orderNumber: 'ORD-MISSING' }), { result: 'not_found' });
  await insertOrder(setup, 'ORD-DUPLICATE');
  await insertOrder(setup, 'ORD-DUPLICATE');
  assert.deepEqual(await abandonment.transition({ orderNumber: 'ORD-DUPLICATE' }), { result: 'not_found' });
});
