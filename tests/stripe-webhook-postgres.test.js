'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const knexFactory = require('knex');
const migration = require('../database/migrations/2026.07.15T00.00.00.stripe-webhook-processing');
const { createLifecycleStore } = require('../src/api/stripe-webhook-processing/services/lifecycle');

const connectionString = process.env.PB07_TEST_DATABASE_URL;
const configured = Boolean(connectionString);

function assertIsolatedTestDatabase(url) {
  const databaseName = new URL(url).pathname.replace(/^\//, '');
  if (!/test/i.test(databaseName)) {
    throw new Error('PB07_TEST_DATABASE_URL must name an isolated database containing "test"');
  }
}

function barrier(parties) {
  let arrivals = 0;
  let release;
  const open = new Promise(resolve => { release = resolve; });
  return async () => {
    arrivals += 1;
    if (arrivals === parties) release();
    await open;
  };
}

async function overlap(firstDb, secondDb, firstOperation, secondOperation) {
  const ready = barrier(2);
  let openTransactions = 0;
  const run = (db, operation) => db.transaction(async trx => {
    openTransactions += 1;
    await ready();
    assert.equal(openTransactions, 2);
    return operation(trx);
  });
  return Promise.all([run(firstDb, firstOperation), run(secondDb, secondOperation)]);
}

async function synchronizedTable(knex) {
  await knex.schema.createTable('stripe_webhook_processings', table => {
    table.increments('id').primary();
    table.string('document_id');
    table.string('event_id').notNullable();
    table.string('order_number').nullable();
    table.string('status').notNullable();
    table.datetime('claimed_at').notNullable();
    table.datetime('completed_at').nullable();
    table.string('event_type').nullable();
    table.string('claim_token').notNullable();
    table.datetime('created_at').nullable();
    table.datetime('updated_at').nullable();
  });
}

async function postgresFixture(t) {
  assertIsolatedTestDatabase(connectionString);
  const schema = `pb07_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const admin = knexFactory({ client: 'pg', connection: connectionString, pool: { min: 0, max: 2 } });
  await admin.raw('CREATE SCHEMA ??', [schema]);
  const knex = knexFactory({
    client: 'pg', connection: connectionString, searchPath: [schema], pool: { min: 1, max: 3 },
  });
  t.after(async () => {
    await knex.destroy();
    await admin.raw('DROP SCHEMA ?? CASCADE', [schema]);
    await admin.destroy();
  });
  await synchronizedTable(knex);
  return { knex, schema };
}

async function uniqueObjects(knex) {
  const result = await knex.raw(`
    SELECT i.relname AS index_name,
           c.conname AS constraint_name,
           c.contype AS constraint_type,
           ix.indisunique,
           ix.indisvalid,
           bool_and(ix.indpred IS NULL) AS is_unconditional,
           json_agg(a.attname::text ORDER BY ord.ordinality) AS columns
      FROM pg_class t
      JOIN pg_namespace ns ON ns.oid = t.relnamespace
      JOIN pg_index ix ON ix.indrelid = t.oid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY ord(attnum, ordinality) ON ord.ordinality <= ix.indnkeyatts
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ord.attnum
      LEFT JOIN pg_constraint c ON c.conindid = ix.indexrelid
     WHERE ns.nspname = current_schema()
       AND t.relname = 'stripe_webhook_processings'
     GROUP BY i.relname, c.conname, c.contype, ix.indisunique, ix.indisvalid
     ORDER BY i.relname
  `);
  return result.rows;
}

test('PostgreSQL migration creates and safely reruns deterministic unique indexes', { skip: !configured }, async t => {
  const { knex } = await postgresFixture(t);
  await migration.up(knex);
  const first = await uniqueObjects(knex);
  for (const [name, column] of [
    [migration.constants.EVENT_INDEX, 'event_id'],
    [migration.constants.ORDER_INDEX, 'order_number'],
  ]) {
    const index = first.find(value => value.index_name === name);
    assert(index);
    assert.equal(index.indisunique, true);
    assert.equal(index.indisvalid, true);
    assert.equal(index.is_unconditional, true);
    assert.deepEqual(index.columns, [column]);
  }
  await migration.up(knex);
  assert.deepEqual(await uniqueObjects(knex), first);
});

test('PostgreSQL migration accepts equivalent pre-existing unique constraints', { skip: !configured }, async t => {
  const { knex } = await postgresFixture(t);
  await knex.raw('ALTER TABLE ?? ADD CONSTRAINT ?? UNIQUE (??)', [
    'stripe_webhook_processings', 'existing_event_constraint', 'event_id',
  ]);
  await knex.raw('ALTER TABLE ?? ADD CONSTRAINT ?? UNIQUE (??)', [
    'stripe_webhook_processings', 'existing_order_constraint', 'order_number',
  ]);
  await migration.up(knex);
  const objects = await uniqueObjects(knex);
  assert(objects.some(value => value.constraint_name === 'existing_event_constraint' && value.constraint_type === 'u' && value.columns[0] === 'event_id'));
  assert(objects.some(value => value.constraint_name === 'existing_order_constraint' && value.constraint_type === 'u' && value.columns[0] === 'order_number'));
  assert(!objects.some(value => value.index_name === migration.constants.EVENT_INDEX));
  assert(!objects.some(value => value.index_name === migration.constants.ORDER_INDEX));
});

test('PostgreSQL migration accepts equivalent pre-existing unique indexes', { skip: !configured }, async t => {
  const { knex } = await postgresFixture(t);
  await knex.raw('CREATE UNIQUE INDEX ?? ON ?? (??)', ['existing_event_unique', 'stripe_webhook_processings', 'event_id']);
  await knex.raw('CREATE UNIQUE INDEX ?? ON ?? (??)', ['existing_order_unique', 'stripe_webhook_processings', 'order_number']);
  await migration.up(knex);
  const objects = await uniqueObjects(knex);
  assert(objects.some(value => value.index_name === 'existing_event_unique' && value.indisunique && value.columns[0] === 'event_id'));
  assert(objects.some(value => value.index_name === 'existing_order_unique' && value.indisunique && value.columns[0] === 'order_number'));
  assert(!objects.some(value => value.index_name === migration.constants.EVENT_INDEX));
  assert(!objects.some(value => value.index_name === migration.constants.ORDER_INDEX));
});

test('PostgreSQL migration does not accept a non-unique index', { skip: !configured }, async t => {
  const { knex } = await postgresFixture(t);
  await knex.raw('CREATE INDEX existing_event_non_unique ON ?? (??)', ['stripe_webhook_processings', 'event_id']);
  await migration.up(knex);
  const objects = await uniqueObjects(knex);
  assert(objects.some(value => value.index_name === 'existing_event_non_unique' && !value.indisunique));
  assert(objects.some(value => value.index_name === migration.constants.EVENT_INDEX && value.indisunique && value.columns[0] === 'event_id'));
});

test('PostgreSQL migration does not accept a unique index on the wrong column', { skip: !configured }, async t => {
  const { knex } = await postgresFixture(t);
  await knex.raw('CREATE UNIQUE INDEX existing_wrong_column_unique ON ?? (??)', ['stripe_webhook_processings', 'status']);
  await migration.up(knex);
  const objects = await uniqueObjects(knex);
  assert(objects.some(value => value.index_name === 'existing_wrong_column_unique' && value.columns[0] === 'status'));
  assert(objects.some(value => value.index_name === migration.constants.EVENT_INDEX && value.columns[0] === 'event_id'));
  assert(objects.some(value => value.index_name === migration.constants.ORDER_INDEX && value.columns[0] === 'order_number'));
});

test('PostgreSQL lifecycle operations overlap on independent connections', { skip: !configured }, async t => {
  assertIsolatedTestDatabase(connectionString);
  const schema = `pb07_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  const admin = knexFactory({ client: 'pg', connection: connectionString, pool: { min: 0, max: 2 } });
  await admin.raw('CREATE SCHEMA ??', [schema]);

  const connection = () => knexFactory({
    client: 'pg', connection: connectionString, searchPath: [schema], pool: { min: 1, max: 3 },
  });
  const firstDb = connection();
  const secondDb = connection();
  t.after(async () => {
    await Promise.all([firstDb.destroy(), secondDb.destroy()]);
    await admin.raw('DROP SCHEMA ?? CASCADE', [schema]);
    await admin.destroy();
  });
  await synchronizedTable(firstDb);
  await migration.up(firstDb);
  await migration.up(firstDb);
  await migration.down(firstDb);
  assert.equal(await firstDb.schema.hasTable('stripe_webhook_processings'), true);

  const now = new Date('2026-07-15T10:00:00.000Z');
  const firstStore = createLifecycleStore(firstDb, () => new Date(now));
  const secondStore = createLifecycleStore(secondDb, () => new Date(now));

  await t.test('same new event has one winner after both callers reach the barrier', async () => {
    const outcomes = await overlap(firstDb, secondDb,
      trx => createLifecycleStore(trx, () => new Date(now)).claimEvent({ eventId: 'evt_pg_new', eventType: 'checkout.session.completed', leaseSeconds: 300 }),
      trx => createLifecycleStore(trx, () => new Date(now)).claimEvent({ eventId: 'evt_pg_new', eventType: 'checkout.session.completed', leaseSeconds: 300 }));
    assert.deepEqual(outcomes.map(value => value.result).sort(), ['claimed', 'currently_processing']);
  });

  await t.test('live lease cannot be stolen by overlapping claim attempts', async () => {
    const owner = await firstStore.claimEvent({ eventId: 'evt_pg_live', eventType: 'checkout.session.completed', leaseSeconds: 300 });
    assert.equal(owner.result, 'claimed');
    const outcomes = await overlap(firstDb, secondDb,
      trx => createLifecycleStore(trx, () => new Date(now)).claimEvent({ eventId: 'evt_pg_live', eventType: 'checkout.session.completed', leaseSeconds: 300 }),
      trx => createLifecycleStore(trx, () => new Date(now)).claimEvent({ eventId: 'evt_pg_live', eventType: 'checkout.session.completed', leaseSeconds: 300 }));
    assert.deepEqual(outcomes.map(value => value.result), ['currently_processing', 'currently_processing']);
  });

  await t.test('expired lease takeover has exactly one winner', async () => {
    await firstDb('stripe_webhook_processings').insert({
      document_id: randomUUID(), event_id: 'evt_pg_expired', order_number: null, status: 'processing',
      claimed_at: new Date(now.getTime() - 301_000), completed_at: null, event_type: 'checkout.session.completed',
      claim_token: randomUUID(), created_at: now, updated_at: now,
    });
    const outcomes = await overlap(firstDb, secondDb,
      trx => createLifecycleStore(trx, () => new Date(now)).claimEvent({ eventId: 'evt_pg_expired', eventType: 'checkout.session.completed', leaseSeconds: 300 }),
      trx => createLifecycleStore(trx, () => new Date(now)).claimEvent({ eventId: 'evt_pg_expired', eventType: 'checkout.session.completed', leaseSeconds: 300 }));
    assert.deepEqual(outcomes.map(value => value.result).sort(), ['claimed', 'currently_processing']);
    assert.equal(new Set(outcomes.filter(value => value.claimToken).map(value => value.claimToken)).size, 1);
  });

  await t.test('different events racing for one order have one reservation winner', async () => {
    const one = await firstStore.claimEvent({ eventId: 'evt_pg_order_1', eventType: 'checkout.session.completed', leaseSeconds: 300 });
    const two = await secondStore.claimEvent({ eventId: 'evt_pg_order_2', eventType: 'checkout.session.async_payment_succeeded', leaseSeconds: 300 });
    const outcomes = await overlap(firstDb, secondDb,
      trx => createLifecycleStore(trx, () => new Date(now)).claimOrder({ eventId: 'evt_pg_order_1', orderNumber: 'ORDER-PG-1', claimToken: one.claimToken }),
      trx => createLifecycleStore(trx, () => new Date(now)).claimOrder({ eventId: 'evt_pg_order_2', orderNumber: 'ORDER-PG-1', claimToken: two.claimToken }));
    assert.deepEqual(outcomes.map(value => value.result).sort(), ['already_processed', 'claimed']);
    const rows = await firstDb('stripe_webhook_processings')
      .select('event_id', 'order_number')
      .whereIn('event_id', ['evt_pg_order_1', 'evt_pg_order_2'])
      .orderBy('event_id');
    assert.equal(rows.filter(row => row.order_number === 'ORDER-PG-1').length, 1);
    assert.equal(rows.find(row => row.event_id === (outcomes[0].result === 'claimed' ? 'evt_pg_order_1' : 'evt_pg_order_2')).order_number, 'ORDER-PG-1');
    assert.equal(rows.find(row => row.event_id === (outcomes[0].result === 'claimed' ? 'evt_pg_order_2' : 'evt_pg_order_1')).order_number, null);
  });

  await t.test('stale release racing current completion cannot remove the current claim', async () => {
    const stale = await firstStore.claimEvent({ eventId: 'evt_pg_release_complete', eventType: 'checkout.session.completed', leaseSeconds: 300 });
    await firstDb('stripe_webhook_processings').where({ event_id: 'evt_pg_release_complete' }).update({ claimed_at: new Date(now.getTime() - 301_000) });
    const current = await secondStore.claimEvent({ eventId: 'evt_pg_release_complete', eventType: 'checkout.session.completed', leaseSeconds: 300 });
    assert.equal((await secondStore.claimOrder({
      eventId: 'evt_pg_release_complete', orderNumber: 'ORDER-PG-RELEASE-COMPLETE', claimToken: current.claimToken,
    })).result, 'claimed');
    const [released, completed] = await overlap(firstDb, secondDb,
      trx => createLifecycleStore(trx, () => new Date(now)).release({ eventId: 'evt_pg_release_complete', claimToken: stale.claimToken }),
      trx => createLifecycleStore(trx, () => new Date(now)).complete({ eventId: 'evt_pg_release_complete', claimToken: current.claimToken }));
    assert(['not_owner', 'already_completed'].includes(released.result));
    assert.equal(completed.result, 'completed');
    const final = await firstDb('stripe_webhook_processings').where({ event_id: 'evt_pg_release_complete' }).first();
    assert(final);
    assert.equal(final.status, 'completed');
    assert.equal(final.claim_token, current.claimToken);
    assert.equal(final.order_number, 'ORDER-PG-RELEASE-COMPLETE');
    assert(final.completed_at instanceof Date);
  });

  await t.test('unexpected non-unique database errors still propagate', async () => {
    const claim = await firstStore.claimEvent({ eventId: 'evt_pg_unexpected_error', eventType: 'checkout.session.completed', leaseSeconds: 300 });
    await firstDb.raw(`
      CREATE FUNCTION pb07_reject_order_claim() RETURNS trigger AS $$
      BEGIN
        IF NEW.order_number = 'ORDER-PG-ERROR' THEN
          RAISE EXCEPTION 'forced PB-07 test failure' USING ERRCODE = '40001';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await firstDb.raw(`
      CREATE TRIGGER pb07_reject_order_claim
      BEFORE UPDATE OF order_number ON stripe_webhook_processings
      FOR EACH ROW EXECUTE FUNCTION pb07_reject_order_claim()
    `);
    await assert.rejects(
      firstStore.claimOrder({ eventId: 'evt_pg_unexpected_error', orderNumber: 'ORDER-PG-ERROR', claimToken: claim.claimToken }),
      error => error?.code === '40001'
    );
    const final = await firstDb('stripe_webhook_processings').where({ event_id: 'evt_pg_unexpected_error' }).first();
    assert.equal(final.order_number, null);
    assert.equal(final.status, 'processing');
  });

  await t.test('completed event remains immutable under overlapping claims', async () => {
    const claim = await firstStore.claimEvent({ eventId: 'evt_pg_completed', eventType: 'checkout.session.completed', leaseSeconds: 300 });
    await firstStore.complete({ eventId: 'evt_pg_completed', claimToken: claim.claimToken });
    const outcomes = await overlap(firstDb, secondDb,
      trx => createLifecycleStore(trx, () => new Date(now)).claimEvent({ eventId: 'evt_pg_completed', eventType: 'checkout.session.completed', leaseSeconds: 300 }),
      trx => createLifecycleStore(trx, () => new Date(now)).claimEvent({ eventId: 'evt_pg_completed', eventType: 'checkout.session.completed', leaseSeconds: 300 }));
    assert.deepEqual(outcomes.map(value => value.result), ['already_completed', 'already_completed']);
  });

  await t.test('retry releases, later claims, and completes once', async () => {
    const first = await firstStore.claimEvent({ eventId: 'evt_pg_retry', eventType: 'checkout.session.completed', leaseSeconds: 300 });
    assert.equal((await firstStore.release({ eventId: 'evt_pg_retry', claimToken: first.claimToken })).result, 'released');
    const retry = await secondStore.claimEvent({ eventId: 'evt_pg_retry', eventType: 'checkout.session.completed', leaseSeconds: 300 });
    assert.equal(retry.result, 'claimed');
    assert.equal((await secondStore.complete({ eventId: 'evt_pg_retry', claimToken: retry.claimToken })).result, 'completed');
    assert.equal((await firstStore.claimEvent({ eventId: 'evt_pg_retry', eventType: 'checkout.session.completed', leaseSeconds: 300 })).result, 'already_completed');
  });

  await t.test('PostgreSQL Date timestamps do not affect lease decisions', async () => {
    const claim = await firstStore.claimEvent({ eventId: 'evt_pg_date', eventType: 'checkout.session.completed', leaseSeconds: 300 });
    assert.equal(claim.result, 'claimed');
    const row = await firstDb('stripe_webhook_processings').where({ event_id: 'evt_pg_date' }).first();
    assert(row.claimed_at instanceof Date);
    assert.equal((await secondStore.claimEvent({ eventId: 'evt_pg_date', eventType: 'checkout.session.completed', leaseSeconds: 300 })).result, 'currently_processing');
  });
});
