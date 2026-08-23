'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const knexFactory = require('knex');
const migration = require('../database/migrations/2026.08.23T00.00.00.order-email-delivery');
const {
  createOrderEmailDeliveryStore,
  DEFAULT_MAX_ATTEMPTS,
} = require('../src/api/order-email-delivery/services/email-delivery');
const { createPaymentStore } = require('../src/api/order/services/payment');
const { sendOrderStatusEmail, retryOrderStatusEmails } = require('../src/extensions/order-status-email');

test('production boot applies the delivery ledger and schedules bounded retries', () => {
  const root = path.join(__dirname, '..');
  const bootstrap = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8');
  const serverConfig = fs.readFileSync(path.join(root, 'config/server.ts'), 'utf8');
  const retryRoute = fs.readFileSync(path.join(root, 'src/api/order-email-delivery/routes/order-email-delivery.ts'), 'utf8');
  assert.match(bootstrap, /2026\.08\.23T00\.00\.00\.order-email-delivery\.js/);
  assert.match(serverConfig, /ORDER_EMAIL_RETRY_CRON_ENABLED/);
  assert.match(serverConfig, /retryOrderStatusEmails/);
  assert.match(serverConfig, /rule: '\* \* \* \* \*'/);
  assert.match(retryRoute, /path: '\/order-email-delivery\/retry'/);
  assert.match(retryRoute, /global::security-internal-auth/);
});

async function fixture(t) {
  const previousFrontendUrl = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = 'https://www.example.test';
  const knex = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });
  t.after(() => {
    if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontendUrl;
    return knex.destroy();
  });
  await migration.up(knex);
  await knex.schema.createTable('orders', (table) => {
    table.increments('id').primary();
    table.string('order_number');
    table.string('status_order');
    table.string('payment_status');
    table.string('stripe_session_id');
    table.string('stripe_customer_id');
    table.string('customer_email');
    table.string('customer_name');
    table.datetime('updated_at');
  });
  let now = new Date('2026-08-23T10:00:00.000Z');
  return {
    knex,
    clock: () => new Date(now),
    advance(seconds) { now = new Date(now.getTime() + seconds * 1000); },
    store: createOrderEmailDeliveryStore(knex, {
      clock: () => new Date(now),
      backoffSeconds: [10, 20, 30],
    }),
  };
}

function fakeStrapi(knex, send) {
  return {
    db: { connection: knex },
    emailRateLimitStore: { checkRateLimit: async () => ({ allowed: true }) },
    plugin: () => ({ service: () => ({ send }) }),
    entityService: {
      findMany: async (_uid, query) => {
        const row = await knex('orders').where({ order_number: query.filters.orderNumber.$eq }).first();
        return row ? [{ ...row, orderNumber: row.order_number, statusOrder: row.status_order, paymentStatus: row.payment_status, customerEmail: row.customer_email, customerName: row.customer_name }] : [];
      },
    },
    log: { error() {} },
  };
}

test('email intent is unique per order and email type, and a claim has one owner', async t => {
  const { store, knex } = await fixture(t);
  const [first, second] = await Promise.all([
    store.ensureIntent({ orderNumber: 'ORD-EMAIL-1', emailType: 'order_confirmation' }),
    store.ensureIntent({ orderNumber: 'ORD-EMAIL-1', emailType: 'order_confirmation' }),
  ]);
  assert.equal(first.result, 'ready');
  assert.equal(second.result, 'ready');
  assert.equal(await knex('order_email_deliveries').count({ count: '*' }).first().then((row) => Number(row.count)), 1);

  const claim = await store.claim({ orderNumber: 'ORD-EMAIL-1', emailType: 'order_confirmation' });
  assert.equal(claim.result, 'claimed');
  assert.equal((await store.claim({ orderNumber: 'ORD-EMAIL-1', emailType: 'order_confirmation' })).result, 'currently_processing');
  assert.equal(claim.row.attempt_count, 1);
});

test('failed delivery is retryable with bounded backoff and becomes exhausted', async t => {
  const { store, advance } = await fixture(t);
  await store.ensureIntent({ orderNumber: 'ORD-EMAIL-2', emailType: 'order_confirmation' });
  const first = await store.claim({ orderNumber: 'ORD-EMAIL-2', emailType: 'order_confirmation' });
  assert.equal((await store.markFailure({ id: first.row.id, claimToken: first.claimToken, error: new Error('provider unavailable') })).result, 'failed_retryable');
  assert.equal((await store.claim({ orderNumber: 'ORD-EMAIL-2', emailType: 'order_confirmation' })).result, 'not_due');
  advance(10);
  let claim = await store.claim({ orderNumber: 'ORD-EMAIL-2', emailType: 'order_confirmation' });
  assert.equal(claim.result, 'claimed');
  await store.markFailure({ id: claim.row.id, claimToken: claim.claimToken, error: new Error('still unavailable') });

  for (let attempt = 3; attempt <= DEFAULT_MAX_ATTEMPTS; attempt += 1) {
    advance(30);
    claim = await store.claim({ orderNumber: 'ORD-EMAIL-2', emailType: 'order_confirmation' });
    assert.equal(claim.result, 'claimed');
    const result = await store.markFailure({ id: claim.row.id, claimToken: claim.claimToken, error: new Error('provider unavailable') });
    if (attempt === DEFAULT_MAX_ATTEMPTS) assert.equal(result.result, 'failed_exhausted');
  }
  assert.equal((await store.claim({ orderNumber: 'ORD-EMAIL-2', emailType: 'order_confirmation' })).result, 'exhausted');
});

test('sent delivery is terminal and cannot be sent again', async t => {
  const { store } = await fixture(t);
  await store.ensureIntent({ orderNumber: 'ORD-EMAIL-3', emailType: 'order_shipped' });
  const claim = await store.claim({ orderNumber: 'ORD-EMAIL-3', emailType: 'order_shipped' });
  assert.equal((await store.markSent({ id: claim.row.id, claimToken: claim.claimToken })).result, 'sent');
  assert.equal((await store.claim({ orderNumber: 'ORD-EMAIL-3', emailType: 'order_shipped' })).result, 'already_sent');
});

test('only the first authoritative payment transition creates one confirmation intent', async t => {
  const { store, knex } = await fixture(t);
  await knex('orders').insert({ order_number: 'ORD-PAID-EMAIL', status_order: 'pending', payment_status: 'pending', customer_email: 'buyer@example.test', customer_name: 'Buyer' });
  const calls = [];
  const strapi = fakeStrapi(knex, async (message) => calls.push(message));
  const payment = createPaymentStore(knex);

  const first = await payment.transition({ orderNumber: 'ORD-PAID-EMAIL', stripeSessionId: 'cs_test_paid_email_123' });
  assert.deepEqual(first, { result: 'transitioned' });
  const order = { orderNumber: 'ORD-PAID-EMAIL', customerEmail: 'buyer@example.test', customerName: 'Buyer' };
  await sendOrderStatusEmail(strapi, order, 'pending', 'processing');
  const duplicate = await payment.transition({ orderNumber: 'ORD-PAID-EMAIL', stripeSessionId: 'cs_test_paid_email_123' });
  assert.deepEqual(duplicate, { result: 'already_processed' });
  await sendOrderStatusEmail(strapi, order, 'pending', 'processing');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, 'buyer@example.test');
  assert.equal(calls[0].subject.includes('Order confirmed'), true);
  assert.equal(await knex('order_email_deliveries').where({ order_number: 'ORD-PAID-EMAIL', email_type: 'order_confirmation' }).count({ count: '*' }).first().then((row) => Number(row.count)), 1);
  assert.deepEqual(await knex('orders').where({ order_number: 'ORD-PAID-EMAIL' }).first().select('status_order', 'payment_status'), { status_order: 'processing', payment_status: 'paid' });
});

test('provider failure leaves payment paid and makes the durable intent retryable', async t => {
  const { knex } = await fixture(t);
  await knex('orders').insert({ order_number: 'ORD-RETRY-EMAIL', status_order: 'processing', payment_status: 'paid', customer_email: 'retry@example.test', customer_name: 'Retry' });
  let shouldFail = true;
  const calls = [];
  const strapi = fakeStrapi(knex, async (message) => {
    calls.push(message);
    if (shouldFail) throw new Error('provider unavailable');
  });
  const order = { orderNumber: 'ORD-RETRY-EMAIL', customerEmail: 'retry@example.test', customerName: 'Retry' };
  const first = await sendOrderStatusEmail(strapi, order, 'pending', 'processing');
  assert.equal(first.sent, false);
  assert.deepEqual(await knex('orders').where({ order_number: 'ORD-RETRY-EMAIL' }).first().select('status_order', 'payment_status'), { status_order: 'processing', payment_status: 'paid' });
  await knex('order_email_deliveries').where({ order_number: 'ORD-RETRY-EMAIL', email_type: 'order_confirmation' }).update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() });

  shouldFail = false;
  const retried = await retryOrderStatusEmails(strapi, { limit: 10 });
  assert.deepEqual(retried, { scanned: 1, sent: 1, failed: 0, skipped: 0 });
  assert.equal(calls.length, 2);
  assert.equal((await knex('order_email_deliveries').where({ order_number: 'ORD-RETRY-EMAIL' }).first()).status, 'sent');
});

test('unchanged pending order state does not create a confirmation email', async t => {
  const { knex } = await fixture(t);
  const calls = [];
  const strapi = fakeStrapi(knex, async (message) => calls.push(message));
  const result = await sendOrderStatusEmail(strapi, { orderNumber: 'ORD-PENDING', customerEmail: 'pending@example.test' }, 'pending', 'pending');
  assert.deepEqual(result, { sent: false, reason: 'not_applicable' });
  assert.equal(calls.length, 0);
  assert.equal(await knex('order_email_deliveries').count({ count: '*' }).first().then((row) => Number(row.count)), 0);
});
