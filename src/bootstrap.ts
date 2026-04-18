/**
 * Bootstrap: Import Data on Startup
 * 
 * This runs when Strapi starts and checks if data needs to be imported.
 * Uses database flag to prevent duplicates and checks for existing items before creating.
 */

import type { Core } from '@strapi/strapi';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// Helper function to check if import has already been completed (database flag)
async function checkImportFlag(strapi: Core.Strapi): Promise<boolean> {
  try {
    // Try to find an order-management entry that serves as our import flag
    // We use order-management as it's a system content type
    const flagEntries = await strapi.entityService.findMany('api::order-management.order-management', {
      filters: { name: '__BOOTSTRAP_IMPORT_FLAG__' },
      limit: 1,
    });
    return flagEntries && Array.isArray(flagEntries) && flagEntries.length > 0;
  } catch (error) {
    // If order-management doesn't exist or query fails, fall back to file check
    const dataDir = path.join(process.cwd(), 'database', 'migrations', 'data');
    const importFlagFile = path.join(dataDir, '.imported');
    return fs.existsSync(importFlagFile);
  }
}

// Helper function to set import flag in database
async function setImportFlag(strapi: Core.Strapi): Promise<void> {
  try {
    // Check if flag already exists
    const existing = await strapi.entityService.findMany('api::order-management.order-management', {
      filters: { name: '__BOOTSTRAP_IMPORT_FLAG__' },
      limit: 1,
    });

    if (!existing || !Array.isArray(existing) || existing.length === 0) {
      // Create flag entry
      await strapi.entityService.create('api::order-management.order-management', {
        data: {
          name: '__BOOTSTRAP_IMPORT_FLAG__',
        },
      });
    }
  } catch (error) {
    // Fall back to file system flag if database flag fails
    const dataDir = path.join(process.cwd(), 'database', 'migrations', 'data');
    const importFlagFile = path.join(dataDir, '.imported');
    fs.writeFileSync(importFlagFile, new Date().toISOString());
    console.log('⚠️  Database flag failed, using file system flag as fallback');
  }
}

// Helper function to check if an item already exists based on unique identifier
async function findExistingItem(
  strapi: Core.Strapi,
  contentType: string,
  data: any
): Promise<any | null> {
  try {
    // Define unique identifier lookup strategies for each content type
    const lookupStrategies: Record<string, (data: any) => any> = {
      'api::fabric.fabric': (d) => {
        if (d.productId) return { productId: d.productId };
        if (d.slug) return { slug: d.slug };
        return { name: d.name };
      },
      'api::order.order': (d) => ({ orderNumber: d.orderNumber }),
      'api::brand.brand': (d) => ({ name: d.name }),
      'api::care-instruction.care-instruction': (d) => ({ name: d.name }),
      'api::color-code.color-code': (d) => ({ code: d.code }),
      'api::colour.colour': (d) => ({ name: d.name }),
      'api::curtain-type.curtain-type': (d) => ({ name: d.name }),
      'api::lining.lining': (d) => ({ name: d.name }),
      'api::trimming.trimming': (d) => ({ name: d.name }),
      'api::mechanisation.mechanisation': (d) => ({ name: d.name }),
      'api::pricing-rule.pricing-rule': (d) => ({ name: d.name }),
      'api::blind.blind': (d) => {
        if (d.productId) return { productId: d.productId };
        return { name: d.name };
      },
      'api::cushion.cushion': (d) => {
        if (d.productId) return { productId: d.productId };
        return { name: d.name };
      },
    };

    const strategy = lookupStrategies[contentType];
    if (!strategy) {
      // Default: use name for all other types
      if (!data.name) return null;
      return { name: data.name };
    }

    const filters = strategy(data);
    if (!filters || Object.keys(filters).length === 0) return null;

    const existing = await strapi.entityService.findMany(contentType as any, {
      filters,
      limit: 1,
    });

    if (existing && Array.isArray(existing) && existing.length > 0) {
      return existing[0];
    }

    return null;
  } catch (error) {
    // If lookup fails, return null (will attempt to create)
    console.warn(`⚠️  Error checking for existing ${contentType}:`, error);
    return null;
  }
}

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

  // Check if already imported (database flag)
  const alreadyImported = await checkImportFlag(strapi);
  if (alreadyImported) {
    console.log('✅ Data already imported (database flag exists)');
    return;
  }

  // Check if data file exists
  if (!fs.existsSync(entitiesFile)) {
    console.log('⚠️  No entities.jsonl found. Skipping import.');
    return;
  }

  console.log('🚀 Starting data import on bootstrap...');
  console.log(`📖 Reading entities from: ${entitiesFile}`);
  console.log('🔍 Duplicate detection enabled - will skip existing items');

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
      'api::color-code.color-code',
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
    let totalSkipped = 0;
    let totalFailed = 0;

    for (const contentType of importOrder) {
      const items = entitiesByType[contentType] || [];
      if (items.length === 0) continue;

      console.log(`📦 Processing ${items.length} ${contentType}...`);

      let typeImported = 0;
      let typeSkipped = 0;
      let typeFailed = 0;

      for (const item of items) {
        // Extract data from item.data (entities.jsonl structure: {type, id, data: {...}})
        const entityData = item.data || item;
        const itemId = item.id || item.data?.id || 'unknown';
        
        // Extract identifier for error reporting (before cleaning data)
        const identifier = entityData?.productId || entityData?.orderNumber || entityData?.name || itemId;
        
        try {
          // Remove internal fields that shouldn't be imported
          const { id, documentId, __type, type, createdAt, updatedAt, publishedAt, locale, ...cleanData } = entityData;

          // Validate required fields - skip if name is null/undefined (required for most content types)
          if (cleanData.name === null || cleanData.name === undefined) {
            // Exception: orders don't require name, they use orderNumber
            if (contentType !== 'api::order.order' && !cleanData.orderNumber) {
              typeFailed++;
              totalFailed++;
              console.error(`\n❌ Skipping ${contentType} with null/undefined name (id: ${itemId})`);
              continue;
            }
          }

          // Check if item already exists (duplicate detection)
          const existing = await findExistingItem(strapi, contentType, cleanData);
          
          if (existing) {
            // Item already exists - skip to prevent duplicates
            typeSkipped++;
            totalSkipped++;
            if ((typeSkipped + typeImported) % 50 === 0) {
              process.stdout.write('.');
            }
            continue;
          }

          // Item doesn't exist - create it
          await strapi.entityService.create(contentType as any, {
            data: cleanData,
          });

          typeImported++;
          totalImported++;
          if ((typeImported + typeSkipped) % 50 === 0) {
            process.stdout.write('.');
          }
        } catch (error: any) {
          typeFailed++;
          totalFailed++;
          console.error(`\n❌ Error importing ${contentType} (${identifier}):`, error.message);
        }
      }

      console.log(`\n✅ ${contentType}: ${typeImported} created, ${typeSkipped} skipped, ${typeFailed} failed`);
    }

    console.log(`\n📊 Import Summary:`);
    console.log(`   ✅ Created: ${totalImported}`);
    console.log(`   ⏭️  Skipped (duplicates): ${totalSkipped}`);
    console.log(`   ❌ Failed: ${totalFailed}`);
    console.log(`   📦 Total processed: ${totalImported + totalSkipped + totalFailed}`);

    // Seed default color codes if none exist
    await seedColorCodes(strapi);

    // Set import flag in database to prevent re-import
    await setImportFlag(strapi);
    console.log('✅ Data import complete! Import flag set in database.');

  } catch (error: any) {
    console.error('❌ Error during data import:', error);
  }
};

async function seedColorCodes(strapi: Core.Strapi): Promise<void> {
  try {
    const defaultColorCodes = [
      { code: 'AQ', name: 'Aqua' },
      { code: 'RD', name: 'Red' },
      { code: 'BL', name: 'Blue' },
      { code: 'GR', name: 'Green' },
      { code: 'YL', name: 'Yellow' },
      { code: 'WH', name: 'White' },
      { code: 'BK', name: 'Black' },
      { code: 'GY', name: 'Grey' },
      { code: 'BR', name: 'Brown' },
      { code: 'PK', name: 'Pink' },
      { code: 'PR', name: 'Purple' },
      { code: 'OR', name: 'Orange' },
    ];

    let seedCount = 0;
    for (const colorCode of defaultColorCodes) {
      // Check if code already exists
      const existing = await strapi.entityService.findMany('api::color-code.color-code', {
        filters: { code: colorCode.code },
        limit: 1,
      });

      if (!existing || !Array.isArray(existing) || existing.length === 0) {
        await strapi.entityService.create('api::color-code.color-code', {
          data: colorCode,
        });
        seedCount++;
      }
    }

    if (seedCount > 0) {
      console.log(`✅ Seeded ${seedCount} color codes`);
    }
  } catch (error: any) {
    console.warn('⚠️  Error seeding color codes:', error.message);
  }
}

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

