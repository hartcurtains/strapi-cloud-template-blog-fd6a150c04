'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Koa = require('koa');
const Router = require('@koa/router');
const knexFactory = require('knex');
const migration = require('../database/migrations/2026.07.15T00.00.00.stripe-webhook-processing');
const { createLifecycleStore } = require('../src/api/stripe-webhook-processing/services/lifecycle');
const routes = require('../dist/src/api/stripe-webhook-processing/routes/stripe-webhook-processing').default;
const lifecyclePolicy = require('../dist/src/policies/stripe-webhook-lifecycle-auth').default;

async function databaseFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pb07-'));
  const knex = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: path.join(directory, 'lifecycle.db') },
    useNullAsDefault: true,
  });
  t.after(async () => {
    await knex.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return knex;
}

async function createSynchronizedTable(knex, { omit = [], incompatibleEventId = false } = {}) {
  await knex.schema.createTable('stripe_webhook_processings', table => {
    table.increments('id').primary();
    table.string('document_id');
    if (!omit.includes('event_id')) incompatibleEventId ? table.integer('event_id').notNullable() : table.string('event_id').notNullable();
    if (!omit.includes('order_number')) table.string('order_number').nullable();
    if (!omit.includes('status')) table.string('status').notNullable();
    if (!omit.includes('claimed_at')) table.datetime('claimed_at').notNullable();
    if (!omit.includes('completed_at')) table.datetime('completed_at').nullable();
    if (!omit.includes('event_type')) table.string('event_type').nullable();
    if (!omit.includes('claim_token')) table.string('claim_token').notNullable();
    table.datetime('created_at').nullable();
    table.datetime('updated_at').nullable();
  });
}

async function sqliteIndexes(knex) {
  return knex.raw("PRAGMA index_list('stripe_webhook_processings')");
}

async function lifecycleFixture(t) {
  const knex = await databaseFixture(t);
  await createSynchronizedTable(knex);
  await migration.up(knex);
  let now = new Date('2026-07-15T10:00:00.000Z');
  return {
    knex,
    store: createLifecycleStore(knex, () => new Date(now)),
    advance(ms) { now = new Date(now.getTime() + ms); },
  };
}

test('event lease behavior is atomic in SQL, owner-guarded, completed, and retryable', async t => {
  const { store, advance } = await lifecycleFixture(t);
  const first = await store.claimEvent({ eventId: 'evt_same', eventType: 'checkout.session.completed', leaseSeconds: 300 });
  assert.equal(first.result, 'claimed');
  assert.equal((await store.claimEvent({ eventId: 'evt_same', eventType: 'checkout.session.completed', leaseSeconds: 300 })).result, 'currently_processing');

  advance(300_001);
  const recovered = await store.claimEvent({ eventId: 'evt_same', eventType: 'checkout.session.completed', leaseSeconds: 300 });
  assert.equal(recovered.result, 'claimed');
  assert.notEqual(recovered.claimToken, first.claimToken);
  assert.equal((await store.complete({ eventId: 'evt_same', claimToken: first.claimToken })).result, 'not_owner');
  assert.equal((await store.complete({ eventId: 'evt_same', claimToken: recovered.claimToken })).result, 'completed');
  assert.equal((await store.claimEvent({ eventId: 'evt_same', eventType: 'checkout.session.completed', leaseSeconds: 300 })).result, 'already_completed');

  const reconciliation = await store.claimEvent({ eventId: 'evt_reconciliation', eventType: 'checkout.session.completed', leaseSeconds: 300 });
  await store.claimOrder({ eventId: 'evt_reconciliation', orderNumber: 'ORD-RECONCILIATION', claimToken: reconciliation.claimToken });
  assert.equal((await store.markReconciliationRequired({ eventId: 'evt_reconciliation', claimToken: first.claimToken })).result, 'not_owner');
  assert.equal((await store.markReconciliationRequired({ eventId: 'evt_reconciliation', claimToken: reconciliation.claimToken })).result, 'reconciliation_required');
  assert.equal((await store.claimEvent({ eventId: 'evt_reconciliation', eventType: 'checkout.session.completed', leaseSeconds: 300 })).result, 'reconciliation_required');
  assert.equal((await store.markReconciliationRequired({ eventId: 'evt_reconciliation', claimToken: first.claimToken })).result, 'already_reconciliation_required');

  const failed = await store.claimEvent({ eventId: 'evt_retry', eventType: 'checkout.session.completed', leaseSeconds: 300 });
  assert.equal((await store.release({ eventId: 'evt_retry', claimToken: failed.claimToken })).result, 'released');
  assert.equal((await store.claimEvent({ eventId: 'evt_retry', eventType: 'checkout.session.completed', leaseSeconds: 300 })).result, 'claimed');
});

test('order reservation is unique, released on failure, and retained after completion', async t => {
  const { store, knex } = await lifecycleFixture(t);
  const first = await store.claimEvent({ eventId: 'evt_order_1', eventType: 'checkout.session.completed', leaseSeconds: 300 });
  const second = await store.claimEvent({ eventId: 'evt_order_2', eventType: 'checkout.session.async_payment_succeeded', leaseSeconds: 300 });
  assert.equal((await store.claimOrder({ eventId: 'evt_order_1', orderNumber: 'ORD-1', claimToken: first.claimToken })).result, 'claimed');
  assert.equal((await store.claimOrder({ eventId: 'evt_order_2', orderNumber: 'ORD-1', claimToken: second.claimToken })).result, 'currently_processing');
  assert.equal((await store.release({ eventId: 'evt_order_1', claimToken: first.claimToken })).result, 'released');

  const third = await store.claimEvent({ eventId: 'evt_order_3', eventType: 'checkout.session.completed', leaseSeconds: 300 });
  assert.equal((await store.claimOrder({ eventId: 'evt_order_3', orderNumber: 'ORD-1', claimToken: third.claimToken })).result, 'claimed');
  assert.equal((await store.complete({ eventId: 'evt_order_3', claimToken: third.claimToken })).result, 'completed');
  assert.equal((await store.release({ eventId: 'evt_order_3', claimToken: third.claimToken })).result, 'already_completed');

  const fourth = await store.claimEvent({ eventId: 'evt_order_4', eventType: 'checkout.session.completed', leaseSeconds: 300 });
  assert.equal((await store.claimOrder({ eventId: 'evt_order_4', orderNumber: 'ORD-1', claimToken: fourth.claimToken })).result, 'already_processed');

  const recon = await store.claimEvent({ eventId: 'evt_order_recon', eventType: 'checkout.session.completed', leaseSeconds: 300 });
  await store.claimOrder({ eventId: 'evt_order_recon', orderNumber: 'ORD-RECON', claimToken: recon.claimToken });
  await store.markReconciliationRequired({ eventId: 'evt_order_recon', claimToken: recon.claimToken });
  const later = await store.claimEvent({ eventId: 'evt_order_later', eventType: 'checkout.session.completed', leaseSeconds: 300 });
  assert.equal((await store.claimOrder({ eventId: 'evt_order_later', orderNumber: 'ORD-RECON', claimToken: later.claimToken })).result, 'reconciliation_required');

  const invalid = await store.claimEvent({ eventId: 'evt_invalid', eventType: 'checkout.session.completed', leaseSeconds: 300 });
  await store.complete({ eventId: 'evt_invalid', claimToken: invalid.claimToken });
  assert.equal((await knex('stripe_webhook_processings').where({ event_id: 'evt_invalid' }).first()).order_number, null);
});

test('migration fails safely when schema synchronization has not created the table', async t => {
  const knex = await databaseFixture(t);
  await assert.rejects(migration.up(knex), /schema synchronization/);
});

test('migration adds missing deterministic indexes, verifies them, preserves records, and reruns as a no-op', async t => {
  const knex = await databaseFixture(t);
  await createSynchronizedTable(knex);
  await knex('stripe_webhook_processings').insert({
    document_id: 'doc-1', event_id: 'evt_existing', order_number: null, status: 'reconciliation_required',
    claimed_at: '2026-07-15T10:00:00.000Z', completed_at: null, event_type: 'checkout.session.completed',
    claim_token: '11111111-1111-1111-1111-111111111111', created_at: '2026-07-15T10:00:00.000Z', updated_at: '2026-07-15T10:00:00.000Z',
  });
  await migration.up(knex);
  const first = (await sqliteIndexes(knex)).map(index => index.name).sort();
  assert(first.includes(migration.constants.EVENT_INDEX));
  assert(first.includes(migration.constants.ORDER_INDEX));
  await migration.up(knex);
  assert.deepEqual((await sqliteIndexes(knex)).map(index => index.name).sort(), first);
  assert.equal((await knex('stripe_webhook_processings').where({ event_id: 'evt_existing' }).first()).document_id, 'doc-1');
  assert.equal((await knex('stripe_webhook_processings').where({ event_id: 'evt_existing' }).first()).status, 'reconciliation_required');
});

test('migration accepts equivalent existing unique indexes without replacing them', async t => {
  const knex = await databaseFixture(t);
  await createSynchronizedTable(knex);
  await knex.raw('CREATE UNIQUE INDEX existing_event_unique ON stripe_webhook_processings (event_id)');
  await knex.raw('CREATE UNIQUE INDEX existing_order_unique ON stripe_webhook_processings (order_number)');
  await migration.up(knex);
  const names = (await sqliteIndexes(knex)).map(index => index.name);
  assert(names.includes('existing_event_unique'));
  assert(names.includes('existing_order_unique'));
  assert(!names.includes(migration.constants.EVENT_INDEX));
  assert(!names.includes(migration.constants.ORDER_INDEX));
});

test('migration reports missing columns and rejects incompatible columns', async t => {
  const missingDb = await databaseFixture(t);
  await createSynchronizedTable(missingDb, { omit: ['claim_token'] });
  await assert.rejects(migration.up(missingDb), /missing columns: claim_token/);

  const incompatibleDb = await databaseFixture(t);
  await createSynchronizedTable(incompatibleDb, { incompatibleEventId: true });
  await assert.rejects(migration.up(incompatibleDb), /event_id \(integer\)/);
});

test('migration partial failure rolls back its index creation', async t => {
  const knex = await databaseFixture(t);
  await createSynchronizedTable(knex);
  const base = {
    document_id: null, order_number: 'DUPLICATE', status: 'processing', claimed_at: '2026-07-15T10:00:00.000Z',
    completed_at: null, event_type: null, claim_token: '11111111-1111-1111-1111-111111111111', created_at: null, updated_at: null,
  };
  await knex('stripe_webhook_processings').insert([{ ...base, event_id: 'evt_one' }, { ...base, event_id: 'evt_two', claim_token: '22222222-2222-2222-2222-222222222222' }]);
  await assert.rejects(migration.up(knex));
  assert(!(await sqliteIndexes(knex)).some(index => index.name === migration.constants.EVENT_INDEX));
});

test('migration rollback is non-destructive to schema-owned and unrelated objects', async t => {
  const knex = await databaseFixture(t);
  await createSynchronizedTable(knex);
  await knex.schema.createTable('unrelated_pb07_test', table => { table.increments('id'); table.string('value'); });
  await knex.raw('CREATE INDEX unrelated_pb07_index ON unrelated_pb07_test (value)');
  await knex('stripe_webhook_processings').insert({
    document_id: null, event_id: 'evt_survives', order_number: null, status: 'processing', claimed_at: '2026-07-15T10:00:00.000Z',
    completed_at: null, event_type: null, claim_token: '11111111-1111-1111-1111-111111111111', created_at: null, updated_at: null,
  });
  await migration.up(knex);
  await migration.down(knex);
  assert.equal(await knex.schema.hasTable('stripe_webhook_processings'), true);
  assert.equal(await knex.schema.hasTable('unrelated_pb07_test'), true);
  assert.equal((await knex('stripe_webhook_processings').where({ event_id: 'evt_survives' }).first()).status, 'processing');
  assert((await sqliteIndexes(knex)).some(index => index.name === migration.constants.EVENT_INDEX));
});

async function authServer(t, store) {
  const app = new Koa();
  const router = new Router();
  let writes = 0;
  for (const route of routes.routes) {
    router.post(`/api${route.path}`, async ctx => {
      try {
        await lifecyclePolicy(ctx);
      } catch {
        ctx.status = 401;
        ctx.body = { error: 'Unauthorized' };
        return;
      }

      let raw = '';
      for await (const chunk of ctx.req) raw += chunk;
      let body;
      try { body = JSON.parse(raw); } catch { ctx.status = 400; ctx.body = { error: 'Invalid lifecycle request' }; return; }
      if (route.path.endsWith('/claim-event') && body?.eventId === 'evt_request_auth' && Number.isInteger(body.leaseSeconds)) {
        writes += 1;
        ctx.body = await store.claimEvent(body);
        return;
      }
      if (route.path.endsWith('/claim-event') && body?.eventId === 'evt_request_release' && Number.isInteger(body.leaseSeconds)) {
        writes += 1;
        ctx.body = await store.claimEvent(body);
        return;
      }
      if (route.path.endsWith('/claim-order') && body?.eventId && body?.orderNumber && body?.claimToken) {
        writes += 1;
        ctx.body = await store.claimOrder(body);
        return;
      }
      if (route.path.endsWith('/complete') && body?.eventId && body?.claimToken) {
        writes += 1;
        ctx.body = await store.complete(body);
        return;
      }
      if (route.path.endsWith('/release') && body?.eventId && body?.claimToken) {
        writes += 1;
        ctx.body = await store.release(body);
        return;
      }
      ctx.status = 400;
      ctx.body = { error: 'Invalid lifecycle request' };
    });
  }
  app.use(router.routes());
  const server = http.createServer(app.callback());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, writes: () => writes };
}

test('all lifecycle routes use the dedicated server-only policy', () => {
  assert.equal(routes.routes.length, 5);
  for (const route of routes.routes) {
    assert.equal(route.config.auth, false);
    assert.deepEqual(route.config.policies, ['global::stripe-webhook-lifecycle-auth']);
  }
});

test('request boundary rejects missing, wrong, normal-user, and public credentials with zero writes', async t => {
  const previous = process.env.STRIPE_WEBHOOK_LIFECYCLE_SECRET;
  process.env.STRIPE_WEBHOOK_LIFECYCLE_SECRET = 'pb07-test-server-only-secret';
  t.after(() => { if (previous === undefined) delete process.env.STRIPE_WEBHOOK_LIFECYCLE_SECRET; else process.env.STRIPE_WEBHOOK_LIFECYCLE_SECRET = previous; });
  const { store } = await lifecycleFixture(t);
  const server = await authServer(t, store);
  const body = JSON.stringify({ eventId: 'evt_request_auth', eventType: 'checkout.session.completed', leaseSeconds: 300 });

  for (const route of routes.routes) {
    const response = await fetch(`${server.url}/api${route.path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(response.status, 401);
  }
  for (const authorization of ['Bearer wrong-secret', 'Bearer normal-authenticated-user-jwt']) {
    const response = await fetch(`${server.url}/api/stripe-webhook-processing/claim-event`, { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body });
    assert.equal(response.status, 401);
  }
  assert.equal(server.writes(), 0);
});

test('request boundary accepts only the correct internal credential and rejects malformed payload safely', async t => {
  const previous = process.env.STRIPE_WEBHOOK_LIFECYCLE_SECRET;
  process.env.STRIPE_WEBHOOK_LIFECYCLE_SECRET = 'pb07-test-server-only-secret';
  t.after(() => { if (previous === undefined) delete process.env.STRIPE_WEBHOOK_LIFECYCLE_SECRET; else process.env.STRIPE_WEBHOOK_LIFECYCLE_SECRET = previous; });
  const { store } = await lifecycleFixture(t);
  const server = await authServer(t, store);
  const headers = { authorization: 'Bearer pb07-test-server-only-secret', 'content-type': 'application/json' };

  const malformed = await fetch(`${server.url}/api/stripe-webhook-processing/claim-event`, { method: 'POST', headers, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal(server.writes(), 0);

  const accepted = await fetch(`${server.url}/api/stripe-webhook-processing/claim-event`, {
    method: 'POST', headers,
    body: JSON.stringify({ eventId: 'evt_request_auth', eventType: 'checkout.session.completed', leaseSeconds: 300 }),
  });
  assert.equal(accepted.status, 200);
  const acceptedClaim = await accepted.json();
  assert.equal(acceptedClaim.result, 'claimed');

  const order = await fetch(`${server.url}/api/stripe-webhook-processing/claim-order`, {
    method: 'POST', headers,
    body: JSON.stringify({ eventId: 'evt_request_auth', orderNumber: 'ORDER-REQUEST-AUTH', claimToken: acceptedClaim.claimToken }),
  });
  assert.equal((await order.json()).result, 'claimed');
  const completion = await fetch(`${server.url}/api/stripe-webhook-processing/complete`, {
    method: 'POST', headers,
    body: JSON.stringify({ eventId: 'evt_request_auth', claimToken: acceptedClaim.claimToken }),
  });
  assert.equal((await completion.json()).result, 'completed');

  const releasable = await fetch(`${server.url}/api/stripe-webhook-processing/claim-event`, {
    method: 'POST', headers,
    body: JSON.stringify({ eventId: 'evt_request_release', eventType: 'checkout.session.completed', leaseSeconds: 300 }),
  });
  const releasableClaim = await releasable.json();
  const release = await fetch(`${server.url}/api/stripe-webhook-processing/release`, {
    method: 'POST', headers,
    body: JSON.stringify({ eventId: 'evt_request_release', claimToken: releasableClaim.claimToken }),
  });
  assert.equal((await release.json()).result, 'released');
  assert.equal(server.writes(), 5);
});

test('missing configured lifecycle credential fails closed', async t => {
  const previous = process.env.STRIPE_WEBHOOK_LIFECYCLE_SECRET;
  delete process.env.STRIPE_WEBHOOK_LIFECYCLE_SECRET;
  t.after(() => { if (previous !== undefined) process.env.STRIPE_WEBHOOK_LIFECYCLE_SECRET = previous; });
  const { store } = await lifecycleFixture(t);
  const server = await authServer(t, store);
  const response = await fetch(`${server.url}/api/stripe-webhook-processing/claim-event`, {
    method: 'POST', headers: { authorization: 'Bearer any-value', 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(response.status, 401);
  assert.equal(server.writes(), 0);
});
