'use strict';

const TABLE = 'security_states';
const INDEXES = Object.freeze({
  HASHED_KEY: 'security_states_hashed_key_idx',
  EXPIRY: 'security_states_expires_at_idx',
  ACCOUNT: 'security_states_account_identifier_idx',
  IDENTITY: 'security_states_kind_action_hashed_key_uq',
});

function rowsFromRaw(result) {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0];
  if (Array.isArray(result)) return result;
  return result?.rows || [];
}

async function indexNames(knex) {
  const client = String(knex.client.config.client).toLowerCase();
  if (client.includes('sqlite')) {
    const result = await knex.raw(`PRAGMA index_list('${TABLE}')`);
    return rowsFromRaw(result).map(row => row.name);
  }
  if (client.includes('pg') || client.includes('postgres')) {
    const result = await knex.raw(
      'SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ?',
      [TABLE],
    );
    return rowsFromRaw(result).map(row => row.name);
  }
  if (client.includes('mysql')) {
    const result = await knex.raw('SHOW INDEX FROM ??', [TABLE]);
    const rows = rowsFromRaw(result);
    return [...new Set(rows.map(row => row.Key_name))];
  }
  throw new Error(`Security-state migration does not support database client ${client}`);
}

async function ensureIndex(knex, columns, name, unique = false) {
  if ((await indexNames(knex)).includes(name)) return;
  await knex.schema.alterTable(TABLE, table => {
    if (unique) table.unique(columns, { indexName: name });
    else table.index(columns, name);
  });
}

module.exports = {
  async up(knex) {
    if (!await knex.schema.hasTable(TABLE)) {
      throw new Error('Security-state migration requires the Strapi content-type table first');
    }
    await knex.transaction(async trx => {
      await ensureIndex(trx, ['hashed_key'], INDEXES.HASHED_KEY);
      await ensureIndex(trx, ['expires_at'], INDEXES.EXPIRY);
      await ensureIndex(trx, ['account_identifier'], INDEXES.ACCOUNT);
      await ensureIndex(trx, ['kind', 'action_category', 'hashed_key'], INDEXES.IDENTITY, true);
    });
  },

  async down() {
    // Non-destructive: Strapi owns the table and these indexes are safe to retain.
  },

  constants: { TABLE, INDEXES },
};
