'use strict';

const USER_TABLE = 'up_users';
const EXPIRY_COLUMN = 'confirmation_token_expires_at';
const LOOKUP_INDEX = 'up_users_confirmation_token_expiry_idx';

async function ensureSchema(knex) {
  if (!(await knex.schema.hasTable(USER_TABLE))) return;
  if (!(await knex.schema.hasColumn(USER_TABLE, EXPIRY_COLUMN))) {
    await knex.schema.alterTable(USER_TABLE, (table) => table.dateTime(EXPIRY_COLUMN).nullable());
  }

  // A compound index keeps redemption cheap without making nullable token
  // values subject to database-specific UNIQUE semantics.
  const client = String(knex.client.config.client).toLowerCase();
  let exists = false;
  if (client.includes('sqlite')) {
    const rows = await knex.raw(`PRAGMA index_list('${USER_TABLE}')`);
    exists = (Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows).some((row) => row.name === LOOKUP_INDEX);
  } else if (client.includes('pg') || client.includes('postgres')) {
    const result = await knex.raw('SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ? AND indexname = ?', [USER_TABLE, LOOKUP_INDEX]);
    exists = (result.rows || result).length > 0;
  } else if (client.includes('mysql')) {
    const result = await knex.raw('SHOW INDEX FROM ?? WHERE Key_name = ?', [USER_TABLE, LOOKUP_INDEX]);
    const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
    exists = rows.length > 0;
  } else {
    throw new Error(`Confirmation-token migration does not support database client ${client}`);
  }
  if (!exists) {
    await knex.schema.alterTable(USER_TABLE, (table) => {
      table.index(['confirmation_token', EXPIRY_COLUMN], LOOKUP_INDEX);
    });
  }
}

module.exports = {
  up: ensureSchema,
  async down() {},
  ensureSchema,
  constants: { USER_TABLE, EXPIRY_COLUMN, LOOKUP_INDEX },
};
