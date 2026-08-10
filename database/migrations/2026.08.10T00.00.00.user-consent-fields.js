'use strict';

const USER_TABLE = 'up_users';

async function ensureColumns(knex) {
  if (!(await knex.schema.hasTable(USER_TABLE))) {
    return;
  }

  if (!(await knex.schema.hasColumn(USER_TABLE, 'gdpr_consent'))) {
    await knex.schema.alterTable(USER_TABLE, (table) => {
      table.boolean('gdpr_consent').notNullable().defaultTo(false);
    });
  }

  if (!(await knex.schema.hasColumn(USER_TABLE, 'gdpr_consent_date'))) {
    await knex.schema.alterTable(USER_TABLE, (table) => {
      table.dateTime('gdpr_consent_date').nullable();
    });
  }

  if (!(await knex.schema.hasColumn(USER_TABLE, 'terms_accepted'))) {
    await knex.schema.alterTable(USER_TABLE, (table) => {
      table.boolean('terms_accepted').notNullable().defaultTo(false);
    });
  }

  if (!(await knex.schema.hasColumn(USER_TABLE, 'terms_accepted_date'))) {
    await knex.schema.alterTable(USER_TABLE, (table) => {
      table.dateTime('terms_accepted_date').nullable();
    });
  }
}

module.exports = {
  up: ensureColumns,
  // Keep this non-destructive: removing consent history during a rollback is unsafe.
  async down() {},
  ensureColumns,
  constants: { USER_TABLE },
};
