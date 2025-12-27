/**
 * order-management controller
 */

import { factories } from '@strapi/strapi';

// Simple in-memory cache for product lookup maps (cleared on server restart)
const productLookupCache = new Map<string, {
  maps: {
    productIdMap: Map<string, any>;
    slugMap: Map<string, any>;
    nameMap: Map<string, any>;
    firstNameMap: Map<string, any[]>;
  };
  timestamp: number;
}>();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

export default factories.createCoreController('api::order-management.order-management', ({ strapi }) => ({
  // Simple test endpoint
  async test(ctx) {
    ctx.body = { message: 'Order Management API is working!' };
  },

  // Bulk import products using Strapi's internal services
  async bulkImport(ctx) {
    try {
      const { data: transformedDataset } = ctx.request.body;
      
      console.log('🔥🔥🔥 FORCE RESTART TEST - NEW CODE IS LOADED! 🔥🔥🔥');
      console.log('🚀 NEW UPSERT LOGIC - Starting server-side bulk import...');
      console.log('🎯 NEW RESULT STRUCTURE: {created, updated, skipped, failed}');
      
      const results = {
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        errors: [],
        autoCreationSummary: {
          brandsCreated: 0,
          brandsFailed: 0,
          careInstructionsCreated: 0,
          careInstructionsFailed: 0,
          totalBrandsInMap: 0,
          totalCareInstructionsInMap: 0
        }
      };

      // Define content types for each product type
      const contentTypes = {
        fabrics: 'api::fabric.fabric',
        curtains: 'api::curtain.curtain',
        blinds: 'api::blind.blind',
        cushions: 'api::cushion.cushion',
        linings: 'api::lining.lining',
        trimmings: 'api::trimming.trimming',
        mechanisations: 'api::mechanisation.mechanisation',
        brands: 'api::brand.brand',
        care_instructions: 'api::care-instruction.care-instruction',
        pricing_rules: 'api::pricing-rule.pricing-rule'
      };

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 0: Auto-create missing brands and care instructions from fabrics
      // ═══════════════════════════════════════════════════════════════════
      if (transformedDataset.fabrics && Array.isArray(transformedDataset.fabrics) && transformedDataset.fabrics.length > 0) {
        console.log('🔧 Phase 0: Auto-creating missing brands and care instructions...');
        
        // Collect unique brand names from fabrics
        const brandNamesToCreate = new Set<string>();
        const careInstructionNamesToCreate = new Set<string>();
        
        transformedDataset.fabrics.forEach((fabric: any) => {
          if (fabric.brand_name) {
            brandNamesToCreate.add(fabric.brand_name.toString().trim());
          }
          if (fabric.care_instruction_names) {
            const names = fabric.care_instruction_names.toString().split(',').map((n: string) => n.trim()).filter(Boolean);
            names.forEach((name: string) => careInstructionNamesToCreate.add(name));
          }
        });
        
        console.log(`📋 Found ${brandNamesToCreate.size} unique brand names to check`);
        console.log(`📋 Found ${careInstructionNamesToCreate.size} unique care instruction names to check`);
        
        // Check which brands exist and create missing ones
        for (const brandName of brandNamesToCreate) {
          try {
            const existingBrands = await strapi.entityService.findMany('api::brand.brand' as any, {
              filters: { name: { $eqi: brandName } }
            }) as any[];
            
            if (!existingBrands || existingBrands.length === 0) {
              // Create the brand
              const createdBrand = await strapi.entityService.create('api::brand.brand' as any, {
                data: {
                  name: brandName,
                  description: `Auto-created brand: ${brandName}`
                }
              });
              console.log(`✅ Auto-created brand: "${brandName}" (ID: ${createdBrand.id})`);
              results.autoCreationSummary.brandsCreated++;
            } else {
              console.log(`⏭️ Brand already exists: "${brandName}" (ID: ${existingBrands[0].id})`);
            }
            results.autoCreationSummary.totalBrandsInMap++;
          } catch (error: any) {
            console.error(`❌ Failed to auto-create brand "${brandName}":`, error.message);
            results.autoCreationSummary.brandsFailed++;
            results.errors.push({
              type: 'auto_create_error',
              sheet: 'brands',
              message: `Failed to auto-create brand: ${brandName}`,
              error: error.message
            });
          }
        }
        
        // Check which care instructions exist and create missing ones
        for (const careName of careInstructionNamesToCreate) {
          try {
            const existingCareInstructions = await strapi.entityService.findMany('api::care-instruction.care-instruction' as any, {
              filters: { name: { $eqi: careName } }
            }) as any[];
            
            if (!existingCareInstructions || existingCareInstructions.length === 0) {
              // Create the care instruction
              const createdCareInstruction = await strapi.entityService.create('api::care-instruction.care-instruction' as any, {
                data: {
                  name: careName,
                  description: `Auto-created care instruction: ${careName}`
                }
              });
              console.log(`✅ Auto-created care instruction: "${careName}" (ID: ${createdCareInstruction.id})`);
              results.autoCreationSummary.careInstructionsCreated++;
            } else {
              console.log(`⏭️ Care instruction already exists: "${careName}" (ID: ${existingCareInstructions[0].id})`);
            }
            results.autoCreationSummary.totalCareInstructionsInMap++;
          } catch (error: any) {
            console.error(`❌ Failed to auto-create care instruction "${careName}":`, error.message);
            results.autoCreationSummary.careInstructionsFailed++;
            results.errors.push({
              type: 'auto_create_error',
              sheet: 'care_instructions',
              message: `Failed to auto-create care instruction: ${careName}`,
              error: error.message
            });
          }
        }
        
        console.log('✅ Phase 0 completed: Auto-creation of missing brands and care instructions');
      }
      // ═══════════════════════════════════════════════════════════════════

      // Import order: brands, linings, trimmings, mechanisations, pricing_rules, care_instructions first, then fabrics, then dependent products
      const importOrder = ['brands', 'linings', 'trimmings', 'mechanisations', 'pricing_rules', 'care_instructions', 'fabrics', 'curtains', 'blinds', 'cushions'];

      for (const productType of importOrder) {
        if (!transformedDataset[productType] || transformedDataset[productType].length === 0) {
          console.log(`⏭️ Skipping ${productType} - no data`);
          continue;
        }

        console.log(`📤 Importing ${productType}...`);
        const contentType = contentTypes[productType];
        
        for (let i = 0; i < transformedDataset[productType].length; i++) {
          try {
            const item = transformedDataset[productType][i];
            
            // Remove fields that Strapi auto-generates (causes validation errors)
            delete item.createdAt;
            delete item.updatedAt;
            delete item.publishedAt;
            delete item.id;
            delete item.documentId;
            
            // Handle martindale: leave empty if null
            if (item.martindale === null || item.martindale === undefined) {
              delete item.martindale;
            }
            
            // Handle collections array -> collection field conversion
            // JSON has "collections": ["Tatton Park"] but DB field is "collection" (singular, short text)
            if (item.collections !== undefined) {
              if (Array.isArray(item.collections) && item.collections.length > 0) {
                // Take the first collection value from array
                item.collection = item.collections[0].toString().trim();
              } else if (typeof item.collections === 'string' && item.collections.trim()) {
                // If it's already a string, use it directly
                item.collection = item.collections.trim();
              }
              // Remove the collections array field (always remove it after conversion)
              delete item.collections;
            }
            // If collection field already exists (from Excel), it will be preserved
            
            // Ensure required fields exist
            if (!item.name) {
              throw new Error('Name is required');
            }
            
            // Universal relation converter - converts all *_names fields to IDs
            async function convertRelationNamesToIds(item: any, productType: string) {
              const relationMappings = {
                brand_name: { field: 'brand', contentType: 'api::brand.brand', searchField: 'name', type: 'oneToOne' },
                fabric_names: { field: 'fabrics', contentType: 'api::fabric.fabric', searchField: 'name', type: 'manyToMany' },
                curtain_names: { field: 'curtains', contentType: 'api::curtain.curtain', searchField: 'name', type: 'manyToMany' },
                blind_names: { field: 'blinds', contentType: 'api::blind.blind', searchField: 'name', type: 'manyToMany' },
                cushion_names: { field: 'cushions', contentType: 'api::cushion.cushion', searchField: 'name', type: 'manyToMany' },
                lining_names: { field: 'linings', contentType: 'api::lining.lining', searchField: 'liningType', type: 'manyToMany' },
                trimming_names: { field: 'trimmings', contentType: 'api::trimming.trimming', searchField: 'type', type: 'manyToMany' },
                mechanisation_names: { field: 'mechanisations', contentType: 'api::mechanisation.mechanisation', searchField: 'type', type: 'manyToMany' },
                curtain_type_name: { field: 'curtain_type', contentType: 'api::curtain-type.curtain-type', searchField: 'name', type: 'oneToOne' },
                blind_type_name: { field: 'blind_type', contentType: 'api::blind-type.blind-type', searchField: 'name', type: 'oneToOne' },
                cushion_type_name: { field: 'cushion_type', contentType: 'api::cushion-type.cushion-type', searchField: 'name', type: 'oneToOne' },
                pricing_rules_names: { field: 'pricing_rules', contentType: 'api::pricing-rule.pricing-rule', searchField: 'name', type: 'manyToMany' },
                care_instruction_names: { field: 'care_instructions', contentType: 'api::care-instruction.care-instruction', searchField: 'name', type: 'manyToMany' }
              };

              for (const [nameField, config] of Object.entries(relationMappings)) {
                if (item[nameField]) {
                  const names = item[nameField].split(',').map(n => n.trim()).filter(Boolean);
                  const ids = [];
                  
                  for (const name of names) {
                    const found = await strapi.entityService.findMany(config.contentType as any, {
                      filters: { [config.searchField]: name }
              }) as any[];
                    
                    if (found && found.length > 0) {
                      ids.push(found[0].id);
                      console.log(`🔗 Backend: Linked ${productType} "${item.name}" → ${nameField} "${name}" (ID: ${found[0].id})`);
                    } else {
                      console.warn(`⚠️ ${nameField} "${name}" not found for ${productType} "${item.name}"`);
                    }
                  }
                  
                  // Set the relation field with IDs (single ID for oneToOne, array for manyToMany)
                  if (ids.length > 0) {
                    if (config.type === 'oneToOne') {
                      item[config.field] = ids[0];  // Single ID
                      console.log(`🔗 Backend: Set ${config.field} = ${ids[0]} (oneToOne) for ${productType} "${item.name}"`);
                    } else {
                      item[config.field] = ids;  // Array of IDs
                      console.log(`🔗 Backend: Set ${config.field} = [${ids.join(', ')}] (manyToMany) for ${productType} "${item.name}"`);
                    }
                    delete item[nameField];
                  } else {
                    // NO IDS FOUND - Don't set the field at all (preserve existing relations)
                    console.log(`⚠️ Backend: No IDs found for ${nameField}, preserving existing ${config.field} for ${productType} "${item.name}"`);
                    delete item[nameField];
                  }
                }
              }
            }
            
            // Convert all relation names to IDs
            await convertRelationNamesToIds(item, productType);
            
            // DEBUG: Log what brand ID was set for fabrics
            if (productType === 'fabrics' && item.brand) {
              console.log(`✅ Backend: Brand ID ${item.brand} set for fabric "${item.name}"`);
            } else if (productType === 'fabrics') {
              console.log(`⚠️ Backend: No brand ID for fabric "${item.name}"`);
            }
            
            // DEBUG: Log all relation fields set
            console.log(`🔍 Backend: Item data for ${productType} "${item.name}":`, {
              brand: item.brand,
              curtains: item.curtains,
              blinds: item.blinds,
              cushions: item.cushions,
              care_instructions: item.care_instructions
            });
            
            // Implement UPSERT logic: update if exists and has changes, create if doesn't exist, skip if no changes
            let upsertedItem;
            let wasSkipped = false;
            
            if (productType === 'brands') {
              // For brands, check by name
              const existingBrand = await strapi.entityService.findMany('api::brand.brand' as any, {
                filters: { name: item.name },
                populate: '*'
                  }) as any[];
              
              if (existingBrand && existingBrand.length > 0) {
                const existing = existingBrand[0];
                
                // Compare relevant fields to see if there are changes
                const hasChanges = (
                  (item.description !== undefined && item.description !== existing.description) ||
                  (item.thumbnail !== undefined && item.thumbnail !== existing.thumbnail) ||
                  // Check if fabrics relation has changed
                  (item.fabrics !== undefined && JSON.stringify(item.fabrics?.sort() || []) !== JSON.stringify(existing.fabrics?.map(f => f.id).sort() || []))
                );
                
                if (hasChanges) {
                  // Update existing brand
                  upsertedItem = await strapi.entityService.update('api::brand.brand' as any, existing.id, {
                    data: item
                  });
                  console.log(`🔄 Updated existing brand: ${item.name}`);
                  results.updated++;
                } else {
                  // Skip - no changes needed
                  console.log(`⏭️ Skipped brand (no changes): ${item.name}`);
                  wasSkipped = true;
                  results.skipped++;
                }
              } else {
                // Create new brand
                upsertedItem = await strapi.entityService.create('api::brand.brand' as any, {
                  data: item
                });
                console.log(`➕ Created new brand: ${item.name}`);
                results.created++;
              }
            } else if (productType === 'fabrics') {
              // NOTE: brand_name conversion is now handled by universal convertRelationNamesToIds above
              
              // Add default values for missing required fields
              const defaults = {
                colour: item.colour || 'Blue',
                pattern: item.pattern || 'Solid',
                composition: item.composition || '100% Cotton',
                price_per_metre: item.price_per_metre || 25.50,
                patternRepeat_cm: item.patternRepeat_cm || 20,
                usableWidth_cm: item.usableWidth_cm || 140,
                // martindale is NOT set to a default - leave it empty if null/undefined
                availability: item.availability || 'in_stock',
                is_featured: item.is_featured !== undefined ? item.is_featured : false,
                is_curtain: item.is_curtain !== undefined ? item.is_curtain : false
              };
              
              // Apply defaults for missing fields (excluding martindale)
              Object.keys(defaults).forEach(key => {
                if (item[key] === undefined || item[key] === null || item[key] === '') {
                  item[key] = defaults[key];
                  console.log(`🔧 Applied default ${key}: ${defaults[key]} for fabric "${item.name}"`);
                }
              });
              
              // Handle martindale separately - don't set default, leave empty if null/undefined
              if (item.martindale === null || item.martindale === undefined || item.martindale === '') {
                delete item.martindale;
              }
              
              // Generate productId and slug if missing
              if (!item.productId) {
                const timestamp = Date.now().toString().slice(-4);
                const namePrefix = item.name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase();
                item.productId = `FAB-${namePrefix}-${timestamp}`;
                console.log(`🔧 Auto-generated productId: ${item.productId} for fabric "${item.name}"`);
              }
              
              if (!item.slug) {
                const timestamp = Date.now().toString().slice(-4);
                const nameSlug = item.name.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 20);
                item.slug = `${nameSlug}-${timestamp}`;
                console.log(`🔧 Auto-generated slug: ${item.slug} for fabric "${item.name}"`);
              }
              
              // For fabrics, check by name (since productId is auto-generated)
              const existingFabric = await strapi.entityService.findMany('api::fabric.fabric' as any, {
                filters: { name: item.name },
                populate: '*'
              }) as any[];
              
              if (existingFabric && existingFabric.length > 0) {
                const existing = existingFabric[0];
                
                // PRESERVE EXISTING RELATIONS: If relation fields are undefined, keep existing values
                if (item.brand === undefined && existing.brand) {
                  item.brand = existing.brand.id;
                  console.log(`🔄 Preserving existing brand: ${existing.brand.name} (ID: ${existing.brand.id}) for fabric "${item.name}"`);
                }
                if (item.curtains === undefined && existing.curtains) {
                  item.curtains = existing.curtains.map(c => c.id);
                  console.log(`🔄 Preserving existing curtains: [${existing.curtains.map(c => c.name).join(', ')}] for fabric "${item.name}"`);
                }
                if (item.blinds === undefined && existing.blinds) {
                  item.blinds = existing.blinds.map(b => b.id);
                  console.log(`🔄 Preserving existing blinds: [${existing.blinds.map(b => b.name).join(', ')}] for fabric "${item.name}"`);
                }
                if (item.cushions === undefined && existing.cushions) {
                  item.cushions = existing.cushions.map(c => c.id);
                  console.log(`🔄 Preserving existing cushions: [${existing.cushions.map(c => c.name).join(', ')}] for fabric "${item.name}"`);
                }
                if (item.care_instructions === undefined && existing.care_instructions) {
                  item.care_instructions = existing.care_instructions.map(ci => ci.id);
                  console.log(`🔄 Preserving existing care instructions: [${existing.care_instructions.map(ci => ci.name).join(', ')}] for fabric "${item.name}"`);
                }
                
                // Force-update availability if it is present in the import row
                const availabilitySpecified = Object.prototype.hasOwnProperty.call(item, 'availability');
                if (availabilitySpecified) {
                  console.log(`🔁 Availability specified for "${item.name}": existing='${existing.availability}' → incoming='${item.availability}'`);
                }

                // Compare relevant fields to see if there are changes (including relations)
                let hasChanges = (
                  (item.description !== undefined && item.description !== existing.description) ||
                  (item.brand !== undefined && item.brand !== existing.brand?.id) ||
                  (item.colour !== undefined && item.colour !== existing.colour) ||
                  (item.pattern !== undefined && item.pattern !== existing.pattern) ||
                  (item.composition !== undefined && item.composition !== existing.composition) ||
                  (item.price_per_metre !== undefined && item.price_per_metre !== existing.price_per_metre) ||
                  (item.availability !== undefined && item.availability !== existing.availability) ||
                  (item.is_featured !== undefined && item.is_featured !== existing.is_featured) ||
                  (item.featured_until !== undefined && item.featured_until !== existing.featured_until) ||
                  (item.patternRepeat_cm !== undefined && item.patternRepeat_cm !== existing.patternRepeat_cm) ||
                  (item.usableWidth_cm !== undefined && item.usableWidth_cm !== existing.usableWidth_cm) ||
                  (item.martindale !== undefined && item.martindale !== existing.martindale) ||
                  // Check if any relations have changed (now properly preserved)
                  (item.curtains !== undefined && JSON.stringify(item.curtains.sort()) !== JSON.stringify(existing.curtains?.map(c => c.id).sort() || [])) ||
                  (item.blinds !== undefined && JSON.stringify(item.blinds.sort()) !== JSON.stringify(existing.blinds?.map(b => b.id).sort() || [])) ||
                  (item.cushions !== undefined && JSON.stringify(item.cushions.sort()) !== JSON.stringify(existing.cushions?.map(c => c.id).sort() || [])) ||
                  (item.care_instructions !== undefined && JSON.stringify(item.care_instructions.sort()) !== JSON.stringify(existing.care_instructions?.map(ci => ci.id).sort() || []))
                );

                // If availability was provided, force an update even if equal (to guarantee sync)
                if (!hasChanges && availabilitySpecified) {
                  console.log(`🔁 Forcing update for availability on fabric "${item.name}"`);
                  hasChanges = true;
                }
                
                if (hasChanges) {
                  // Update existing fabric
                  upsertedItem = await strapi.entityService.update('api::fabric.fabric' as any, existing.id, {
                    data: item
                  });
                  console.log(`🔄 Updated existing fabric: ${item.name}`);
                  results.updated++;
                } else {
                  // Skip - no changes needed
                  console.log(`⏭️ Skipped fabric (no changes): ${item.name}`);
                  wasSkipped = true;
                  results.skipped++;
                }
              } else {
                // Create new fabric
                upsertedItem = await strapi.entityService.create('api::fabric.fabric' as any, {
                  data: item
                });
                console.log(`➕ Created new fabric: ${item.name}`);
                results.created++;
              }
            } else {
              // For other types, use name as unique identifier
              const existingItem = await strapi.entityService.findMany(contentType as any, {
                filters: { name: item.name },
                populate: '*'
                }) as any[];
              
              if (existingItem && existingItem.length > 0) {
                const existing = existingItem[0];
                
                // Compare relevant fields to see if there are changes
                const hasChanges = (
                  (item.description !== undefined && item.description !== existing.description) ||
                  (item.price_per_metre !== undefined && item.price_per_metre !== existing.price_per_metre) ||
                  (item.availability !== undefined && item.availability !== existing.availability) ||
                  (item.type !== undefined && item.type !== existing.type) ||
                  (item.liningType !== undefined && item.liningType !== existing.liningType) ||
                  (item.product_type !== undefined && item.product_type !== existing.product_type) ||
                  (item.formula !== undefined && JSON.stringify(item.formula) !== JSON.stringify(existing.formula)) ||
                  // Check relation fields - these are the key changes we need to detect
                  (item.fabrics !== undefined && JSON.stringify(item.fabrics?.sort() || []) !== JSON.stringify(existing.fabrics?.map(f => f.id).sort() || [])) ||
                  (item.linings !== undefined && JSON.stringify(item.linings?.sort() || []) !== JSON.stringify(existing.linings?.map(l => l.id).sort() || [])) ||
                  (item.trimmings !== undefined && JSON.stringify(item.trimmings?.sort() || []) !== JSON.stringify(existing.trimmings?.map(t => t.id).sort() || [])) ||
                  (item.mechanisations !== undefined && JSON.stringify(item.mechanisations?.sort() || []) !== JSON.stringify(existing.mechanisations?.map(m => m.id).sort() || [])) ||
                  (item.curtain_type !== undefined && item.curtain_type !== existing.curtain_type?.id) ||
                  (item.blind_type !== undefined && item.blind_type !== existing.blind_type?.id) ||
                  (item.cushion_type !== undefined && item.cushion_type !== existing.cushion_type?.id) ||
                  (item.curtains !== undefined && JSON.stringify(item.curtains?.sort() || []) !== JSON.stringify(existing.curtains?.map(c => c.id).sort() || [])) ||
                  (item.blinds !== undefined && JSON.stringify(item.blinds?.sort() || []) !== JSON.stringify(existing.blinds?.map(b => b.id).sort() || [])) ||
                  (item.cushions !== undefined && JSON.stringify(item.cushions?.sort() || []) !== JSON.stringify(existing.cushions?.map(c => c.id).sort() || [])) ||
                  (item.pricing_rules !== undefined && JSON.stringify(item.pricing_rules?.sort() || []) !== JSON.stringify(existing.pricing_rules?.map(p => p.id).sort() || [])) ||
                  (item.care_instructions !== undefined && JSON.stringify(item.care_instructions?.sort() || []) !== JSON.stringify(existing.care_instructions?.map(ci => ci.id).sort() || []))
                );
                
                if (hasChanges) {
                  // Update existing item
                  upsertedItem = await strapi.entityService.update(contentType as any, existing.id, {
                    data: item
                  });
                  console.log(`🔄 Updated existing ${productType}: ${item.name}`);
                  results.updated++;
                } else {
                  // Skip - no changes needed
                  console.log(`⏭️ Skipped ${productType} (no changes): ${item.name}`);
                  wasSkipped = true;
                  results.skipped++;
                }
              } else {
                // Create new item
                upsertedItem = await strapi.entityService.create(contentType as any, {
                  data: item
                });
                console.log(`➕ Created new ${productType}: ${item.name}`);
                results.created++;
              }
            }

            if (wasSkipped) {
              console.log(`✅ ${productType} item ${i + 1} skipped (no changes needed)`);
            } else {
              console.log(`✅ ${productType} item ${i + 1} upserted successfully:`, upsertedItem);
            }
          } catch (error) {
            console.error(`❌ ${productType} item ${i + 1} failed:`, error);
            results.failed++;
            results.errors.push({
              sheet: productType,
              row: i + 1,
              data: transformedDataset[productType][i],
              error: error.message
            });
          }
        }
      }

      // After importing all products, auto-populate brands with their fabrics
      // This ensures brands always reflect current fabric assignments
      console.log('🔄 Auto-populating brand fabrics relations...');
      try {
        // Fetch all fabrics with their brands populated
        const allFabrics = await strapi.entityService.findMany('api::fabric.fabric' as any, {
          filters: {},
          populate: ['brand']
        }) as any[];

        // Build mapping of brandId → array of fabricIds
        const brandToFabricsMap: { [brandId: number]: number[] } = {};
        
        allFabrics.forEach(fabric => {
          if (fabric.brand && fabric.brand.id) {
            const brandId = fabric.brand.id;
            if (!brandToFabricsMap[brandId]) {
              brandToFabricsMap[brandId] = [];
            }
            brandToFabricsMap[brandId].push(fabric.id);
          }
        });

        console.log(`📊 Built brand-to-fabrics mapping: ${Object.keys(brandToFabricsMap).length} brands have fabrics assigned`);

        // Update each brand with its fabrics
        for (const [brandIdStr, fabricIds] of Object.entries(brandToFabricsMap)) {
          const brandId = parseInt(brandIdStr);
          try {
            // Get the current brand to check if fabrics need updating
            const brand = await strapi.entityService.findOne('api::brand.brand' as any, brandId, {
              populate: ['fabrics']
            }) as any;

            if (brand) {
              // Check if fabrics relation has changed
              const currentFabricIds = brand.fabrics?.map((f: any) => f.id).sort() || [];
              const newFabricIds = [...fabricIds].sort();
              
              if (JSON.stringify(currentFabricIds) !== JSON.stringify(newFabricIds)) {
                // Update brand with fabrics
                await strapi.entityService.update('api::brand.brand' as any, brandId, {
                  data: {
                    fabrics: fabricIds
                  }
                });
                console.log(`✅ Auto-updated brand "${brand.name}" with ${fabricIds.length} fabrics`);
              } else {
                console.log(`⏭️ Brand "${brand.name}" already has correct fabrics (${fabricIds.length})`);
              }
            }
          } catch (error) {
            console.error(`❌ Error updating brand ${brandId} with fabrics:`, error);
          }
        }

        // Also update brands that have no fabrics (clear their fabrics relation if needed)
        const allBrands = await strapi.entityService.findMany('api::brand.brand' as any, {
          populate: ['fabrics']
        }) as any[];

        for (const brand of allBrands) {
          const expectedFabricIds = brandToFabricsMap[brand.id] || [];
          const currentFabricIds = brand.fabrics?.map((f: any) => f.id).sort() || [];
          
          // If brand has fabrics but shouldn't (no fabrics in map), clear them
          if (expectedFabricIds.length === 0 && currentFabricIds.length > 0) {
            await strapi.entityService.update('api::brand.brand' as any, brand.id, {
              data: {
                fabrics: []
              }
            });
            console.log(`🧹 Cleared fabrics for brand "${brand.name}" (no fabrics assigned to this brand)`);
          }
        }

        console.log('✅ Auto-population of brand fabrics completed');
      } catch (error) {
        console.error('❌ Error auto-populating brand fabrics:', error);
        // Don't fail the entire import if this step fails
      }

      console.log('📤 Server-side bulk import completed:', results);
      ctx.body = results;
    } catch (error) {
      console.error('❌ Server-side bulk import error:', error);
      ctx.status = 500;
      ctx.body = { error: error.message };
    }
  },

  // Bulk export products using Strapi's internal services
  async bulkExport(ctx) {
    try {
      const { selectedProductsByType } = ctx.request.body;
      
      console.log('📤 Starting server-side bulk export...');
      
      const contentTypes = {
        fabrics: 'api::fabric.fabric',
        curtains: 'api::curtain.curtain',
        blinds: 'api::blind.blind',
        cushions: 'api::cushion.cushion',
        linings: 'api::lining.lining',
        trimmings: 'api::trimming.trimming',
        mechanisations: 'api::mechanisation.mechanisation',
        brands: 'api::brand.brand',
        pricing_rules: 'api::pricing-rule.pricing-rule'
      };

      const allProducts = {};

      // Fetch all products for each type
      for (const [productType, contentType] of Object.entries(contentTypes)) {
        try {
          let products;
          
          if (selectedProductsByType && selectedProductsByType[productType] && selectedProductsByType[productType].length > 0) {
            // Export only selected products
            const selectedIds = selectedProductsByType[productType];
            products = await strapi.entityService.findMany(contentType as any, {
              filters: { id: { $in: selectedIds } },
              populate: '*'
            }) as any[];
          } else {
            // Export all products
            products = await strapi.entityService.findMany(contentType as any, {
              populate: '*'
            }) as any[];
          }
          
          allProducts[productType] = products || [];
          console.log(`📦 Fetched ${products?.length || 0} ${productType} for export`);
        } catch (error) {
          console.error(`❌ Error fetching ${productType}:`, error);
          allProducts[productType] = [];
        }
      }

      ctx.body = allProducts;
    } catch (error) {
      console.error('❌ Server-side bulk export error:', error);
      ctx.status = 500;
      ctx.body = { error: error.message };
    }
  },

  // Get relation data for validation
  async getRelationData(ctx) {
    try {
      console.log('📊 Fetching relation data for validation...');
      
      const contentTypes = {
        fabrics: 'api::fabric.fabric',
        curtains: 'api::curtain.curtain',
        blinds: 'api::blind.blind',
        cushions: 'api::cushion.cushion',
        linings: 'api::lining.lining',
        trimmings: 'api::trimming.trimming',
        mechanisations: 'api::mechanisation.mechanisation',
        brands: 'api::brand.brand',
        pricing_rules: 'api::pricing-rule.pricing-rule',
        'curtain-types': 'api::curtain-type.curtain-type',
        'blind-types': 'api::blind-type.blind-type',
        'cushion-types': 'api::cushion-type.cushion-type'
      };

      const relationData = {};

      // Fetch all relation data
      for (const [type, contentType] of Object.entries(contentTypes)) {
        try {
          const items = await strapi.entityService.findMany(contentType as any, {
            populate: '*'
          }) as any[];
          
          // Create lookup maps for validation
          relationData[type] = {
            byId: {},
            byName: {},
            byType: {} // for linings, trimmings, mechanisations
          };
          
          if (items) {
            items.forEach(item => {
              relationData[type].byId[item.id] = item;
              
              if (item.name) {
                relationData[type].byName[item.name] = item;
              }
              
              // Special handling for types that use 'type' field
              if (item.type) {
                relationData[type].byType[item.type] = item;
              }
              
              // Special handling for linings that use 'liningType' field
              if (item.liningType) {
                relationData[type].byType[item.liningType] = item;
              }
            });
          }
          
          console.log(`📊 Built lookup for ${type}: ${items?.length || 0} items`);
        } catch (error) {
          console.error(`❌ Error fetching ${type}:`, error);
          relationData[type] = { byId: {}, byName: {}, byType: {} };
        }
      }

      ctx.body = relationData;
    } catch (error) {
      console.error('❌ Error fetching relation data:', error);
      ctx.status = 500;
      ctx.body = { error: error.message };
    }
  },

  // Bulk image upload with auto-linking to products
  async bulkImageUpload(ctx) {
    // Note: Global unhandled rejection handler is set up in src/index.ts
    // This prevents the server from crashing when Strapi's cleanup fails on Windows
    try {
      // SECURITY: Check authentication - admin-only access
      const user = ctx.state.user;
      if (!user) {
        ctx.status = 401;
        ctx.body = { error: 'Authentication required' };
        return;
      }

      // Check if user is admin
      const userRole = user.role || user.roles?.[0];
      const isAdmin = userRole?.type === 'admin' || 
                     userRole?.name === 'Administrator' ||
                     userRole?.name === 'Admin' ||
                     userRole?.name === 'Super Admin' ||
                     userRole?.code === 'strapi-super-admin' ||
                     userRole?.code === 'strapi-admin';

      if (!isAdmin) {
        ctx.status = 403;
        ctx.body = { error: 'Admin access required' };
        return;
      }

      // Handle multipart form data
      const files = ctx.request.files?.files;
      const productType = ctx.request.body?.productType || 'fabrics';
      const matchBy = ctx.request.body?.matchBy || 'productId';
      const createAsColour = ctx.request.body?.createAsColour === 'true' || ctx.request.body?.createAsColour === true;

      // Handle both single file and array of files
      const fileArray = Array.isArray(files) ? files : (files ? [files] : []);

      if (fileArray.length === 0) {
        ctx.status = 400;
        ctx.body = { error: 'No files provided' };
        return;
      }

      // SECURITY: Validate file types and sizes BEFORE processing
      const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
      const MAX_TOTAL_SIZE = 100 * 1024 * 1024; // 100MB total

      let totalSize = 0;
      const validatedFiles = [];

      for (const file of fileArray) {
        // Get MIME type from file
        const mimeType = (file as any).type || (file as any).mimetype || '';
        const fileSize = (file as any).size || 0;
        const fileName = (file as any).name || (file as any).filename || (file as any).originalname || 'unknown';

        // Validate MIME type
        if (!ALLOWED_TYPES.includes(mimeType)) {
          ctx.status = 400;
          ctx.body = { error: `Invalid file type: ${mimeType}. Allowed types: ${ALLOWED_TYPES.join(', ')}` };
          return;
        }

        // Validate file size
        if (fileSize > MAX_FILE_SIZE) {
          ctx.status = 400;
          ctx.body = { error: `File ${fileName} exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB` };
          return;
        }

        totalSize += fileSize;
        if (totalSize > MAX_TOTAL_SIZE) {
          ctx.status = 400;
          ctx.body = { error: `Total upload size exceeds ${MAX_TOTAL_SIZE / 1024 / 1024}MB` };
          return;
        }

        // Validate file extension matches MIME type
        const fileExtension = fileName.toLowerCase().split('.').pop();
        const expectedExtensions: { [key: string]: string[] } = {
          'image/jpeg': ['jpg', 'jpeg'],
          'image/png': ['png'],
          'image/gif': ['gif'],
          'image/webp': ['webp']
        };
        const validExtensions = expectedExtensions[mimeType] || [];
        if (fileExtension && !validExtensions.includes(fileExtension)) {
          ctx.status = 400;
          ctx.body = { error: `File extension .${fileExtension} does not match MIME type ${mimeType}` };
          return;
        }

        validatedFiles.push(file);
      }

      console.log(`📸 Bulk image upload: ${validatedFiles.length} files (${fileArray.length} received, ${validatedFiles.length} validated), productType: ${productType}, matchBy: ${matchBy}`);

      const results = {
        uploaded: 0,
        linked: 0,
        failed: 0,
        skipped: 0,
        errors: [],
        details: []
      };

      // Upload all validated files to Strapi media library
      // Upload VERY slowly (one at a time with long delays) to avoid Windows file locking
      const uploadedFiles = [];
      const UPLOAD_DELAY_MS = 1000; // 1 second delay between uploads to avoid Windows file locking
      
      // Use validated files instead of original fileArray
      for (let i = 0; i < validatedFiles.length; i++) {
        const file = validatedFiles[i];
        
        // Extract filename from various possible properties
        const fileName = (file as any).name || 
                        (file as any).filename || 
                        (file as any).originalname || 
                        (file as any).originalFilename ||
                        `file_${i + 1}`;
        
        try {
          // Add delay between uploads (except first one) to reduce Windows file locking
          if (i > 0) {
            console.log(`⏳ Waiting ${UPLOAD_DELAY_MS}ms before next upload to avoid file locking...`);
            await new Promise(resolve => setTimeout(resolve, UPLOAD_DELAY_MS));
          }
          
          console.log(`📤 Uploading ${i + 1}/${validatedFiles.length}: ${fileName}...`);
          
          // Use Strapi's upload service with comprehensive error handling
          // Try to capture result even if cleanup fails
          let uploadedFile: any = null;
          
          try {
            // Attempt upload - wrap in try-catch to handle cleanup errors separately
            try {
              const result = await strapi.plugins['upload'].services.upload.upload({
                data: {},
                files: file
              });
              
              // Upload succeeded - store result
              uploadedFile = result;
              
              // Wait for cleanup, but don't fail if cleanup errors
              try {
                await new Promise(r => setTimeout(r, 800));
              } catch (cleanupErr: any) {
                // Cleanup error - but upload might have succeeded
                const isWindowsCleanupError = cleanupErr?.code === 'EPERM' || 
                                            cleanupErr?.errno === -4048 ||
                                            cleanupErr?.message?.includes('EPERM') ||
                                            cleanupErr?.message?.includes('unlink') ||
                                            cleanupErr?.syscall === 'unlink';
                if (isWindowsCleanupError && uploadedFile) {
                  console.warn(`⚠️ Windows file lock during cleanup for ${fileName} (upload succeeded, ignoring cleanup error)`);
                  // Upload succeeded, just cleanup failed - continue with result
                } else if (!isWindowsCleanupError) {
                  throw cleanupErr; // Re-throw if not a Windows cleanup error
                }
              }
            } catch (uploadErr: any) {
              // Check if it's a Windows file lock error
              const isWindowsError = uploadErr?.code === 'EPERM' || 
                                    uploadErr?.errno === -4048 ||
                                    uploadErr?.message?.includes('EPERM') ||
                                    uploadErr?.message?.includes('unlink') ||
                                    uploadErr?.message?.includes('operation not permitted') ||
                                    uploadErr?.syscall === 'unlink' ||
                                    (uploadErr?.path && uploadErr.path.includes('Temp'));
              
              if (isWindowsError) {
                // Windows error - upload might have succeeded despite the error
                // Try to recover the uploaded file by querying Strapi
                console.warn(`⚠️ Windows file lock error for ${fileName}, attempting to recover uploaded file...`);
                
                try {
                  // Query for recently uploaded files matching this filename
                  const baseName = fileName.replace(/\.[^/.]+$/, ''); // Remove extension
                  const recentFiles = await strapi.entityService.findMany('plugin::upload.file', {
                    filters: {
                      $or: [
                        { name: fileName },
                        { name: { $contains: baseName } }
                      ]
                    },
                    sort: { createdAt: 'desc' },
                    limit: 10
                  });
                  
                  // Find exact match or most recent match
                  const matchedFile = Array.isArray(recentFiles) 
                    ? recentFiles.find((f: any) => f.name === fileName) || recentFiles[0]
                    : null;
                  
                  // Check if file was uploaded in the last 30 seconds (reasonable window)
                  if (matchedFile) {
                    const fileAge = Date.now() - new Date(matchedFile.createdAt || matchedFile.updatedAt).getTime();
                    if (fileAge < 30000) { // 30 seconds
                      console.warn(`✅ Recovered uploaded file for ${fileName} (ID: ${matchedFile.id}, age: ${Math.round(fileAge/1000)}s)`);
                      uploadedFile = [matchedFile]; // Wrap in array to match upload service format
                    } else {
                      throw new Error('File too old to be from this upload');
                    }
                  } else {
                    throw new Error('No matching file found');
                  }
                } catch (recoveryErr: any) {
                  // Recovery failed - mark as failed but continue
                  console.warn(`⚠️ Windows file lock during upload/cleanup for ${fileName} - could not recover file: ${recoveryErr.message}`);
                  console.warn(`   This is often just a cleanup issue. File may still be uploaded.`);
                  results.failed++;
                  results.errors.push({
                    filename: fileName,
                    error: `Windows file lock (file may still be uploaded): ${uploadErr.message?.substring(0, 100) || 'Unknown error'}`
                  });
                  continue; // Skip to next file
                }
              } else {
                // Not a Windows error - re-throw
                throw uploadErr;
              }
            }
            
            // If upload was skipped due to Windows error, continue to next file
            if (!uploadedFile) {
              continue;
            }
          } catch (uploadError: any) {
            // Handle other upload errors
            throw uploadError;
          }
          
          // Handle both single and array response
          const fileData = Array.isArray(uploadedFile) ? uploadedFile[0] : uploadedFile;
          
          if (!fileData || !fileData.id) {
            throw new Error('Upload returned invalid file data');
          }
          
          // Store filename with uploaded file data for later matching
          (fileData as any).originalFilename = fileName;
          uploadedFiles.push(fileData);
          results.uploaded++;
          
          console.log(`✅ Uploaded ${i + 1}/${validatedFiles.length}: ${fileName} (ID: ${fileData.id})`);
          
          // Additional delay after successful upload to let Windows release file handles
          // Longer delay helps prevent file locking issues
          if (i < validatedFiles.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error: any) {
          // Handle other errors
          console.error(`❌ Failed to upload ${fileName}:`, error.message);
          results.failed++;
          results.errors.push({
            filename: fileName,
            error: error.message
          });
        }
      }
      
      // If all uploads failed due to Windows file locking, warn user
      if (uploadedFiles.length === 0 && results.failed > 0) {
        const allWindowsErrors = results.errors.every(err => 
          err.error?.includes('Windows file lock') || err.error?.includes('EPERM') || err.error?.includes('unlink')
        );
        if (allWindowsErrors) {
          console.warn(`⚠️ All uploads had Windows file lock issues. This is a known Windows/Strapi issue.`);
          console.warn(`   Recommendation: Upload fewer files at once (try 5-10 at a time) or use Strapi's built-in media library upload.`);
        }
      }
      
      // If no files were successfully uploaded, return early
      if (uploadedFiles.length === 0) {
        ctx.body = {
          success: false,
          message: 'No files were successfully uploaded. Check errors for details.',
          results
        };
        return;
      }

      // Match and link images to products
      const contentType = `api::${productType === 'fabrics' ? 'fabric' : productType.slice(0, -1)}.${productType === 'fabrics' ? 'fabric' : productType.slice(0, -1)}`;
      
      // OPTIMIZATION: Use cached lookup maps if available (minimize API calls)
      const cacheKey = `${contentType}_${matchBy}`;
      const cached = productLookupCache.get(cacheKey);
      const now = Date.now();
      
      let productIdMap: Map<string, any>;
      let slugMap: Map<string, any>;
      let nameMap: Map<string, any>;
      let firstNameMap: Map<string, any[]>;
      
      if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
        // Use cached maps
        console.log(`📦 Using cached product lookup maps (age: ${Math.round((now - cached.timestamp) / 1000)}s)`);
        productIdMap = cached.maps.productIdMap;
        slugMap = cached.maps.slugMap;
        nameMap = cached.maps.nameMap;
        firstNameMap = cached.maps.firstNameMap;
      } else {
        // Fetch all products ONCE and build lookup maps
        console.log(`📦 Fetching all products once for efficient matching...`);
        const allProducts = await strapi.entityService.findMany(contentType as any, {
          limit: 10000, // Get all products in one call
          populate: ['images'], // Populate images to check existing ones
          sort: ['name:asc']
        }) as any[];
        
        console.log(`✅ Loaded ${allProducts.length} products in single API call`);
        
        // Build lookup maps for fast matching (one-time cost)
        productIdMap = new Map<string, any>();
        slugMap = new Map<string, any>();
        nameMap = new Map<string, any>(); // For partial name matching
        firstNameMap = new Map<string, any[]>(); // For firstName matching (multiple products can have same first word)
        
        allProducts.forEach((p: any) => {
          // ProductId index
          if (p.productId) {
            productIdMap.set(p.productId.toLowerCase(), p);
          }
          // Slug index
          if (p.slug) {
            slugMap.set(p.slug.toLowerCase(), p);
          }
          // Name index (for partial matching)
          if (p.name) {
            const cleanName = p.name.toLowerCase().trim();
            nameMap.set(cleanName, p);
          }
          // First name index
          if (p.name) {
            const firstWord = p.name.split(/[\s\-_]+/)[0].trim().toLowerCase();
            if (firstWord) {
              if (!firstNameMap.has(firstWord)) {
                firstNameMap.set(firstWord, []);
              }
              firstNameMap.get(firstWord)!.push(p);
            }
          }
        });
        
        console.log(`📊 Built lookup maps: ${productIdMap.size} productIds, ${slugMap.size} slugs, ${nameMap.size} names, ${firstNameMap.size} first names`);
        
        // Cache the maps
        productLookupCache.set(cacheKey, {
          maps: { productIdMap, slugMap, nameMap, firstNameMap },
          timestamp: now
        });
      }
      
      // Collect all updates to batch them
      const updatesToProcess: Array<{ productId: number; imageIds: number[]; filename: string; product: any }> = [];
      
      // Match images to products using lookup maps (no API calls)
      for (const uploadedFile of uploadedFiles) {
        try {
          // Extract identifier from filename (remove extension)
          // Try multiple properties to get filename
          const filename = (uploadedFile as any).originalFilename ||
                              uploadedFile.name || 
                              uploadedFile.filename ||
                              (uploadedFile as any).originalname ||
                              `uploaded_${uploadedFile.id}`;
          const identifier = filename.replace(/\.[^/.]+$/, ''); // Remove extension
          
          console.log(`🔍 Matching image "${filename}" (identifier: "${identifier}")...`);

          // Find product using lookup maps (no API calls)
          let product = null;
          
          if (matchBy === 'productId') {
            product = productIdMap.get(identifier.toLowerCase()) || null;
          } else if (matchBy === 'slug') {
            product = slugMap.get(identifier.toLowerCase()) || null;
          } else if (matchBy === 'name') {
            // Try to match by name (remove common image suffixes)
            const cleanName = identifier
              .replace(/[-_]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .toLowerCase();
            
            // Try exact match first
            product = nameMap.get(cleanName) || null;
            
            // If no exact match, try partial match
            if (!product) {
              for (const [productName, prod] of nameMap.entries()) {
                if (productName.includes(cleanName) || cleanName.includes(productName)) {
                  product = prod;
                  break;
                }
              }
            }
          } else if (matchBy === 'firstName') {
            // Match by first word of product name vs first N characters of filename
            // Try different prefix lengths to find best match
            let bestMatch = null;
            let bestMatchLength = 0;
            
            for (const [firstWord, products] of firstNameMap.entries()) {
              const filenamePrefix = identifier.substring(0, firstWord.length).toLowerCase();
              
              if (filenamePrefix === firstWord && firstWord.length > bestMatchLength) {
                bestMatch = products[0]; // Take first product if multiple have same first word
                bestMatchLength = firstWord.length;
              }
            }
            
            product = bestMatch;
            
            if (product) {
              const productFirstWord = product.name.split(/[\s\-_]+/)[0].trim();
              const matchedPrefix = identifier.substring(0, productFirstWord.length);
              console.log(`✅ Matched filename prefix "${matchedPrefix}" to product "${product.name}"`);
            }
          }

          // Fallback specifically for colour uploads: strip last 2 chars (colour code) and match fabric by remaining name
          if (!product && createAsColour && identifier.length > 2) {
            const fabricNamePartRaw = identifier.slice(0, -2);
            const cleanNamePart = fabricNamePartRaw.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
            if (cleanNamePart) {
              product = nameMap.get(cleanNamePart) || null;
              if (product) {
                console.log(`✅ Fallback matched fabric by name (colour code stripped): "${cleanNamePart}"`);
              }
            }
          }

          if (product) {
            // If createAsColour is enabled and productType is fabrics, create/add as colour item
            if (createAsColour && productType === 'fabrics') {
              try {
                // Extract colour code (last 2 chars) and fabric name part
                const colourCode = identifier.slice(-2);
                const fabricNameFromFile = identifier.slice(0, -2).replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
                const colourName = `${fabricNameFromFile}-${colourCode}`.trim();
                
                // Find or create colour item
                const existingColours = await strapi.entityService.findMany('api::colour.colour', {
                  filters: {
                    name: colourName
                  },
                  populate: ['fabrics', 'thumbnail'],
                  limit: 1
                }) as any[];

                let colourItem: any = existingColours?.[0] || null;

                if (colourItem) {
                  console.log(`📦 Found existing colour: "${colourName}" (ID: ${colourItem.id}, documentId: ${colourItem.documentId})`);
                } else {
                  // STEP 1: Create new colour item with thumbnail already set
                  colourItem = await strapi.entityService.create('api::colour.colour', {
                    data: {
                      name: colourName,
                      thumbnail: uploadedFile.id,
                      publishedAt: new Date()
                    }
                  });
                  console.log(`✅ Created new colour: "${colourName}" (ID: ${colourItem.id}, documentId: ${colourItem.documentId})`);
                  
                  // STEP 2: Re-fetch the colour to ensure it's fully persisted before linking
                  colourItem = await strapi.entityService.findOne('api::colour.colour', colourItem.id, {
                    populate: ['fabrics']
                  }) as any;
                  console.log(`✅ Re-fetched colour to ensure persistence: "${colourName}" (ID: ${colourItem.id})`);
                }
                
                // STEP 3: Fetch fabric with colours (AFTER colour is fully created)
                const fabricWithColours = await strapi.entityService.findOne(contentType as any, product.id, {
                  populate: ['colours']
                }) as any;
                
                if (!fabricWithColours) {
                  throw new Error(`Failed to fetch fabric "${product.name}" (ID: ${product.id})`);
                }
                
                console.log(`🔍 Fabric "${product.name}" details: id=${product.id}, documentId=${product.documentId || 'N/A'}`);
                console.log(`🔍 Fabric current colours:`, fabricWithColours.colours?.map((c: any) => ({ id: c.id, documentId: c.documentId, name: c.name })) || []);
                
                // Extract all existing colour IDs (use id consistently)
                const existingColourIds = Array.isArray(fabricWithColours?.colours)
                  ? fabricWithColours.colours.map((c: any) => c.id || c).filter(Boolean)
                  : [];
                
                // Check if colour is already linked (check by id only)
                const isAlreadyLinked = existingColourIds.includes(colourItem.id);
                
                console.log(`🔍 Existing colour IDs on fabric:`, existingColourIds);
                console.log(`🔍 Colour to link ID: ${colourItem.id}`);
                console.log(`🔍 Already linked: ${isAlreadyLinked}`);
                
                if (!isAlreadyLinked) {
                  // STEP 4: Link by passing FULL array of all colour IDs (existing + new)
                  // This is the correct format for entityService.update with manyToMany
                  const allColourIds = [...existingColourIds, colourItem.id];
                  
                  console.log(`🔗 Linking colour "${colourName}" (ID: ${colourItem.id}) to fabric "${product.name}" (ID: ${product.id})`);
                  console.log(`🔗 Full colour IDs array:`, allColourIds);
                  
                  try {
                    // Use full array format (not connect) - this is what entityService.update expects
                    const updateResult = await strapi.entityService.update(contentType as any, product.id, {
                      data: {
                        colours: allColourIds as any
                      }
                    });
                    
                    console.log(`✅ Update call completed`);
                    console.log(`🔍 Update result colours:`, updateResult?.colours?.map((c: any) => c.id) || []);
                    
                    // Verify the link worked by re-fetching (add one more API call for verification)
                    const verifyFabric = await strapi.entityService.findOne(contentType as any, product.id, {
                      populate: ['colours']
                    }) as any;
                    const verifiedColourIds = Array.isArray(verifyFabric?.colours)
                      ? verifyFabric.colours.map((c: any) => c.id || c).filter(Boolean)
                      : [];
                    
                    console.log(`✅ After update, fabric colours:`, verifiedColourIds.map((id: any) => ({ id })));
                    const linkVerified = verifiedColourIds.includes(colourItem.id);
                    
                    if (linkVerified) {
                      console.log(`✅ Successfully linked colour "${colourName}" to fabric "${product.name}"`);
                      results.linked++;
                      results.details.push({
                        filename,
                        productId: product.productId || product.id,
                        productName: product.name,
                        status: `created/linked as colour: "${colourName}"`
                      });
                    } else {
                      console.error(`❌ Link update succeeded but verification failed - colour ID ${colourItem.id} not found in fabric's colours`);
                      console.error(`❌ Expected: ${colourItem.id}, Got:`, verifiedColourIds);
                      console.error(`❌ Update result had colours:`, updateResult?.colours?.map((c: any) => c.id) || []);
                      results.failed++;
                      results.errors.push({
                        filename,
                        error: `Link update succeeded but verification failed - colour not found in fabric's colours`
                      });
                    }
                  } catch (updateError: any) {
                    console.error(`❌ Error linking colour "${colourName}" to fabric:`, updateError.message);
                    console.error(`❌ Error stack:`, updateError.stack);
                    results.failed++;
                    results.errors.push({
                      filename,
                      error: `Failed to link colour to fabric: ${updateError.message}`
                    });
                  }
                } else {
                  console.log(`ℹ️ Colour "${colourName}" already linked to fabric "${product.name}"`);
                  results.skipped++;
                  results.details.push({
                    filename,
                    productId: product.productId || product.id,
                    productName: product.name,
                    status: 'skipped (colour already linked)'
                  });
                }
              } catch (colourError: any) {
                console.error(`❌ Error creating/linking colour for "${filename}":`, colourError.message);
                // Fall through to regular image linking
              }
            }
            
            // Also add image to fabric's images (unless createAsColour is the only action)
            if (!createAsColour || productType !== 'fabrics') {
              // Get existing images
              const existingImages = product.images || [];
              const imageIds = Array.isArray(existingImages) 
                ? existingImages.map((img: any) => img.id || img)
                : [];

              // Add new image if not already present
              if (!imageIds.includes(uploadedFile.id)) {
                imageIds.push(uploadedFile.id);
                
                // Collect update instead of doing it immediately
                updatesToProcess.push({
                  productId: product.id,
                  imageIds: imageIds,
                  filename: filename,
                  product: product
                });
              } else {
                results.skipped++;
                results.details.push({
                  filename,
                  productId: product.productId || product.id,
                  productName: product.name,
                  status: 'skipped (already exists)'
                });
              }
            }
          } else {
            results.skipped++;
            results.details.push({
              filename,
              identifier,
              status: 'skipped (no match found)'
            });
            console.log(`⚠️ No product found for image "${filename}" (identifier: "${identifier}")`);
          }
        } catch (error: any) {
          console.error(`❌ Error processing image "${uploadedFile.name}":`, error.message);
          results.failed++;
          results.errors.push({
            filename: uploadedFile.name || 'unknown',
            error: error.message
          });
        }
      }
      
      // OPTIMIZATION: Batch all updates (minimize API calls)
      console.log(`📝 Processing ${updatesToProcess.length} product updates in batches...`);
      const BATCH_SIZE = 10; // Process 10 updates at a time
      
      for (let i = 0; i < updatesToProcess.length; i += BATCH_SIZE) {
        const batch = updatesToProcess.slice(i, i + BATCH_SIZE);
        
        // Process batch in parallel
        await Promise.all(batch.map(async ({ productId, imageIds, filename, product }) => {
          try {
            await strapi.entityService.update(contentType as any, productId, {
              data: {
                images: imageIds
              }
            });

            results.linked++;
            results.details.push({
              filename,
              productId: product.productId || product.id,
              productName: product.name,
              status: 'linked'
            });
            
            console.log(`✅ Linked image "${filename}" to product "${product.name}" (ID: ${productId})`);
          } catch (error: any) {
            console.error(`❌ Error updating product ${productId}:`, error.message);
            results.failed++;
            results.errors.push({
              filename,
              error: `Failed to update product: ${error.message}`
            });
          }
        }));
      }

      // Send response
      ctx.body = {
        success: true,
        message: `Uploaded ${results.uploaded} images, linked ${results.linked} to products`,
        results
      };
      } catch (error: any) {
      console.error('❌ Error in bulk image upload:', error);
      
      // Prevent server crash - ensure response is sent even on error
      try {
        ctx.status = 500;
        ctx.body = { 
          success: false,
          error: error.message || 'Unknown error',
          message: 'Bulk upload encountered an error. Check server logs for details.',
          results: {
            uploaded: 0,
            linked: 0,
            failed: 0,
            skipped: 0,
            errors: [{ filename: 'system', error: error.message }],
            details: []
          }
        };
      } catch (ctxError: any) {
        // Last resort - log and return minimal error
        console.error('❌ Critical: Failed to send error response:', ctxError);
        ctx.status = 500;
        ctx.body = { error: 'Internal server error during bulk upload' };
      }
    }
  }
}));

