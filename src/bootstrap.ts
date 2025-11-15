/**
 * Bootstrap: Import Data on Startup
 * 
 * This runs when Strapi starts and checks if data needs to be imported.
 * Only runs once (checks for a flag file).
 */

import type { Core } from '@strapi/strapi';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

export default async ({ strapi }: { strapi: Core.Strapi }) => {
  // Wait a bit for Strapi to be fully ready
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Only run in production (Strapi Cloud)
  if (process.env.NODE_ENV !== 'production') {
    console.log('⏭️  Skipping data import (not in production)');
    return;
  }

  const dataDir = path.join(process.cwd(), 'database', 'migrations', 'data');
  const entitiesFile = path.join(dataDir, 'entities.jsonl');
  const importFlagFile = path.join(dataDir, '.imported');

  // Check if already imported
  if (fs.existsSync(importFlagFile)) {
    console.log('✅ Data already imported (flag file exists)');
    return;
  }

  // Check if data file exists
  if (!fs.existsSync(entitiesFile)) {
    console.log('⚠️  No entities.jsonl found. Skipping import.');
    return;
  }

  console.log('🚀 Starting data import on bootstrap...');
  console.log(`📖 Reading entities from: ${entitiesFile}`);

  try {
    // Read entities
    const entities = await readJSONL(entitiesFile);
    console.log(`✅ Found ${entities.length} entities to import`);

    // Group by content type
    const entitiesByType: Record<string, any[]> = {};
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

    let totalImported = 0;
    let totalFailed = 0;

    for (const contentType of importOrder) {
      const items = entitiesByType[contentType] || [];
      if (items.length === 0) continue;

      console.log(`📦 Importing ${items.length} ${contentType}...`);

      for (const item of items) {
        try {
          // Remove internal fields
          const { id, documentId, __type, type, ...entityData } = item;

          // Use Strapi's entity service
          await strapi.entityService.create(contentType as any, {
            data: entityData,
          });

          totalImported++;
          if (totalImported % 10 === 0) {
            process.stdout.write('.');
          }
        } catch (error: any) {
          totalFailed++;
          console.error(`\n❌ Error importing ${contentType}:`, error.message);
        }
      }

      console.log(`\n✅ ${contentType}: ${items.length} processed`);
    }

    console.log(`\n📊 Import Summary:`);
    console.log(`   ✅ Imported: ${totalImported}`);
    console.log(`   ❌ Failed: ${totalFailed}`);

    // Create flag file to prevent re-import
    fs.writeFileSync(importFlagFile, new Date().toISOString());
    console.log('✅ Data import complete! Flag file created.');

  } catch (error: any) {
    console.error('❌ Error during data import:', error);
  }
};

async function readJSONL(filePath: string): Promise<any[]> {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const entities: any[] = [];
  for await (const line of rl) {
    if (line.trim()) {
      try {
        entities.push(JSON.parse(line));
      } catch (e) {
        console.error(`Error parsing line: ${e}`);
      }
    }
  }

  return entities;
}

