/**
 * Migration: Import Local Data
 * 
 * This migration runs on Strapi Cloud deployment to import data from
 * the extracted backup files in the repository.
 * 
 * The data files should be in: database/migrations/data/
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

module.exports = {
  async up(knex) {
    console.log('🚀 Starting data import migration...');
    
    const dataDir = path.join(__dirname, 'data');
    
    // Check if data directory exists
    if (!fs.existsSync(dataDir)) {
      console.log('⚠️  No data directory found. Skipping import.');
      return;
    }

    const entitiesFile = path.join(dataDir, 'entities.jsonl');
    
    if (!fs.existsSync(entitiesFile)) {
      console.log('⚠️  No entities.jsonl found. Skipping import.');
      return;
    }

    console.log('📖 Reading entities from backup...');
    
    // Read entities from JSONL file
    const entities = await readJSONL(entitiesFile);
    console.log(`✅ Found ${entities.length} entities to import`);

    // Group by content type
    const entitiesByType = {};
    for (const entity of entities) {
      const contentType = entity.__type || entity.type;
      if (!entitiesByType[contentType]) {
        entitiesByType[contentType] = [];
      }
      entitiesByType[contentType].push(entity);
    }

    // Import order (dependencies first)
    const importOrder = [
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

    const strapi = strapi; // Access Strapi instance
    
    for (const contentType of importOrder) {
      const items = entitiesByType[contentType] || [];
      if (items.length === 0) continue;

      console.log(`📦 Importing ${items.length} ${contentType}...`);

      for (const item of items) {
        try {
          // Remove internal fields
          const { id, documentId, __type, type, ...entityData } = item;
          
          // Use Strapi's entity service to create
          await strapi.entityService.create(contentType, {
            data: entityData,
          });
          
          process.stdout.write('.');
        } catch (error) {
          console.error(`\n❌ Error importing ${contentType}:`, error.message);
        }
      }
      
      console.log(`\n✅ ${contentType} imported`);
    }

    console.log('✅ Data import migration complete!');
  },

  async down(knex) {
    // Rollback: Delete imported data
    console.log('⚠️  Rolling back data import...');
    // Implementation depends on your needs
  },
};

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

