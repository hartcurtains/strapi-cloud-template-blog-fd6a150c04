/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_DATABASE_PATH = path.resolve(__dirname, '..', '.tmp', 'data.db');
const LOCAL_TEST_FLAG = '--allow-proposed-values-for-local-test';
const REQUIRED_COLUMNS = ['allowed_lengths', 'allowed_brackets', 'bracket_requirement'];
const REQUIRED_STRAPI_TABLES = ['curtain_poles', 'strapi_database_schema', 'strapi_core_store_settings'];

// PROPOSED TEST VALUES — NOT BUSINESS-CONFIRMED.
// Local integration testing only. Never reuse these values for cloud or production.
const PROPOSED_TEST_VALUES = Object.freeze({
  businessConfirmed: false,
  purpose: 'local integration testing only',
  lengthsCm: Object.freeze([120, 150, 180, 210, 240, 270, 300]),
  brackets: Object.freeze(['Cup', 'Wall', 'Ceiling']),
  bracketRequirement: 'required',
  allPriceAdjustmentsGbp: 0,
});

const proposedTestLengths = [
  ['length-120cm', 120, '120cm (4ft)'],
  ['length-150cm', 150, '150cm (5ft)'],
  ['length-180cm', 180, '180cm (6ft)'],
  ['length-210cm', 210, '210cm (7ft)'],
  ['length-240cm', 240, '240cm (8ft)'],
  ['length-270cm', 270, '270cm (9ft)'],
  ['length-300cm', 300, '300cm (10ft)'],
].map(([id, length_cm, label]) => ({ id, length_cm, label, price_adjustment: 0 }));

const proposedTestBrackets = [
  ['bracket-cup', 'Cup'],
  ['bracket-wall', 'Wall'],
  ['bracket-ceiling', 'Ceiling'],
].map(([id, name]) => ({ id, name, label: name, price_adjustment: 0 }));

const expectedPoles = new Map([
  ['vwlawi4cspwczrnlgdbca4l4', { name: 'Cone Finial', price: 200 }],
  ['jym965x8cvh0zkceig0dl80i', { name: 'Oakham Wooden Pole Honey', price: 300 }],
]);

const canonical = {
  allowed_lengths: JSON.stringify(proposedTestLengths),
  allowed_brackets: JSON.stringify(proposedTestBrackets),
  bracket_requirement: 'required',
};

function samePath(left, right) {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function resolveAndValidateDatabasePath(databasePath, { allowTestDatabase = false, testMode = false } = {}) {
  const requested = path.resolve(databasePath || DEFAULT_DATABASE_PATH);
  if (!samePath(requested, DEFAULT_DATABASE_PATH) && !(allowTestDatabase && testMode)) {
    throw new Error('Refusing a non-default database. Isolated tests must explicitly enable test mode.');
  }
  const stats = fs.statSync(requested, { throwIfNoEntry: false });
  if (!stats || !stats.isFile()) throw new Error(`Database path is not an existing file: ${requested}`);
  if (!/\.(db|sqlite|sqlite3)$/i.test(requested)) throw new Error('Database path must use a SQLite file extension');
  const header = Buffer.alloc(16);
  const descriptor = fs.openSync(requested, 'r');
  try {
    if (fs.readSync(descriptor, header, 0, 16, 0) !== 16 || header.toString('binary') !== 'SQLite format 3\u0000') {
      throw new Error('Database path is not a valid SQLite database');
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return fs.realpathSync(requested);
}

function assertApplyAuthorization(databasePath, options = {}) {
  const {
    apply = false,
    allowProposedValuesForLocalTest = false,
    allowTestDatabase = false,
    testMode = false,
  } = options;
  if (!apply) return;

  const isDefaultDatabase = samePath(path.resolve(databasePath), path.resolve(DEFAULT_DATABASE_PATH));
  const isIsolatedTestFixture = !isDefaultDatabase && allowTestDatabase && testMode;

  if (allowProposedValuesForLocalTest && !isDefaultDatabase) {
    throw new Error(`${LOCAL_TEST_FLAG} is restricted to hcbDBWIP/.tmp/data.db; custom and production-like paths are refused`);
  }
  if (isIsolatedTestFixture) return;
  if (!isDefaultDatabase) {
    throw new Error('Apply refused: custom and production-like database paths are not supported');
  }
  if (!allowProposedValuesForLocalTest) {
    throw new Error(`Apply refused: proposed test values require both --apply and ${LOCAL_TEST_FLAG}`);
  }
}

function inspectDatabase(db) {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
  const missingTables = REQUIRED_STRAPI_TABLES.filter(table => !tables.has(table));
  if (missingTables.length) throw new Error(`Database is not the expected Strapi database; missing tables: ${missingTables.join(', ')}`);

  const columns = new Set(db.pragma('table_info(curtain_poles)').map(column => column.name));
  const baseColumns = ['id', 'document_id', 'name', 'price', 'published_at'];
  const missingBase = baseColumns.filter(column => !columns.has(column));
  if (missingBase.length) throw new Error(`Unexpected curtain_poles schema; missing columns: ${missingBase.join(', ')}`);
  const missingOptions = REQUIRED_COLUMNS.filter(column => !columns.has(column));
  if (missingOptions.length) {
    throw new Error(`Strapi schema synchronization must create these columns before this data migration: ${missingOptions.join(', ')}`);
  }

  const rows = db.prepare(`SELECT ${[...baseColumns, ...REQUIRED_COLUMNS].join(', ')} FROM curtain_poles ORDER BY id`).all();
  const published = rows.filter(row => row.published_at !== null);
  const unknownPublished = published.filter(row => !expectedPoles.has(row.document_id));
  if (unknownPublished.length) {
    throw new Error(`Ambiguous published pole records: ${unknownPublished.map(row => `${row.id}:${row.name}`).join(', ')}`);
  }

  for (const [documentId, expected] of expectedPoles) {
    const versions = rows.filter(row => row.document_id === documentId);
    if (!versions.length || !versions.some(row => row.published_at !== null)) {
      throw new Error(`Expected published pole ${documentId} is missing`);
    }
    for (const row of versions) {
      if (row.name !== expected.name || Number(row.price) !== expected.price) {
        throw new Error(`Pole ${row.id}:${documentId} no longer matches reviewed name/price evidence`);
      }
      for (const [column, value] of Object.entries(canonical)) {
        const current = row[column];
        if (current !== null && current !== '' && current !== value) {
          throw new Error(`Pole ${row.id}:${documentId} has a conflicting non-empty ${column}`);
        }
      }
    }
  }
  return rows;
}

function runMigration(options = {}) {
  const {
    apply = false,
    allowProposedValuesForLocalTest = false,
    allowTestDatabase = false,
    testMode = false,
    logger = console,
    afterDocumentUpdate,
  } = options;
  const databasePath = resolveAndValidateDatabasePath(options.databasePath || DEFAULT_DATABASE_PATH, { allowTestDatabase, testMode });
  assertApplyAuthorization(databasePath, { apply, allowProposedValuesForLocalTest, allowTestDatabase, testMode });
  const db = new Database(databasePath, { readonly: !apply, fileMustExist: true });
  try {
    const rows = inspectDatabase(db);
    const targetRows = rows.filter(row => expectedPoles.has(row.document_id));
    const unrelatedBefore = rows.filter(row => !expectedPoles.has(row.document_id));

    logger.log('!!! LOCAL TEST DATA ONLY — DO NOT REUSE FOR CLOUD OR PRODUCTION !!!');
    logger.log('PROPOSED TEST VALUES — NOT BUSINESS-CONFIRMED');
    logger.log(`${apply ? 'LOCAL TEST APPLY PLAN' : 'DRY RUN'}: ${databasePath}`);
    for (const row of targetRows) {
      logger.log(`${apply ? 'Will update' : 'Would update'} row ${row.id}, ${row.document_id}, ${row.name}, published=${row.published_at !== null}`);
    }
    logger.log('Proposed test rules: lengths=120/150/180/210/240/270/300cm; brackets=Cup/Wall/Ceiling; requirement=required; all adjustments=GBP 0.00');

    if (!apply) {
      logger.log(`No database changes made. Local integration apply requires --apply and ${LOCAL_TEST_FLAG}.`);
      return { applied: false, databasePath, targetRows: targetRows.length };
    }

    const completedRows = [];
    db.transaction(() => {
      const update = db.prepare(`
        UPDATE curtain_poles
        SET allowed_lengths = ?, allowed_brackets = ?, bracket_requirement = ?
        WHERE document_id = ?
          AND (allowed_lengths IS NULL OR allowed_lengths = '' OR allowed_lengths = ?)
          AND (allowed_brackets IS NULL OR allowed_brackets = '' OR allowed_brackets = ?)
          AND (bracket_requirement IS NULL OR bracket_requirement = '' OR bracket_requirement = ?)
      `);
      for (const documentId of expectedPoles.keys()) {
        update.run(
          canonical.allowed_lengths,
          canonical.allowed_brackets,
          canonical.bracket_requirement,
          documentId,
          canonical.allowed_lengths,
          canonical.allowed_brackets,
          canonical.bracket_requirement
        );
        if (afterDocumentUpdate) afterDocumentUpdate(documentId, db);
        const verified = db.prepare(`SELECT id, allowed_lengths, allowed_brackets, bracket_requirement FROM curtain_poles WHERE document_id = ? ORDER BY id`).all(documentId);
        const expectedCount = targetRows.filter(row => row.document_id === documentId).length;
        if (verified.length !== expectedCount || verified.some(row => REQUIRED_COLUMNS.some(column => row[column] !== canonical[column]))) {
          throw new Error(`Refused partial or unverifiable update for ${documentId}`);
        }
        completedRows.push(...verified.map(row => row.id));
      }

      const unrelatedAfter = db.prepare(`SELECT ${['id', 'document_id', 'name', 'price', 'published_at', ...REQUIRED_COLUMNS].join(', ')} FROM curtain_poles WHERE document_id NOT IN (?, ?) ORDER BY id`).all(...expectedPoles.keys());
      if (JSON.stringify(unrelatedAfter) !== JSON.stringify(unrelatedBefore)) {
        throw new Error('Unrelated curtain-pole rows changed; rolling back');
      }
    })();

    for (const rowId of completedRows) logger.log(`Completed update for curtain_poles row ${rowId}`);
    logger.log('Migration committed and verified successfully.');
    return { applied: true, databasePath, completedRows };
  } finally {
    db.close();
  }
}

function parseArguments(argv) {
  const allowedArguments = new Set(['--apply', LOCAL_TEST_FLAG]);
  const unsupported = argv.filter(argument => !allowedArguments.has(argument));
  if (unsupported.length) {
    throw new Error(`Custom database paths and unsupported arguments are refused: ${unsupported.join(', ')}. This CLI is restricted to hcbDBWIP/.tmp/data.db`);
  }
  return {
    apply: argv.includes('--apply'),
    allowProposedValuesForLocalTest: argv.includes(LOCAL_TEST_FLAG),
    databasePath: DEFAULT_DATABASE_PATH,
    allowTestDatabase: false,
    testMode: false,
  };
}

if (require.main === module) {
  try {
    runMigration(parseArguments(process.argv.slice(2)));
  } catch (error) {
    console.error(`Migration refused: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_DATABASE_PATH,
  LOCAL_TEST_FLAG,
  PROPOSED_TEST_VALUES,
  assertApplyAuthorization,
  canonical,
  expectedPoles,
  inspectDatabase,
  parseArguments,
  resolveAndValidateDatabasePath,
  runMigration,
};
