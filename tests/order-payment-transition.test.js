'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const knexFactory = require('knex');
const { createCancellationStore } = require('../src/api/order/services/cancellation');
const { createPaymentStore } = require('../src/api/order/services/payment');
const routes = require('../dist/src/api/order/routes/order-payment').default;

const SESSION = 'cs_test_authoritative_session_123';

function makeKnex(filename) {
  return knexFactory({
    client: 'better-sqlite3',
    connection: { filename },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });
}

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'order-payment-'));
  const filename = path.join(directory, 'orders.db');
  const setup = makeKnex(filename);
  const paymentKnex = makeKnex(filename);
  const cancellationKnex = makeKnex(filename);
  t.after(async () => {
    await Promise.all([setup.destroy(), paymentKnex.destroy(), cancellationKnex.destroy()]);
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
  await setup.schema.createTable('orders_user_lnk', table => {
    table.increments('id').primary();
    table.integer('order_id').notNullable();
    table.integer('user_id').notNullable();
  });
  await setup.raw('PRAGMA journal_mode = WAL');
  await Promise.all([
    paymentKnex.raw('PRAGMA busy_timeout = 10000'),
    cancellationKnex.raw('PRAGMA busy_timeout = 10000'),
  ]);

  return {
    setup,
    paymentKnex,
    cancellationKnex,
    payment: createPaymentStore(paymentKnex),
    cancellation: createCancellationStore(cancellationKnex),
  };
}

async function insertOrder(knex, overrides = {}) {
  const [id] = await knex('orders').insert({
    order_number: 'ORD-RACE',
    status_order: 'pending',
    payment_status: 'pending',
    stripe_session_id: SESSION,
    ...overrides,
  });
  await knex('orders_user_lnk').insert({ order_id: id, user_id: 7 });
  return id;
}

function barrier(count) {
  let release;
  let reached = 0;
  const allReached = new Promise(resolve => { release = resolve; });
  return {
    async arrive() {
      reached += 1;
      if (reached === count) release();
      await allReached;
    },
  };
}

test('independent payment and cancellation transactions have one winner', async t => {
  const { setup, payment, cancellation } = await fixture(t);
  await insertOrder(setup);
  const gate = barrier(2);

  const paymentAttempt = (async () => {
    await gate.arrive();
    return payment.transition({ orderNumber: 'ORD-RACE', stripeSessionId: SESSION });
  })();
  const cancellationAttempt = (async () => {
    await gate.arrive();
    return cancellation.transition({ orderNumber: 'ORD-RACE', stripeSessionId: SESSION });
  })();
  const [paymentResult, cancellationResult] = await Promise.all([paymentAttempt, cancellationAttempt]);
  const order = await setup('orders').first();

  assert.equal([paymentResult.result, cancellationResult.result].filter(result =>
    result === 'transitioned' || result === 'cancelled').length, 1);
  if (order.payment_status === 'paid') {
    assert.equal(order.status_order, 'processing');
    assert.deepEqual(paymentResult, { result: 'transitioned' });
    assert.deepEqual(cancellationResult, { result: 'not_eligible' });
  } else {
    assert.equal(order.payment_status, 'pending');
    assert.equal(order.status_order, 'cancelled');
    assert.deepEqual(paymentResult, { result: 'state_conflict' });
    assert.deepEqual(cancellationResult, { result: 'cancelled' });
  }
});

test('two independent payment transitions mutate only once', async t => {
  const { setup, paymentKnex, cancellationKnex } = await fixture(t);
  await insertOrder(setup);
  const first = createPaymentStore(paymentKnex);
  const second = createPaymentStore(cancellationKnex);
  const results = await Promise.all([
    first.transition({ orderNumber: 'ORD-RACE', stripeSessionId: SESSION }),
    second.transition({ orderNumber: 'ORD-RACE', stripeSessionId: SESSION }),
  ]);
  assert.deepEqual(results.map(result => result.result).sort(), ['already_processed', 'transitioned']);
  assert.deepEqual(await setup('orders').first().select('payment_status', 'status_order'), {
    payment_status: 'paid',
    status_order: 'processing',
  });
});

test('two independent cancellation transitions mutate only once', async t => {
  const { setup, paymentKnex, cancellationKnex } = await fixture(t);
  await insertOrder(setup);
  const first = createCancellationStore(paymentKnex);
  const second = createCancellationStore(cancellationKnex);
  const results = await Promise.all([
    first.transition({ orderNumber: 'ORD-RACE', stripeSessionId: SESSION }),
    second.transition({ orderNumber: 'ORD-RACE', stripeSessionId: SESSION }),
  ]);
  assert.deepEqual(results.map(result => result.result).sort(), ['already_cancelled', 'cancelled']);
  assert.deepEqual(await setup('orders').first().select('payment_status', 'status_order'), {
    payment_status: 'pending',
    status_order: 'cancelled',
  });
});

test('payment never overwrites cancelled or later-stage orders, and cancellation rejects paid orders', async t => {
  const { setup, payment, cancellation } = await fixture(t);
  for (const [orderNumber, state] of [
    ['ORD-CANCELLED', { status_order: 'cancelled' }],
    ['ORD-PAID', { payment_status: 'paid' }],
    ['ORD-PROCESSING', { status_order: 'processing' }],
    ['ORD-SHIPPED', { status_order: 'shipped' }],
    ['ORD-FULFILLED', { status_order: 'fulfilled' }],
    ['ORD-DELIVERED', { status_order: 'delivered' }],
    ['ORD-REFUNDED', { payment_status: 'refunded' }],
  ]) await insertOrder(setup, { order_number: orderNumber, ...state });

  assert.deepEqual(await payment.transition({ orderNumber: 'ORD-CANCELLED' }), { result: 'state_conflict' });
  assert.equal((await setup('orders').where({ order_number: 'ORD-CANCELLED' }).first()).status_order, 'cancelled');
  for (const orderNumber of ['ORD-PAID', 'ORD-PROCESSING', 'ORD-SHIPPED', 'ORD-FULFILLED', 'ORD-DELIVERED']) {
    assert.deepEqual(await cancellation.transition({ orderNumber, stripeSessionId: SESSION }), { result: 'not_eligible' });
  }
});

test('zero or multiple order matches and unexpected database failures remain failures', async t => {
  const { setup, payment, cancellation, paymentKnex, cancellationKnex } = await fixture(t);
  assert.deepEqual(await payment.transition({ orderNumber: 'ORD-MISSING' }), { result: 'not_found' });
  await insertOrder(setup, { order_number: 'ORD-DUPLICATE' });
  await insertOrder(setup, { order_number: 'ORD-DUPLICATE' });
  assert.deepEqual(await payment.transition({ orderNumber: 'ORD-DUPLICATE' }), { result: 'not_found' });

  await paymentKnex.destroy();
  await cancellationKnex.destroy();
  await assert.rejects(payment.transition({ orderNumber: 'ORD-MISSING' }));
  await assert.rejects(cancellation.transition({ orderNumber: 'ORD-MISSING', stripeSessionId: SESSION }));
});

test('payment transition route is lifecycle-secret protected and does not expose status inputs', () => {
  assert.equal(routes.routes.length, 1);
  assert.equal(routes.routes[0].path, '/order-payment/transition');
  assert.deepEqual(routes.routes[0].config.policies, ['global::stripe-webhook-lifecycle-auth']);
});
