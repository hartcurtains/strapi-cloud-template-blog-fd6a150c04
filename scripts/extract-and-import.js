/**
 * Extract Strapi Backup and Import to Cloud via API
 * 
 * This script:
 * 1. Extracts the backup tar.gz file
 * 2. Reads the JSONL files
 * 3. Imports data to Strapi Cloud via API
 * 
 * Prerequisites:
 * - Install: npm install tar fs readline
 * - Get API token from Strapi Cloud admin
 * 
 * Usage:
 * STRAPI_API_TOKEN=your-token node scripts/extract-and-import.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');

// Configuration
const STRAPI_URL = process.env.STRAPI_URL || 'https://celebrated-feast-8b6e91b21c.strapiapp.com';
const API_TOKEN = process.env.STRAPI_API_TOKEN;

if (!API_TOKEN) {
  console.error('❌ Please set STRAPI_API_TOKEN environment variable');
  console.error('   Get your API token from: Strapi Admin → Settings → API Tokens');
  process.exit(1);
}

// Content type to API endpoint mapping
const CONTENT_TYPE_ENDPOINTS = {
  'api::fabric.fabric': '/api/fabrics',
  'api::curtain.curtain': '/api/curtains',
  'api::blind.blind': '/api/blinds',
  'api::cushion.cushion': '/api/cushions',
  'api::brand.brand': '/api/brands',
  'api::order.order': '/api/orders',
  'api::pricing-rule.pricing-rule': '/api/pricing-rules',
  'api::lining.lining': '/api/linings',
  'api::trimming.trimming': '/api/trimmings',
  'api::mechanisation.mechanisation': '/api/mechanisations',
  'api::care-instruction.care-instruction': '/api/care-instructions',
  'api::colour.colour': '/api/colours',
  'api::curtain-type.curtain-type': '/api/curtain-types',
};

// Import order (dependencies first)
const IMPORT_ORDER = [
  'api::brand.brand',
  'api::care-instruction.care-instruction',
  'api::colour.colour',
  'api::curtain-type.curtain-type',
  'api::lining.lining',
  'api::trimming.trimming',
  'api::mechanisation.mechanisation',
  'api::pricing-rule.pricing-rule',
  'api::fabric.fabric',
  'api::curtain.curtain',
  'api::blind.blind',
  'api::cushion.cushion',
  'api::order.order',
];

async function makeRequest(url, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function readJSONL(filePath) {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const entities = [];
  for await (const line of rl) {
    if (line.trim()) {
      try {
        entities.push(JSON.parse(line));
      } catch (e) {
        console.error(`Error parsing line: ${e.message}`);
      }
    }
  }

  return entities;
}

async function importEntity(contentType, entity) {
  const endpoint = CONTENT_TYPE_ENDPOINTS[contentType];
  if (!endpoint) {
    return { success: false, reason: 'Unknown content type' };
  }

  const url = `${STRAPI_URL}${endpoint}`;
  
  try {
    // Remove internal Strapi fields that shouldn't be sent
    const { id, documentId, ...entityData } = entity;
    const cleanEntity = {
      ...entityData,
      // Handle nested objects
      data: entityData.data || entityData,
    };

    const response = await makeRequest(url, 'POST', { data: cleanEntity });
    
    if (response.status === 200 || response.status === 201) {
      return { success: true, data: response.data };
    } else {
      return { 
        success: false, 
        reason: response.data.error?.message || `HTTP ${response.status}` 
      };
    }
  } catch (error) {
    return { success: false, reason: error.message };
  }
}

async function main() {
  const backupFile = path.join(__dirname, '..', 'backup-unencrypted.tar.gz.tar.gz');
  const extractDir = path.join(__dirname, '..', 'extracted-backup');

  console.log('📦 Step 1: Extracting backup file...');
  console.log('   Note: You may need to extract manually using 7-Zip or WinRAR');
  console.log(`   File: ${backupFile}\n`);

  // Check if already extracted
  const entitiesFile = path.join(extractDir, 'entities.jsonl');
  if (!fs.existsSync(entitiesFile)) {
    console.log('⚠️  Please extract the backup file first:');
    console.log(`   1. Extract: ${backupFile}`);
    console.log(`   2. Place contents in: ${extractDir}`);
    console.log(`   3. Make sure entities.jsonl exists\n`);
    return;
  }

  console.log('✅ Backup extracted\n');
  console.log('📖 Step 2: Reading entities...');

  // Group entities by content type
  const entitiesByType = {};
  const allEntities = await readJSONL(entitiesFile);

  for (const entity of allEntities) {
    const contentType = entity.__type || entity.type;
    if (!entitiesByType[contentType]) {
      entitiesByType[contentType] = [];
    }
    entitiesByType[contentType].push(entity);
  }

  console.log(`✅ Found ${allEntities.length} entities across ${Object.keys(entitiesByType).length} content types\n`);

  console.log('🚀 Step 3: Importing to Strapi Cloud...\n');

  let totalImported = 0;
  let totalFailed = 0;

  for (const contentType of IMPORT_ORDER) {
    const entities = entitiesByType[contentType] || [];
    if (entities.length === 0) continue;

    console.log(`📦 Importing ${entities.length} ${contentType}...`);

    for (const entity of entities) {
      const result = await importEntity(contentType, entity);
      
      if (result.success) {
        totalImported++;
        process.stdout.write('.');
      } else {
        totalFailed++;
        console.log(`\n❌ Failed: ${result.reason}`);
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`\n✅ ${contentType}: ${entities.length} processed\n`);
  }

  console.log('\n📊 Import Summary:');
  console.log(`   ✅ Imported: ${totalImported}`);
  console.log(`   ❌ Failed: ${totalFailed}`);
  console.log(`   📦 Total: ${allEntities.length}`);
}

main().catch(console.error);


