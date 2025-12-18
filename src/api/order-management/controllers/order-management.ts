/**
 * order-management controller
 */

import { factories } from '@strapi/strapi';

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
        errors: []
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
            } else {
              console.log(`⏭️ Brand already exists: "${brandName}" (ID: ${existingBrands[0].id})`);
            }
          } catch (error: any) {
            console.error(`❌ Failed to auto-create brand "${brandName}":`, error.message);
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
            } else {
              console.log(`⏭️ Care instruction already exists: "${careName}" (ID: ${existingCareInstructions[0].id})`);
            }
          } catch (error: any) {
            console.error(`❌ Failed to auto-create care instruction "${careName}":`, error.message);
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
                martindale: item.martindale || 50000,
                availability: item.availability || 'in_stock',
                is_featured: item.is_featured !== undefined ? item.is_featured : false,
                is_curtain: item.is_curtain !== undefined ? item.is_curtain : false
              };
              
              // Apply defaults for missing fields
              Object.keys(defaults).forEach(key => {
                if (item[key] === undefined || item[key] === null || item[key] === '') {
                  item[key] = defaults[key];
                  console.log(`🔧 Applied default ${key}: ${defaults[key]} for fabric "${item.name}"`);
                }
              });
              
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
  }
}));

