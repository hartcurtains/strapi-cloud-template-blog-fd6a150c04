/**
 * fabric controller
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::fabric.fabric', ({ strapi }) => ({
  async find(ctx) {
    // Always populate brand and care_instructions
    const { query } = ctx
    
    // Check if we want all fabrics BEFORE sanitization (getAll=true or very large pageSize >= 1000)
    // Check raw query pagination first
    const rawQueryPagination = query.pagination as { page?: number | string; pageSize?: number | string } | undefined
    const rawPageSize = rawQueryPagination?.pageSize ? parseInt(String(rawQueryPagination.pageSize)) : undefined
    const wantsAllFabrics = rawPageSize && rawPageSize >= 1000 // Large pageSize indicates getAll
    
    console.log('[Fabric Controller] Raw query pagination:', {
      rawQueryPagination,
      rawPageSize,
      wantsAllFabrics
    })
    
    const populateQuery = (typeof query.populate === 'object' && query.populate !== null && !Array.isArray(query.populate)) 
      ? (query.populate as Record<string, any>) 
      : {}
    
    // Ensure populate includes only valid fabric relations
    // Valid: images, brand, care_instructions, colours, cushions, pricing_rules
    // NOT valid: linings, trimmings, curtains (don't exist on fabric schema)
    const populate: Record<string, any> = {
      ...populateQuery,
      brand: populateQuery.brand !== undefined ? populateQuery.brand : true,
      care_instructions: populateQuery.care_instructions !== undefined ? populateQuery.care_instructions : true,
      images: populateQuery.images !== undefined ? populateQuery.images : true,
      colours: populateQuery.colours !== undefined ? populateQuery.colours : true,
      cushions: populateQuery.cushions !== undefined ? populateQuery.cushions : true,
      pricing_rules: populateQuery.pricing_rules !== undefined ? populateQuery.pricing_rules : true,
    }
    // Remove invalid keys
    delete populate.linings
    delete populate.trimmings
    delete populate.curtains
    
    const sanitizedQuery = await this.sanitizeQuery(ctx)
    sanitizedQuery.populate = populate
    
    // Also check sanitized query pagination as fallback
    const sanitizedPagination = sanitizedQuery.pagination as { page?: number; pageSize?: number } | undefined
    const sanitizedPageSize = sanitizedPagination?.pageSize
    const finalWantsAllFabrics = wantsAllFabrics || (sanitizedPageSize && sanitizedPageSize >= 1000)
    
    console.log('[Fabric Controller] After sanitization:', {
      sanitizedPagination,
      sanitizedPageSize,
      finalWantsAllFabrics
    })
    
    if (finalWantsAllFabrics) {
      // Use findMany to bypass pagination limits and get ALL fabrics
      // Use the populate structure from the query to ensure nested relations like colours.thumbnail are populated
      // Always ensure colours.thumbnail is populated, even if not in the query
      let findManyPopulate: any
      if (populateQuery && Object.keys(populateQuery).length > 0) {
        // Use the populated structure from query, but ensure colours.thumbnail is always populated
        findManyPopulate = { ...populate }
        // Ensure colours.thumbnail is populated even if colours structure exists but doesn't include thumbnail
        if (!findManyPopulate.colours) {
          findManyPopulate.colours = { populate: { thumbnail: true } }
        } else if (typeof findManyPopulate.colours === 'object' && !findManyPopulate.colours.populate) {
          // If colours exists but doesn't have populate, add it
          findManyPopulate.colours = {
            ...findManyPopulate.colours,
            populate: {
              ...(findManyPopulate.colours.populate || {}),
              thumbnail: true
            }
          }
        } else if (typeof findManyPopulate.colours === 'object' && findManyPopulate.colours.populate && !findManyPopulate.colours.populate.thumbnail) {
          // If colours.populate exists but doesn't include thumbnail, add it
          findManyPopulate.colours.populate.thumbnail = true
        } else if (findManyPopulate.colours === true) {
          // If colours is just true, replace with structure that includes thumbnail
          findManyPopulate.colours = { populate: { thumbnail: true } }
        }
      } else {
        // Fallback: only populate relations that exist on fabric schema
        findManyPopulate = {
          images: true,
          brand: true,
          care_instructions: true,
          colours: {
            populate: {
              thumbnail: true
            }
          },
          cushions: true,
          pricing_rules: true
        }
      }
      
      // Build findMany query with explicit high limit to get ALL items
      // Strapi v5 findMany has a default limit, so we must override it
      const findManyQuery: any = {
        populate: findManyPopulate,
        limit: -1 // -1 means no limit in Strapi
      }
      
      console.log('[Fabric Controller] Using findMany with limit=-1 to fetch ALL fabrics')
      
      try {
        let allResults = await strapi.entityService.findMany('api::fabric.fabric', findManyQuery)
        
        // If limit: -1 didn't work, try with a very high number
        if (!allResults || (Array.isArray(allResults) && allResults.length < 50)) {
          console.log('[Fabric Controller] Retrying with limit: 10000')
          allResults = await strapi.entityService.findMany('api::fabric.fabric', {
            ...findManyQuery,
            limit: 10000
          })
        }
        
        console.log('[Fabric Controller] findMany returned', Array.isArray(allResults) ? allResults.length : 'non-array', 'fabrics')
        
        // Return all results with pagination metadata indicating all items
        return this.transformResponse(allResults, { 
          pagination: {
            page: 1,
            pageSize: allResults.length,
            pageCount: 1,
            total: allResults.length
          }
        })
      } catch (error: any) {
        console.error('[Fabric Controller] findMany error:', {
          message: error?.message,
          stack: error?.stack?.substring(0, 500),
          errorType: error?.constructor?.name
        })
        // Fall back to regular pagination if findMany fails
        console.log('[Fabric Controller] Falling back to regular pagination due to findMany error')
        // Restore pagination for fallback
        sanitizedQuery.pagination = {
          page: 1,
          pageSize: 10000 // Use the large pageSize that was requested
        }
        // Continue to normal pagination logic below
      }
    }
    
    // Normal pagination logic for regular requests
    if (rawQueryPagination) {
      sanitizedQuery.pagination = {
        page: rawQueryPagination.page ? parseInt(String(rawQueryPagination.page)) : (sanitizedPagination?.page || 1),
        pageSize: rawQueryPagination.pageSize ? parseInt(String(rawQueryPagination.pageSize)) : (sanitizedPagination?.pageSize || 200)        
      } as { page: number; pageSize: number }
    } else {
      // Default to 200 items per page if no pagination specified (increased to handle larger datasets like 121+ fabrics)
      // If sanitizedQuery already has pagination with a smaller pageSize, increase it
      const defaultPageSize = 200;
      sanitizedQuery.pagination = (sanitizedPagination || { page: 1, pageSize: defaultPageSize }) as { page: number; pageSize: number }
      const pagination = sanitizedQuery.pagination as { page: number; pageSize: number }
      // Ensure minimum pageSize of 200 for better data retrieval (covers most use cases)
      if (!pagination.pageSize || pagination.pageSize < defaultPageSize) {
        pagination.pageSize = defaultPageSize
      }
    }
    
    const { results, pagination } = await strapi.entityService.findPage('api::fabric.fabric', sanitizedQuery)
    
    // If we got fewer results than the pageSize and there might be more, log a warning
    if (results.length < pagination.pageSize && pagination.total > pagination.pageSize) {
      console.log(`[Fabric Controller] Retrieved ${results.length} fabrics, but total is ${pagination.total}. Consider using pagination[pageSize]=${pagination.total} to get all items.`)
    }
    
    return this.transformResponse(results, { pagination })
  },
  
  async findOne(ctx) {
    // Always populate brand and care_instructions
    const { id } = ctx.params
    const { query } = ctx
    const populateQuery = (typeof query.populate === 'object' && query.populate !== null && !Array.isArray(query.populate)) 
      ? (query.populate as Record<string, any>) 
      : {}
    
    // Ensure populate includes only valid fabric relations
    const populate: Record<string, any> = {
      ...populateQuery,
      brand: populateQuery.brand !== undefined ? populateQuery.brand : true,
      care_instructions: populateQuery.care_instructions !== undefined ? populateQuery.care_instructions : true,
      images: populateQuery.images !== undefined ? populateQuery.images : true,
      colours: populateQuery.colours !== undefined ? populateQuery.colours : true,
      cushions: populateQuery.cushions !== undefined ? populateQuery.cushions : true,
      pricing_rules: populateQuery.pricing_rules !== undefined ? populateQuery.pricing_rules : true,
    }
    // Remove invalid keys
    delete populate.linings
    delete populate.trimmings
    delete populate.curtains
    
    const sanitizedQuery = await this.sanitizeQuery(ctx)
    sanitizedQuery.populate = populate
    
    const entity = await strapi.entityService.findOne('api::fabric.fabric', id, sanitizedQuery)
    
    if (!entity) {
      return ctx.notFound()
    }
    
    return this.transformResponse(entity)
  },

  async importFabrics(ctx) {
    try {
      const fs = require('fs');
      const path = require('path');
      
      const jsonPath = path.join(process.cwd(), 'fixed-fabrics-import.json');
      
      if (!fs.existsSync(jsonPath)) {
        return ctx.badRequest('fixed-fabrics-import.json not found!');
      }

      const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const fabrics = jsonData.fabrics || [];

      console.log(`📦 Found ${fabrics.length} fabrics to import`);

      // Fix pattern if patternRepeat_cm = 0
      fabrics.forEach((fabric: any) => {
        if (fabric.patternRepeat_cm === 0) {
          fabric.pattern = 'Plain';
        }
      });

      // Step 1: Get or create brands
      const brandMap = new Map<string, number>();
      const brandNames = fabrics.map((f: any) => f.brand_name as string).filter((name): name is string => Boolean(name));
      const uniqueBrands = [...new Set<string>(brandNames)];
      
      console.log(`🏷️  Processing ${uniqueBrands.length} brands...`);
      for (const brandName of uniqueBrands) {
        try {
          // Try to find existing brand
          let brands = await strapi.entityService.findMany('api::brand.brand', {
            filters: { name: brandName },
            limit: 1,
          });

          let brand;
          if (!brands || brands.length === 0) {
            // Create new brand
            brand = await strapi.entityService.create('api::brand.brand', {
              data: {
                name: brandName,
                publishedAt: new Date(),
              },
            });
            console.log(`  ✅ Created brand: ${brandName}`);
          } else {
            brand = brands[0];
            console.log(`  ✓ Found existing brand: ${brandName}`);
          }
          
          brandMap.set(brandName, brand.id);
        } catch (error: any) {
          console.error(`  ❌ Error processing brand ${brandName}:`, error.message);
        }
      }

      // Step 2: Get or create care instructions
      const careInstructionMap = new Map<string, number>();
      const allCareInstructions = new Set<string>();
      
      fabrics.forEach((fabric: any) => {
        if (fabric.care_instruction_names) {
          // Split by comma and trim
          const instructions = fabric.care_instruction_names
            .split(',')
            .map((i: string) => i.trim())
            .filter(Boolean);
          instructions.forEach((inst: string) => allCareInstructions.add(inst));
        }
      });

      console.log(`🧼 Processing ${allCareInstructions.size} care instructions...`);
      for (const careName of allCareInstructions) {
        try {
          // Try to find existing care instruction
          let careInstructions = await strapi.entityService.findMany('api::care-instruction.care-instruction', {
            filters: { name: careName },
            limit: 1,
          });

          let careInstruction;
          if (!careInstructions || careInstructions.length === 0) {
            // Create new care instruction
            careInstruction = await strapi.entityService.create('api::care-instruction.care-instruction', {
              data: {
                name: careName,
                publishedAt: new Date(),
              },
            });
            console.log(`  ✅ Created care instruction: ${careName}`);
          } else {
            careInstruction = careInstructions[0];
            console.log(`  ✓ Found existing care instruction: ${careName}`);
          }
          
          careInstructionMap.set(careName, careInstruction.id);
        } catch (error: any) {
          console.error(`  ❌ Error processing care instruction ${careName}:`, error.message);
        }
      }

      // Step 3: Import fabrics
      console.log(`🧵 Importing ${fabrics.length} fabrics...`);
      let imported = 0;
      let updated = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const fabricData of fabrics) {
        try {
          // Check if fabric already exists by productId
          const existing = await strapi.entityService.findMany('api::fabric.fabric', {
            filters: { productId: fabricData.productId },
            limit: 1,
          });

          // Prepare fabric data
          const fabricPayload: any = {
            name: fabricData.name,
            productId: fabricData.productId,
            pattern: fabricData.pattern || 'Plain',
            composition: fabricData.composition,
            price_per_metre: fabricData.price_per_metre,
            patternRepeat_cm: fabricData.patternRepeat_cm || 0,
            usableWidth_cm: fabricData.usableWidth_cm,
            availability: fabricData.availability || 'in_stock',
            description: fabricData.description || '',
            martindale: fabricData.martindale,
            is_featured: false,
            is_curtain: false,
            publishedAt: new Date(),
          };

          // Add brand relation
          if (fabricData.brand_name && brandMap.has(fabricData.brand_name)) {
            fabricPayload.brand = brandMap.get(fabricData.brand_name);
          }

          // Add care instructions relations
          if (fabricData.care_instruction_names) {
            const careNames = fabricData.care_instruction_names
              .split(',')
              .map((i: string) => i.trim())
              .filter(Boolean);
            
            const careIds = careNames
              .map((name: string) => careInstructionMap.get(name))
              .filter(Boolean);
            
            if (careIds.length > 0) {
              fabricPayload.care_instructions = careIds;
            }
          }

          if (existing && existing.length > 0) {
            // Update existing fabric
            await strapi.entityService.update('api::fabric.fabric', existing[0].id, {
              data: fabricPayload,
            });
            updated++;
          } else {
            // Create new fabric
            await strapi.entityService.create('api::fabric.fabric', {
              data: fabricPayload,
            });
            imported++;
          }

          if ((imported + updated) % 10 === 0) {
            process.stdout.write('.');
          }
        } catch (error: any) {
          failed++;
          const errorMsg = `Error importing fabric ${fabricData.productId}: ${error.message}`;
          errors.push(errorMsg);
          console.error(`\n❌ ${errorMsg}`);
        }
      }

      const summary = {
        created: imported,
        updated: updated,
        failed: failed,
        total: fabrics.length,
        errors: errors.slice(0, 10), // Limit errors in response
      };

      console.log(`\n\n📊 Import Summary:`, summary);
      console.log('✅ Fabric import complete!');

      return ctx.body = {
        success: true,
        message: 'Fabric import completed',
        ...summary,
      };
    } catch (error: any) {
      console.error('❌ Import error:', error);
      return ctx.internalServerError(`Import failed: ${error.message}`);
    }
  },
}));
