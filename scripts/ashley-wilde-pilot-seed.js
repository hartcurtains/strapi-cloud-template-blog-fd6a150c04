'use strict';

const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const targetPath = path.join(projectRoot, '.tmp', 'ashley-wilde-pilot.db');
const selectedDocumentIds = [
  'okwshze5maa8f02rmu0v5azq', 'nc6cfzbtg6ey0b4lq7l1r6w7', 'zqlg5sc4srvnh7dgseu27har',
  'rb4rpq09c7lw7hhw3f28hsdn', 'kr8nc7336fp0uhu5qxm6e74x', 'z8zirmrs1sd1a29g4xytlll9',
];

const catalogTables = new Set([
  'brands', 'fabrics', 'fabrics_brand_lnk', 'colours', 'color_codes', 'colours_fabrics_lnk',
  'care_instructions', 'care_instructions_fabrics_lnk', 'i18n_locale',
]);
const adminTables = new Set(['admin_permissions', 'admin_permissions_role_lnk', 'admin_roles', 'admin_users', 'admin_users_roles_lnk']);
const schemaTables = new Set(['strapi_database_schema', 'strapi_migrations', 'strapi_migrations_internal', 'strapi_core_store_settings']);

function seedPilotDatabase(options = {}) {
  void options;
  throw new Error('Ashley Wilde pilot database seeding is disabled. Use the Strapi staging importer and document services; direct SQLite application writes are not supported.');
}

if (require.main === module) {
  try { console.log(JSON.stringify(seedPilotDatabase({ force: process.argv.includes('--force') }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { seedPilotDatabase, selectedDocumentIds, sourcePath, targetPath };
