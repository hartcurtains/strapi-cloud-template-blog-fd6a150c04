'use strict';

const path = require('node:path');
const { createStrapi } = require('@strapi/strapi');
const promotion = require('../src/plugins/order-management/server/services/ashley-wilde-promotion');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  let mode = 'dry-run';
  let productCode = null;
  let fabricName = null;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--dry-run') mode = 'dry-run';
    else if (flag === '--apply') mode = 'apply';
    else if (flag === '--product-code') {
      productCode = argv[++index];
      if (!productCode || productCode.startsWith('--')) throw new Error('--product-code requires a value.');
    } else if (flag === '--fabric') {
      fabricName = argv[++index];
      if (!fabricName || fabricName.startsWith('--')) throw new Error('--fabric requires a value.');
    } else throw new Error(`Unknown flag: ${flag}`);
  }

  if (argv.includes('--dry-run') && argv.includes('--apply')) throw new Error('Use exactly one promotion mode: --dry-run or --apply.');
  return { mode, productCode, fabricName };
}

function parseMode(argv) {
  return parseArgs(argv).mode;
}

async function main(argv = process.argv.slice(2)) {
  const { mode, productCode, fabricName } = parseArgs(argv);
  const app = createStrapi({ appDir: PROJECT_ROOT, distDir: path.join(PROJECT_ROOT, 'dist') });
  await app.register();
  await app.bootstrap();
  try {
    const result = await promotion.promoteVerified(app, {
      commit: mode === 'apply',
      supplierProductCode: productCode,
      fabricName,
    });
    console.log(JSON.stringify({ mode, productCode, fabricName, ...result }, null, 2));
    return result;
  } finally {
    await app.destroy();
  }
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { main, parseMode };
