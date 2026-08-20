'use strict';

const TABLE = 'up_users';
const COLUMN = 'reset_password_token_expires_at';
async function ensureSchema(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  if (!(await knex.schema.hasColumn(TABLE, COLUMN))) {
    await knex.schema.alterTable(TABLE, (table) => table.dateTime(COLUMN).nullable());
  }
}
module.exports = { up: ensureSchema, async down() {}, ensureSchema, constants: { TABLE, COLUMN } };
