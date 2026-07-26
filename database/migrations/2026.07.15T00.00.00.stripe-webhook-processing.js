'use strict';

const TABLE = 'stripe_webhook_processings';
const EVENT_INDEX = 'stripe_webhook_processings_event_id_uq_pb07';
const ORDER_INDEX = 'stripe_webhook_processings_order_number_uq_pb07';
const STATUS_VALUES = Object.freeze(['processing', 'completed', 'reconciliation_required']);

const REQUIRED_COLUMNS = {
  id: ['integer', 'bigint'],
  document_id: ['varchar', 'character varying', 'text'],
  event_id: ['varchar', 'character varying', 'text'],
  order_number: ['varchar', 'character varying', 'text'],
  status: ['varchar', 'character varying', 'text'],
  claimed_at: ['datetime', 'timestamp', 'timestamp with time zone', 'timestamp without time zone', 'timestamptz'],
  completed_at: ['datetime', 'timestamp', 'timestamp with time zone', 'timestamp without time zone', 'timestamptz'],
  event_type: ['varchar', 'character varying', 'text'],
  claim_token: ['varchar', 'character varying', 'text'],
  created_at: ['datetime', 'timestamp', 'timestamp with time zone', 'timestamp without time zone', 'timestamptz'],
  updated_at: ['datetime', 'timestamp', 'timestamp with time zone', 'timestamp without time zone', 'timestamptz'],
};

function clientName(knex) {
  return String(knex.client.config.client).toLowerCase();
}

function rowsFromRaw(result) {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0];
  if (Array.isArray(result)) return result;
  return result.rows || [];
}

async function indexes(knex) {
  const client = clientName(knex);
  if (client.includes('sqlite')) {
    const list = rowsFromRaw(await knex.raw(`PRAGMA index_list('${TABLE}')`));
    return Promise.all(list.map(async index => ({
      name: index.name,
      unique: Number(index.unique) === 1,
      columns: rowsFromRaw(await knex.raw(`PRAGMA index_info('${String(index.name).replaceAll("'", "''")}')`))
        .sort((a, b) => a.seqno - b.seqno)
        .map(column => column.name),
    })));
  }

  if (client.includes('pg') || client.includes('postgres')) {
    const result = await knex.raw(`
      SELECT i.relname AS name,
             ix.indisunique AS is_unique,
             ix.indisvalid AS is_valid,
             ix.indisready AS is_ready,
             bool_and(ix.indpred IS NULL) AS is_unconditional,
             bool_and(ix.indexprs IS NULL) AS has_no_expressions,
             json_agg(a.attname::text ORDER BY ord.ordinality) AS columns
        FROM pg_class t
        JOIN pg_namespace ns ON ns.oid = t.relnamespace
        JOIN pg_index ix ON ix.indrelid = t.oid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY ord(attnum, ordinality) ON true
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ord.attnum
       WHERE ns.nspname = current_schema()
         AND t.relname = ?
         AND ord.ordinality <= ix.indnkeyatts
       GROUP BY i.relname, ix.indisunique, ix.indisvalid, ix.indisready,
                ix.indnkeyatts
    `, [TABLE]);
    return rowsFromRaw(result).map(index => ({
      name: index.name,
      unique: index.is_unique === true &&
        index.is_valid === true &&
        index.is_ready === true &&
        index.is_unconditional === true &&
        index.has_no_expressions === true,
      columns: index.columns,
    }));
  }

  if (client.includes('mysql')) {
    const result = rowsFromRaw(await knex.raw('SHOW INDEX FROM ??', [TABLE]));
    const grouped = new Map();
    for (const row of result) {
      const name = row.Key_name;
      if (!grouped.has(name)) grouped.set(name, { name, unique: Number(row.Non_unique) === 0, columns: [] });
      grouped.get(name).columns[Number(row.Seq_in_index) - 1] = row.Column_name;
    }
    return [...grouped.values()];
  }

  throw new Error(`PB-07 migration does not support database client ${client}`);
}

function hasUniqueIndex(allIndexes, column) {
  return allIndexes.some(index => index.unique &&
    Array.isArray(index.columns) &&
    index.columns.length === 1 &&
    index.columns[0] === column);
}

function normalizeType(type) {
  return String(type).toLowerCase().replace(/\(.*/, '').trim();
}

async function validateColumns(knex) {
  const info = await knex(TABLE).columnInfo();
  const missing = Object.keys(REQUIRED_COLUMNS).filter(column => !info[column]);
  if (missing.length) {
    throw new Error(`PB-07 migration requires Strapi schema synchronization first; missing columns: ${missing.join(', ')}`);
  }

  const incompatible = [];
  for (const [column, compatibleTypes] of Object.entries(REQUIRED_COLUMNS)) {
    const actualType = normalizeType(info[column].type);
    if (!compatibleTypes.includes(actualType)) incompatible.push(`${column} (${info[column].type})`);
  }
  // Strapi's required-attribute validation does not guarantee database-level NOT NULL
  // constraints, so nullability is intentionally not part of this compatibility check.
  if (incompatible.length) {
    throw new Error(`PB-07 migration found incompatible columns: ${incompatible.join(', ')}`);
  }
}

async function validateStatuses(knex) {
  const invalid = await knex(TABLE)
    .select('status')
    .whereNotIn('status', STATUS_VALUES)
    .distinct();
  if (invalid.length) {
    throw new Error(`PB-07 migration found incompatible lifecycle statuses: ${invalid.map(row => row.status).join(', ')}`);
  }
}

async function ensureUniqueIndex(knex, column, name) {
  if (hasUniqueIndex(await indexes(knex), column)) return;
  await knex.raw('CREATE UNIQUE INDEX ?? ON ?? (??)', [name, TABLE, column]);
  if (!hasUniqueIndex(await indexes(knex), column)) {
    throw new Error(`PB-07 migration failed to verify unique index for ${column}`);
  }
}

module.exports = {
  async up(knex) {
    if (!await knex.schema.hasTable(TABLE)) {
      throw new Error('PB-07 migration requires the Strapi content-type table first; deploy with schema synchronization before running this migration');
    }

    await knex.transaction(async trx => {
      await validateColumns(trx);
      await validateStatuses(trx);
      await ensureUniqueIndex(trx, 'event_id', EVENT_INDEX);
      await ensureUniqueIndex(trx, 'order_number', ORDER_INDEX);
    });
  },

  async down() {
    // Intentionally non-destructive. Strapi owns the table and this migration cannot
    // prove across deployments that a deterministic equivalent index was not pre-existing.
  },

  constants: { TABLE, EVENT_INDEX, ORDER_INDEX, STATUS_VALUES },
};
