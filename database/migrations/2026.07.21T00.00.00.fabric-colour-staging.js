'use strict';

const IDENTITY_TABLE = 'fabric_colour_identities';
const ASSET_TABLE = 'fabric_colour_assets';
const IDENTITY_INDEX = 'fabric_colour_identities_scope_uq';
const HASH_INDEX = 'fabric_colour_assets_hash_index';

function clientName(knex) {
  return String(knex.client.config.client).toLowerCase();
}

async function hasIndex(knex, table, indexName) {
  const client = clientName(knex);
  if (client.includes('sqlite')) {
    const result = await knex.raw(`PRAGMA index_list('${table}')`);
    const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
    return rows.some((row) => row.name === indexName);
  }
  if (client.includes('pg') || client.includes('postgres')) {
    const result = await knex.raw('SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ? AND indexname = ?', [table, indexName]);
    return (result.rows || result).length > 0;
  }
  if (client.includes('mysql')) {
    const result = await knex.raw('SHOW INDEX FROM ?? WHERE Key_name = ?', [table, indexName]);
    const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
    return rows.length > 0;
  }
  throw new Error(`Fabric colour staging migration does not support database client ${client}`);
}

async function hasColumn(knex, table, columnName) {
  return knex.schema.hasTable(table) && knex.schema.hasColumn(table, columnName);
}

async function ensureIndexes(knex) {
  if (await knex.schema.hasTable(IDENTITY_TABLE) && await hasColumn(knex, IDENTITY_TABLE, 'supplier_colour_code') && !(await hasIndex(knex, IDENTITY_TABLE, IDENTITY_INDEX))) {
    await knex.raw('CREATE UNIQUE INDEX ?? ON ?? (??, ??, ??, ??)', [
      IDENTITY_INDEX, IDENTITY_TABLE, 'supplier', 'fabric_document_id', 'supplier_product_code', 'supplier_colour_code',
    ]);
  }
  if (await knex.schema.hasTable(ASSET_TABLE) && await hasColumn(knex, ASSET_TABLE, 'sha256') && !(await hasIndex(knex, ASSET_TABLE, HASH_INDEX))) {
    await knex.raw('CREATE INDEX ?? ON ?? (??)', [HASH_INDEX, ASSET_TABLE, 'sha256']);
  }
}

module.exports = {
  async up(knex) {
    // Strapi may run project migrations before content-type schema sync. A
    // missing staging table is therefore a safe no-op; schema sync owns table
    // creation and the same index definitions are applied by this migration
    // when the tables are present.
    await ensureIndexes(knex);
  },
  async down() {
    // Non-destructive: Strapi owns the content-type tables and the index protects data integrity.
  },
  ensureIndexes,
  constants: { IDENTITY_TABLE, ASSET_TABLE, IDENTITY_INDEX, HASH_INDEX },
};
