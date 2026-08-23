'use strict';

const TABLE = 'order_email_deliveries';
const UNIQUE_INDEX = 'order_email_deliveries_order_type_uq';
const RETRY_INDEX = 'order_email_deliveries_retry_idx';

function rowsFromRaw(result) {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0];
  if (Array.isArray(result)) return result;
  return result?.rows || [];
}

async function indexNames(knex) {
  const client = String(knex.client.config.client).toLowerCase();
  if (client.includes('sqlite')) {
    const result = await knex.raw(`PRAGMA index_list('${TABLE}')`);
    return rowsFromRaw(result).map((row) => row.name);
  }
  if (client.includes('pg') || client.includes('postgres')) {
    const result = await knex.raw(
      'SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ?',
      [TABLE],
    );
    return rowsFromRaw(result).map((row) => row.name);
  }
  if (client.includes('mysql')) {
    const result = await knex.raw('SHOW INDEX FROM ??', [TABLE]);
    return [...new Set(rowsFromRaw(result).map((row) => row.Key_name))];
  }
  throw new Error(`Order-email-delivery migration does not support database client ${client}`);
}

async function ensureIndex(knex, columns, name, unique = false) {
  if ((await indexNames(knex)).includes(name)) return;
  await knex.schema.alterTable(TABLE, (table) => {
    if (unique) table.unique(columns, { indexName: name });
    else table.index(columns, name);
  });
}

module.exports = {
  async up(knex) {
    if (!await knex.schema.hasTable(TABLE)) {
      await knex.schema.createTable(TABLE, (table) => {
        table.increments('id').primary();
        table.string('order_number', 128).notNullable();
        table.string('email_type', 64).notNullable();
        table.string('status', 16).notNullable().defaultTo('pending');
        table.integer('attempt_count').notNullable().defaultTo(0);
        table.dateTime('next_attempt_at').nullable();
        table.dateTime('last_attempt_at').nullable();
        table.dateTime('sent_at').nullable();
        table.text('last_error').nullable();
        table.string('claim_token', 128).nullable();
        table.dateTime('created_at').notNullable();
        table.dateTime('updated_at').notNullable();
      });
    }

    await knex.transaction(async (trx) => {
      await ensureIndex(trx, ['order_number', 'email_type'], UNIQUE_INDEX, true);
      await ensureIndex(trx, ['status', 'next_attempt_at'], RETRY_INDEX);
    });
  },

  async down() {
    // Delivery history is intentionally retained across application rollbacks.
  },

  constants: { TABLE, UNIQUE_INDEX, RETRY_INDEX },
};
