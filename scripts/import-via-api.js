/**
 * Import Strapi Data via API
 * 
 * This script reads your exported data and imports it to Strapi Cloud via API
 * 
 * Usage:
 * 1. First, export your data without encryption:
 *    npx strapi export --file backup.tar.gz --no-encrypt
 * 
 * 2. Extract the backup file
 * 
 * 3. Run this script:
 *    node scripts/import-via-api.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuration - Update these with your Strapi Cloud details
const STRAPI_URL = 'https://celebrated-feast-8b6e91b21c.strapiapp.com';
const API_TOKEN = process.env.STRAPI_API_TOKEN || 'YOUR_API_TOKEN_HERE'; // Get from Strapi Admin → Settings → API Tokens

// Content type mappings
const CONTENT_TYPES = {
  'api::fabric.fabric': '/api/fabrics',
  'api::curtain.curtain': '/api/curtains',
  'api::blind.blind': '/api/blinds',
  'api::cushion.cushion': '/api/cushions',
  'api::brand.brand': '/api/brands',
  'api::order.order': '/api/orders',
  'api::pricing-rule.pricing-rule': '/api/pricing-rules',
  // Add more as needed
};

async function makeRequest(url, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(url, options, (res) => {
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

async function importEntity(contentType, entity) {
  const endpoint = CONTENT_TYPES[contentType];
  if (!endpoint) {
    console.log(`⚠️  Skipping unknown content type: ${contentType}`);
    return;
  }

  const url = `${STRAPI_URL}${endpoint}`;
  
  try {
    // Try to create the entity
    const response = await makeRequest(url, 'POST', { data: entity });
    
    if (response.status === 200 || response.status === 201) {
      console.log(`✅ Created ${contentType}: ${entity.name || entity.id}`);
      return true;
    } else {
      console.log(`❌ Failed to create ${contentType}: ${response.data.error?.message || 'Unknown error'}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error importing ${contentType}:`, error.message);
    return false;
  }
}

async function importData(exportData) {
  console.log('🚀 Starting API-based import...\n');

  const entities = exportData.entities || {};
  let imported = 0;
  let failed = 0;

  // Import in order: brands first, then products, then orders
  const importOrder = [
    'api::brand.brand',
    'api::fabric.fabric',
    'api::curtain.curtain',
    'api::blind.blind',
    'api::cushion.cushion',
    'api::order.order',
  ];

  for (const contentType of importOrder) {
    const items = entities[contentType] || [];
    if (items.length === 0) continue;

    console.log(`\n📦 Importing ${items.length} ${contentType}...`);

    for (const item of items) {
      const success = await importEntity(contentType, item);
      if (success) {
        imported++;
      } else {
        failed++;
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`\n✅ Import complete!`);
  console.log(`   Imported: ${imported}`);
  console.log(`   Failed: ${failed}`);
}

// Main execution
async function main() {
  if (API_TOKEN === 'YOUR_API_TOKEN_HERE') {
    console.error('❌ Please set STRAPI_API_TOKEN environment variable');
    console.error('   Get your API token from: Strapi Admin → Settings → API Tokens');
    process.exit(1);
  }

  // Check if backup file exists (unencrypted)
  const backupPath = path.join(__dirname, '..', 'backup.tar.gz');
  if (!fs.existsSync(backupPath)) {
    console.error('❌ Backup file not found!');
    console.error('   Please export your data first:');
    console.error('   npx strapi export --file backup.tar.gz --no-encrypt');
    process.exit(1);
  }

  console.log('⚠️  Note: This script requires an unencrypted backup file.');
  console.log('   Export with: npx strapi export --file backup.tar.gz --no-encrypt\n');

  // For now, this is a template - you'd need to extract the tar.gz first
  console.log('📝 To use this script:');
  console.log('   1. Export data without encryption');
  console.log('   2. Extract the backup.tar.gz file');
  console.log('   3. Read the entities.json file');
  console.log('   4. Run this script with the extracted data');
}

main().catch(console.error);


