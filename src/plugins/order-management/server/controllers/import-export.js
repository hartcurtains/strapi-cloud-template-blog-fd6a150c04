module.exports = {
  // Simple test endpoint
  async test(ctx) {
    ctx.body = { message: 'Order Management plugin is working!' };
  },

  // Bulk import products using Strapi's internal services
  async bulkImport(ctx) {
    try {
      const { data: transformedDataset } = ctx.request.body;
      
      // #region agent log
      const fs = require('fs'); const logPath = 'c:\\Users\\zkaay\\Documents\\ME\\Website\\STUPIIIIDDDD DHAHDLSBJDJS\\.cursor\\debug.log';
      const debugLog = (hyp, loc, msg, data) => { try { fs.appendFileSync(logPath, JSON.stringify({hypothesisId:hyp,location:loc,message:msg,data,timestamp:Date.now(),sessionId:'debug-session'})+'\n'); } catch(e){} };
      debugLog('A','import-export.js:bulkImport:entry','Request body received',{bodyKeys:ctx.request.body?Object.keys(ctx.request.body):'NO_BODY',hasData:!!ctx.request.body?.data,datasetKeys:transformedDataset?Object.keys(transformedDataset):'NO_DATASET'});
      debugLog('A','import-export.js:bulkImport:fabrics','Fabrics array check',{fabricsCount:transformedDataset?.fabrics?.length||0,isArray:Array.isArray(transformedDataset?.fabrics),firstFabricKeys:transformedDataset?.fabrics?.[0]?Object.keys(transformedDataset.fabrics[0]):null,firstBrandName:transformedDataset?.fabrics?.[0]?.brand_name||'NONE'});
      // #endregion
      
      const TIMESTAMP = Date.now();
      console.log('\n\n');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('🔥🔥🔥 [CLOUD] NEW CODE VERSION 3.0 - TIMESTAMP:', TIMESTAMP, '🔥🔥🔥');
      console.log('🔥🔥🔥 [CLOUD] ENHANCED AUTO-CREATION WITH LOGGING 🔥🔥🔥');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('🚀 [CLOUD] Starting server-side bulk import...');
      console.log('🎯 [CLOUD] NEW RESULT STRUCTURE: {created, updated, skipped, failed}');
      console.log('📦 [CLOUD] Request body keys:', ctx.request.body ? Object.keys(ctx.request.body) : 'NO BODY');
      console.log('📦 [CLOUD] Dataset keys:', transformedDataset ? Object.keys(transformedDataset) : 'NO DATA');
      console.log('📦 [CLOUD] Fabrics count:', transformedDataset?.fabrics?.length || 0);
      console.log('📦 [CLOUD] Has fabrics array?', Array.isArray(transformedDataset?.fabrics));
      console.log('📦 [CLOUD] transformedDataset.fabrics truthy?', !!transformedDataset?.fabrics);
      
      // Log sample fabric data to verify structure
      if (transformedDataset?.fabrics && transformedDataset.fabrics.length > 0) {
        const sampleFabric = transformedDataset.fabrics[0];
        console.log('📦 [CLOUD] Sample fabric data:', {
          name: sampleFabric.name,
          brand_name: sampleFabric.brand_name,
          care_instruction_names: sampleFabric.care_instruction_names,
          hasBrand: !!sampleFabric.brand,
          hasCareInstructions: !!sampleFabric.care_instructions,
          allKeys: Object.keys(sampleFabric)
        });
        console.log('📦 [CLOUD] Sample fabric full object (first 500 chars):', JSON.stringify(sampleFabric).substring(0, 500));
      } else {
        console.warn('⚠️ [CLOUD] WARNING: No fabrics found in transformedDataset!');
        console.warn('⚠️ [CLOUD] transformedDataset:', JSON.stringify(transformedDataset, null, 2).substring(0, 1000));
      }
      
      console.log('🔧 [CLOUD] Strapi instance available:', !!strapi);
      console.log('🔧 [CLOUD] EntityService available:', !!strapi?.entityService);
      console.log('═══════════════════════════════════════════════════════════');
      console.log('\n\n');
      
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
        care_instructions: 'api::care-instruction.care-instruction'
      };

      // Track auto-creation stats
      let brandsCreated = 0;
      let brandsFailed = 0;
      let careInstructionsCreated = 0;
      let careInstructionsFailed = 0;
      let brandNames = null;
      let careInstructionNames = null;

      // Phase 1: Auto-create missing brands
      const autoCreatedBrands = new Map();
      console.log('🔍 [CLOUD] Phase 1 Check: transformedDataset.fabrics exists?', !!transformedDataset.fabrics);
      console.log('🔍 [CLOUD] Phase 1 Check: transformedDataset.fabrics is array?', Array.isArray(transformedDataset.fabrics));
      console.log('🔍 [CLOUD] Phase 1 Check: transformedDataset.fabrics length?', transformedDataset.fabrics?.length);
      
      // #region agent log
      debugLog('B','import-export.js:phase1:condition','Phase 1 condition check',{fabricsExists:!!transformedDataset.fabrics,isArray:Array.isArray(transformedDataset.fabrics),length:transformedDataset.fabrics?.length||0,willEnterLoop:!!(transformedDataset.fabrics && Array.isArray(transformedDataset.fabrics) && transformedDataset.fabrics.length > 0)});
      // #endregion
      
      if (transformedDataset.fabrics && Array.isArray(transformedDataset.fabrics) && transformedDataset.fabrics.length > 0) {
        console.log('🔧 [CLOUD] Phase 1: Auto-creating missing brands...');
        console.log('🔧 [CLOUD] Verifying strapi.entityService is available:', !!strapi.entityService);
        
        // Validate fabrics data structure
        if (!Array.isArray(transformedDataset.fabrics)) {
          throw new Error('Invalid data structure: fabrics must be an array');
        }
        
        // Collect all unique brand names from fabrics
        brandNames = new Set();
        transformedDataset.fabrics.forEach((fabric, index) => {
          if (!fabric || typeof fabric !== 'object') {
            console.warn(`⚠️ [CLOUD] Invalid fabric at index ${index}:`, fabric);
            return;
          }
          if (fabric.brand_name) {
            const brandName = fabric.brand_name.toString().trim();
            if (brandName) {
              brandNames.add(brandName);
            }
          }
        });
        console.log(`📋 [CLOUD] Phase 1: Found ${brandNames.size} unique brand names: ${Array.from(brandNames).slice(0, 5).join(', ')}${brandNames.size > 5 ? '...' : ''}`);
        
        // Validate that we found brand names if fabrics exist
        if (transformedDataset.fabrics.length > 0 && brandNames.size === 0) {
          console.warn(`⚠️ [CLOUD] WARNING: Found ${transformedDataset.fabrics.length} fabrics but no brand_name fields. This may indicate a data structure issue.`);
          console.warn(`⚠️ [CLOUD] Sample fabric structure:`, JSON.stringify(transformedDataset.fabrics[0], null, 2));
        }
        
        // Check which brands exist in database
        console.log('🔧 [CLOUD] Checking existing brands in database...');
        let existingBrands = [];
        let existingBrandNames = new Set();
        try {
          existingBrands = await strapi.entityService.findMany('api::brand.brand', {
            populate: '*'
          });
          existingBrandNames = new Set(existingBrands.map(b => b.name.toLowerCase().trim()));
          
          // Add existing brands to the map for quick lookup
          existingBrands.forEach(brand => {
            const brandNameLower = brand.name.toLowerCase().trim();
            autoCreatedBrands.set(brandNameLower, brand.id);
          });
          console.log(`📋 [CLOUD] Phase 1: Populated brand map with ${existingBrands.length} existing brands. Map now has ${autoCreatedBrands.size} entries.`);
        } catch (error) {
          console.warn(`⚠️ [CLOUD] Error fetching existing brands (will continue with auto-creation):`, error.message);
          console.warn(`⚠️ [CLOUD] This is OK - we'll create all brands as new if they don't exist`);
        }
        console.log(`📋 [CLOUD] Phase 1: About to auto-create ${brandNames.size - existingBrandNames.size} missing brands`);
        
        // #region agent log
        debugLog('B','import-export.js:phase1:brandNames','Brand names collected',{uniqueBrandNames:Array.from(brandNames),existingBrandNames:Array.from(existingBrandNames),toCreate:brandNames.size - existingBrandNames.size});
        // #endregion
        
        // Auto-create missing brands
        for (const brandName of brandNames) {
          const brandNameLower = brandName.toLowerCase().trim();
          if (!existingBrandNames.has(brandNameLower)) {
            try {
              console.log(`🔧 [CLOUD] Auto-creating brand: ${brandName}`);
              console.log(`🔧 [CLOUD] Using entityService.create for api::brand.brand`);
              
              // #region agent log
              debugLog('C','import-export.js:phase1:createBrand:before','About to create brand',{brandName,brandNameLower,strapiAvailable:!!strapi,entityServiceAvailable:!!strapi?.entityService});
              // #endregion
              
              const createdBrand = await strapi.entityService.create('api::brand.brand', {
                data: {
                  name: brandName,
                  description: `Auto-created brand: ${brandName}`
                }
              });
              // #region agent log
              debugLog('C','import-export.js:phase1:createBrand:after','Brand creation result',{brandName,createdBrand:createdBrand?{id:createdBrand.id,name:createdBrand.name}:'NULL',success:!!(createdBrand?.id)});
              // #endregion
              
              if (!createdBrand || !createdBrand.id) {
                throw new Error(`Brand creation returned invalid result: ${JSON.stringify(createdBrand)}`);
              }
              autoCreatedBrands.set(brandNameLower, createdBrand.id);
              brandsCreated++;
              console.log(`✅ [CLOUD] Auto-created brand: ${brandName} (ID: ${createdBrand.id})`);
            } catch (error) {
              brandsFailed++;
              const errorDetails = {
                message: error.message,
                stack: error.stack,
                name: error.name,
                code: error.code,
                status: error.status
              };
              
              // #region agent log
              debugLog('C','import-export.js:phase1:createBrand:error','Brand creation FAILED',{brandName,errorMessage:error.message,errorName:error.name,errorCode:error.code});
              // #endregion
              
              console.error(`❌ [CLOUD] Failed to auto-create brand ${brandName}:`, errorDetails);
              console.error(`❌ [CLOUD] Full error object:`, error);
              results.errors.push({
                type: 'auto_create_error',
                sheet: 'fabrics',
                message: `Failed to auto-create brand: ${brandName}`,
                error: error.message || String(error),
                details: errorDetails
              });
              results.failed++;
            }
          }
        }
        
        // #region agent log
        debugLog('B','import-export.js:phase1:summary','Phase 1 completed',{brandsCreated,brandsFailed,totalInMap:autoCreatedBrands.size,mapKeys:Array.from(autoCreatedBrands.keys())});
        // #endregion
        
        console.log(`📊 [CLOUD] Phase 1 Summary: ${brandsCreated} brands created, ${brandsFailed} failed, ${autoCreatedBrands.size} total in map`);
      } else {
        // #region agent log
        debugLog('B','import-export.js:phase1:skipped','Phase 1 SKIPPED - no fabrics',{fabricsValue:transformedDataset.fabrics,typeofFabrics:typeof transformedDataset.fabrics});
        // #endregion
        
        console.warn('⚠️ [CLOUD] Phase 1: SKIPPED - No fabrics array or empty array');
        console.warn('⚠️ [CLOUD] Phase 1: transformedDataset.fabrics =', transformedDataset.fabrics);
      }

      // Phase 2: Auto-create missing care instructions
      const autoCreatedCareInstructions = new Map();
      console.log('🔍 [CLOUD] Phase 2 Check: transformedDataset.fabrics exists?', !!transformedDataset.fabrics);
      console.log('🔍 [CLOUD] Phase 2 Check: transformedDataset.fabrics is array?', Array.isArray(transformedDataset.fabrics));
      console.log('🔍 [CLOUD] Phase 2 Check: transformedDataset.fabrics length?', transformedDataset.fabrics?.length);
      
      if (transformedDataset.fabrics && Array.isArray(transformedDataset.fabrics) && transformedDataset.fabrics.length > 0) {
        console.log('🔧 [CLOUD] Phase 2: Auto-creating missing care instructions...');
        console.log('🔧 [CLOUD] Verifying strapi.entityService is available:', !!strapi.entityService);
        
        // Collect all unique care instruction names from fabrics
        careInstructionNames = new Set();
        transformedDataset.fabrics.forEach((fabric, index) => {
          if (!fabric || typeof fabric !== 'object') {
            console.warn(`⚠️ [CLOUD] Invalid fabric at index ${index} during care instruction collection:`, fabric);
            return;
          }
          if (fabric.care_instruction_names) {
            // Split comma-separated names
            const names = fabric.care_instruction_names.toString().split(',').map(n => n.trim()).filter(n => n);
            names.forEach(name => careInstructionNames.add(name));
          }
        });
        
        // Validate that we found care instruction names if fabrics exist
        if (transformedDataset.fabrics.length > 0 && careInstructionNames.size === 0) {
          console.warn(`⚠️ [CLOUD] WARNING: Found ${transformedDataset.fabrics.length} fabrics but no care_instruction_names fields. This may indicate a data structure issue.`);
        }
        
        // Also check if there's a care_instructions sheet in the import
        if (transformedDataset.care_instructions) {
          transformedDataset.care_instructions.forEach(ci => {
            if (ci.name) {
              careInstructionNames.add(ci.name.trim());
            }
          });
        }
        
        console.log(`📋 [CLOUD] Phase 2: Found ${careInstructionNames.size} unique care instruction names`);
        
        // Check which care instructions exist in database
        console.log('🔧 [CLOUD] Checking existing care instructions in database...');
        let existingCareInstructions = [];
        let existingCareInstructionNames = new Set();
        try {
          existingCareInstructions = await strapi.entityService.findMany('api::care-instruction.care-instruction', {
            populate: '*'
          });
          existingCareInstructionNames = new Set(existingCareInstructions.map(ci => ci.name.toLowerCase().trim()));
          
          // Add existing care instructions to the map for quick lookup
          existingCareInstructions.forEach(ci => {
            const careNameLower = ci.name.toLowerCase().trim();
            autoCreatedCareInstructions.set(careNameLower, ci.id);
          });
          console.log(`📋 [CLOUD] Phase 2: Populated care instruction map with ${existingCareInstructions.length} existing care instructions. Map now has ${autoCreatedCareInstructions.size} entries.`);
        } catch (error) {
          console.warn(`⚠️ [CLOUD] Error fetching existing care instructions (will continue with auto-creation):`, error.message);
          console.warn(`⚠️ [CLOUD] This is OK - we'll create all care instructions as new if they don't exist`);
        }
        console.log(`📋 [CLOUD] Phase 2: About to auto-create ${careInstructionNames.size - existingCareInstructionNames.size} missing care instructions`);
        
        // Auto-create missing care instructions
        for (const careName of careInstructionNames) {
          const careNameLower = careName.toLowerCase().trim();
          if (!existingCareInstructionNames.has(careNameLower)) {
            try {
              console.log(`🔧 [CLOUD] Auto-creating care instruction: ${careName}`);
              console.log(`🔧 [CLOUD] Using entityService.create for api::care-instruction.care-instruction`);
              const createdCare = await strapi.entityService.create('api::care-instruction.care-instruction', {
                data: {
                  name: careName,
                  description: `Auto-created care instruction: ${careName}`
                }
              });
              if (!createdCare || !createdCare.id) {
                throw new Error(`Care instruction creation returned invalid result: ${JSON.stringify(createdCare)}`);
              }
              autoCreatedCareInstructions.set(careNameLower, createdCare.id);
              careInstructionsCreated++;
              console.log(`✅ [CLOUD] Auto-created care instruction: ${careName} (ID: ${createdCare.id})`);
            } catch (error) {
              careInstructionsFailed++;
              const errorDetails = {
                message: error.message,
                stack: error.stack,
                name: error.name,
                code: error.code,
                status: error.status
              };
              console.error(`❌ [CLOUD] Failed to auto-create care instruction ${careName}:`, errorDetails);
              console.error(`❌ [CLOUD] Full error object:`, error);
              results.errors.push({
                type: 'auto_create_error',
                sheet: 'fabrics',
                message: `Failed to auto-create care instruction: ${careName}`,
                error: error.message || String(error),
                details: errorDetails
              });
              results.failed++;
            }
          }
        }
        console.log(`📊 [CLOUD] Phase 2 Summary: ${careInstructionsCreated} care instructions created, ${careInstructionsFailed} failed, ${autoCreatedCareInstructions.size} total in map`);
      } else {
        console.log('⚠️ [CLOUD] Phase 2: Skipped - no fabrics in dataset');
      }

      // Import order: brands, linings, trimmings, mechanisations, care_instructions first, then fabrics, then dependent products
      const importOrder = ['brands', 'linings', 'trimmings', 'mechanisations', 'care_instructions', 'fabrics', 'curtains', 'blinds', 'cushions'];

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
            
            // Auto-generate productId and slug for specific types only (check schema)
            const schemasWithProductId = ['fabrics']; // Only fabrics have productId and slug fields
            if (schemasWithProductId.includes(productType)) {
              // Generate productId if missing
              if (!item.productId || item.productId.trim() === '') {
                const productName = item.name || 'UNKNOWN';
                const timestamp = Date.now().toString().slice(-4);
                const cleanName = productName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
                const prefix = productType.toUpperCase().slice(0, 3);
                item.productId = `${prefix}-${cleanName}-${timestamp}`;
                console.log(`🔧 Auto-generated productId for ${productType}: ${item.productId}`);
              }
              
              // Generate slug if missing (let Strapi's UID plugin handle it)
              if (!item.slug || item.slug.trim() === '') {
                // Don't set slug - let Strapi's UID plugin auto-generate from productId
                console.log(`🔧 Slug will be auto-generated by Strapi UID plugin for ${productType}`);
              }
            }
            
            // Handle thumbnail_url for brands
            if (productType === 'brands' && item.thumbnail_url) {
              try {
                console.log(`🖼️ Processing thumbnail URL for brand: ${item.name} - ${item.thumbnail_url}`);
                
                // Fetch image from URL
                const response = await fetch(item.thumbnail_url);
                if (!response.ok) {
                  throw new Error(`Failed to fetch image: ${response.status}`);
                }
                
                const imageBuffer = await response.buffer();
                const fileName = `brand-${item.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}.jpg`;
                
                // Upload to Strapi media library
                const uploadedFile = await strapi.plugins.upload.services.upload.upload({
                  data: {
                    fileInfo: {
                      name: fileName,
                      alternativeText: `Thumbnail for ${item.name}`,
                      caption: `Brand thumbnail for ${item.name}`
                    }
                  },
                  files: {
                    file: {
                      name: fileName,
                      type: response.headers.get('content-type') || 'image/jpeg',
                      size: imageBuffer.length,
                      stream: () => require('stream').Readable.from(imageBuffer)
                    }
                  }
                });
                
                if (uploadedFile && uploadedFile.length > 0) {
                  item.thumbnail = uploadedFile[0].id;
                  console.log(`✅ Uploaded thumbnail for brand ${item.name}: ${uploadedFile[0].id}`);
                }
                
                delete item.thumbnail_url; // Remove the URL field
              } catch (error) {
                console.warn(`⚠️ Failed to process thumbnail for brand ${item.name}:`, error.message);
                delete item.thumbnail_url; // Remove the URL field to avoid validation errors
                results.errors.push({
                  type: 'thumbnail_error',
                  message: `Failed to process thumbnail for brand ${item.name}`,
                  error: error.message
                });
              }
            }
            
            // Handle brand_name to brand ID conversion for fabrics (only if not already converted by frontend)
            if (productType === 'fabrics' && item.brand_name && !item.brand) {
              const brandNameLower = item.brand_name.toLowerCase().trim();
              const originalBrandName = item.brand_name; // Store before deletion
              
              // #region agent log
              debugLog('D','import-export.js:fabricImport:brandLookup','Looking up brand for fabric',{fabricName:item.name,brandName:originalBrandName,brandNameLower,mapSize:autoCreatedBrands.size,mapHasBrand:autoCreatedBrands.has(brandNameLower),mapKeys:Array.from(autoCreatedBrands.keys())});
              // #endregion
              
              console.log(`🔍 [CLOUD] Looking up brand "${originalBrandName}" (normalized: "${brandNameLower}") for fabric "${item.name}"`);
              console.log(`🔍 [CLOUD] Brand map has ${autoCreatedBrands.size} entries. Keys: ${Array.from(autoCreatedBrands.keys()).slice(0, 5).join(', ')}...`);
              
              // First check auto-created brands map (includes all existing + newly created)
              if (autoCreatedBrands.has(brandNameLower)) {
                item.brand = autoCreatedBrands.get(brandNameLower);
                delete item.brand_name; // Remove the name field
                console.log(`✅ [CLOUD] Found brand in map for fabric "${item.name}": "${originalBrandName}" -> ID ${item.brand}`);
              } else {
                // Fallback: Check existing brands in database (shouldn't happen if map is populated correctly)
                console.log(`⚠️ [CLOUD] Brand "${originalBrandName}" not in map, checking database...`);
                try {
                  const existingBrands = await strapi.entityService.findMany('api::brand.brand', {
                    filters: { name: { $containsi: originalBrandName } }
                  });
                  if (existingBrands && existingBrands.length > 0) {
                    item.brand = existingBrands[0].id;
                    // Add to map for future lookups
                    autoCreatedBrands.set(brandNameLower, existingBrands[0].id);
                    delete item.brand_name; // Remove the name field
                    console.log(`✅ [CLOUD] Found brand in database for fabric "${item.name}": "${originalBrandName}" -> ID ${item.brand}`);
                  } else {
                    console.warn(`❌ [CLOUD] Brand "${originalBrandName}" not found for fabric "${item.name}" - fabric will be created without brand`);
                    console.warn(`❌ [CLOUD] This may indicate the brand auto-creation failed. Check errors array.`);
                    delete item.brand_name; // Remove the name field to avoid validation errors
                    results.errors.push({
                      type: 'missing_relation',
                      sheet: 'fabrics',
                      row: i + 1,
                      message: `Brand "${originalBrandName}" not found for fabric "${item.name}"`,
                      fabricName: item.name
                    });
                  }
                } catch (error) {
                  console.error(`❌ [CLOUD] Error looking up brand "${originalBrandName}":`, error);
                  delete item.brand_name;
                  results.errors.push({
                    type: 'relation_lookup_error',
                    sheet: 'fabrics',
                    row: i + 1,
                    message: `Error looking up brand "${originalBrandName}" for fabric "${item.name}"`,
                    error: error.message
                  });
                }
              }
            } else if (productType === 'fabrics' && item.brand) {
              console.log(`🔗 [CLOUD] Fabric "${item.name}" already has brand ID: ${item.brand} (converted by frontend)`);
            }
            
            // Handle care_instruction_names to care_instructions ID conversion for fabrics
            if (productType === 'fabrics' && item.care_instruction_names && !item.care_instructions) {
              const careNames = item.care_instruction_names.split(',').map(n => n.trim()).filter(n => n);
              const careInstructionIds = [];
              
              console.log(`🔍 [CLOUD] Looking up care instructions "${item.care_instruction_names}" for fabric "${item.name}"`);
              console.log(`🔍 [CLOUD] Care instruction map has ${autoCreatedCareInstructions.size} entries. Keys: ${Array.from(autoCreatedCareInstructions.keys()).slice(0, 5).join(', ')}...`);
              
              for (const careName of careNames) {
                const careNameLower = careName.toLowerCase().trim();
                
                // First check auto-created care instructions map (includes all existing + newly created)
                if (autoCreatedCareInstructions.has(careNameLower)) {
                  const careId = autoCreatedCareInstructions.get(careNameLower);
                  careInstructionIds.push(careId);
                  console.log(`✅ [CLOUD] Found care instruction in map for fabric "${item.name}": "${careName}" -> ID ${careId}`);
                } else {
                  // Fallback: Check existing care instructions in database
                  console.log(`⚠️ [CLOUD] Care instruction "${careName}" not in map, checking database...`);
                  try {
                    const existingCareInstructions = await strapi.entityService.findMany('api::care-instruction.care-instruction', {
                      filters: { name: { $containsi: careName } }
                    });
                    if (existingCareInstructions && existingCareInstructions.length > 0) {
                      const careId = existingCareInstructions[0].id;
                      careInstructionIds.push(careId);
                      // Add to map for future lookups
                      autoCreatedCareInstructions.set(careNameLower, careId);
                      console.log(`✅ [CLOUD] Found care instruction in database for fabric "${item.name}": "${careName}" -> ID ${careId}`);
                    } else {
                      console.warn(`❌ [CLOUD] Care instruction "${careName}" not found for fabric "${item.name}" - may indicate auto-creation failed`);
                      results.errors.push({
                        type: 'missing_relation',
                        sheet: 'fabrics',
                        row: i + 1,
                        message: `Care instruction "${careName}" not found for fabric "${item.name}"`,
                        fabricName: item.name
                      });
                    }
                  } catch (error) {
                    console.error(`❌ [CLOUD] Error looking up care instruction "${careName}":`, error);
                    results.errors.push({
                      type: 'relation_lookup_error',
                      sheet: 'fabrics',
                      row: i + 1,
                      message: `Error looking up care instruction "${careName}" for fabric "${item.name}"`,
                      error: error.message
                    });
                  }
                }
              }
              
              if (careInstructionIds.length > 0) {
                item.care_instructions = careInstructionIds;
                console.log(`✅ [CLOUD] Linked ${careInstructionIds.length} care instruction(s) to fabric "${item.name}"`);
              } else {
                console.warn(`⚠️ [CLOUD] No care instructions linked to fabric "${item.name}" - check errors array for details`);
              }
              delete item.care_instruction_names; // Remove the name field
            }
            
            console.log(`🚀 NEW UPSERT LOGIC - Importing ${productType} item ${i + 1}/${transformedDataset[productType].length}:`, item);
            
            // Implement UPSERT logic: update if exists and has changes, create if doesn't exist, skip if no changes
            let upsertedItem;
            let wasSkipped = false;
            
            if (productType === 'brands') {
              // For brands, check by name
              const existingBrand = await strapi.entityService.findMany('api::brand.brand', {
                filters: { name: item.name },
                populate: '*'
              });
              
              if (existingBrand && existingBrand.length > 0) {
                const existing = existingBrand[0];
                
                // Compare relevant fields to see if there are changes
                const hasChanges = (
                  (item.description !== undefined && item.description !== existing.description) ||
                  (item.thumbnail !== undefined && item.thumbnail !== existing.thumbnail)
                );
                
                if (hasChanges) {
                  // Update existing brand
                  upsertedItem = await strapi.entityService.update('api::brand.brand', existing.id, {
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
                upsertedItem = await strapi.entityService.create('api::brand.brand', {
                  data: item
                });
                console.log(`➕ Created new brand: ${item.name}`);
                results.created++;
              }
            } else if (productType === 'fabrics') {
              // For fabrics, check by productId (generate one if missing)
              if (!item.productId || item.productId.trim() === '') {
                const productName = item.name || 'UNKNOWN';
                const timestamp = Date.now().toString().slice(-4);
                const cleanName = productName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
                item.productId = `FAB-${cleanName}-${timestamp}`;
                console.log(`🔧 Auto-generated productId for fabric: ${item.productId}`);
              }
              
              const existingFabric = await strapi.entityService.findMany('api::fabric.fabric', {
                filters: { productId: item.productId },
                populate: {
                  brand: true,
                  care_instructions: true,
                  curtains: true,
                  blinds: true,
                  cushions: true
                }
              });
              
              if (existingFabric && existingFabric.length > 0) {
                const existing = existingFabric[0];
                
                // Compare relevant fields to see if there are changes
                // Helper to compare care instruction arrays
                const compareCareInstructions = (newCares, existingCares) => {
                  if (!newCares && (!existingCares || existingCares.length === 0)) return false;
                  if (!newCares || newCares.length === 0) return existingCares && existingCares.length > 0;
                  if (!existingCares || existingCares.length === 0) return newCares && newCares.length > 0;
                  
                  const newIds = Array.isArray(newCares) ? newCares.map(id => String(id)).sort() : [];
                  const existingIds = Array.isArray(existingCares) 
                    ? existingCares.map(ci => String(ci.id || ci)).sort() 
                    : [];
                  
                  if (newIds.length !== existingIds.length) return true;
                  return !newIds.every((id, idx) => id === existingIds[idx]);
                };
                
                const hasChanges = (
                  (item.name !== undefined && item.name !== existing.name) ||
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
                  (item.care_instructions !== undefined && compareCareInstructions(item.care_instructions, existing.care_instructions))
                );
                
                if (hasChanges) {
                  // Update existing fabric
                  upsertedItem = await strapi.entityService.update('api::fabric.fabric', existing.id, {
                    data: item
                  });
                  console.log(`🔄 Updated existing fabric: ${item.name} (${item.productId})`);
                  results.updated++;
                } else {
                  // Skip - no changes needed
                  console.log(`⏭️ Skipped fabric (no changes): ${item.name} (${item.productId})`);
                  wasSkipped = true;
                  results.skipped++;
                }
              } else {
                // Create new fabric
                // Apply color code resolution to auto-create colour records
                if (productType === 'fabrics') {
                  try {
                    const { resolveFabricWithColour } = require('../../api/fabric/services/color-code-matcher');
                    const resolvedItem = await resolveFabricWithColour(strapi, item);
                    if (resolvedItem) {
                      item = resolvedItem;
                    }
                  } catch (colorCodeError) {
                    console.warn(`⚠️ Color code resolution failed for fabric "${item.name}":`, colorCodeError.message);
                    // Continue without color code resolution
                  }
                }
                
                upsertedItem = await strapi.entityService.create('api::fabric.fabric', {
              data: item
            });
                console.log(`➕ Created new fabric: ${item.name} (${item.productId})`);
                results.created++;
              }
            } else {
              // For other types, use name as unique identifier
              const existingItem = await strapi.entityService.findMany(contentType, {
                filters: { name: item.name },
                populate: '*'
              });
              
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
                  (item.formula !== undefined && JSON.stringify(item.formula) !== JSON.stringify(existing.formula))
                );
                
                if (hasChanges) {
                  // Update existing item
                  upsertedItem = await strapi.entityService.update(contentType, existing.id, {
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
                upsertedItem = await strapi.entityService.create(contentType, {
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

      // Add auto-creation summary to results - ALWAYS create it, even if phases didn't run
      const autoCreateSummary = {
        brandsCreated: brandsCreated || 0,
        brandsFailed: brandsFailed || 0,
        careInstructionsCreated: careInstructionsCreated || 0,
        careInstructionsFailed: careInstructionsFailed || 0,
        totalBrandsInMap: (autoCreatedBrands && autoCreatedBrands.size) || 0,
        totalCareInstructionsInMap: (autoCreatedCareInstructions && autoCreatedCareInstructions.size) || 0
      };
      
      // Explicitly set the summary on results object
      results.autoCreationSummary = autoCreateSummary;
      
      console.log('═══════════════════════════════════════════════════════════');
      console.log('📊 [CLOUD] AUTO-CREATION SUMMARY:');
      console.log(`   Brands: ${autoCreateSummary.brandsCreated} created, ${autoCreateSummary.brandsFailed} failed`);
      console.log(`   Care Instructions: ${autoCreateSummary.careInstructionsCreated} created, ${autoCreateSummary.careInstructionsFailed} failed`);
      console.log(`   Total brands in map: ${autoCreateSummary.totalBrandsInMap}`);
      console.log(`   Total care instructions in map: ${autoCreateSummary.totalCareInstructionsInMap}`);
      console.log('═══════════════════════════════════════════════════════════');
      
      console.log('📤 [CLOUD] Server-side bulk import completed:', results);
      console.log('🎯 [CLOUD] RETURNING NEW RESULT STRUCTURE:', {
        created: results.created,
        updated: results.updated,
        skipped: results.skipped,
        failed: results.failed,
        errorCount: results.errors.length,
        autoCreationSummary: autoCreateSummary,
        errors: results.errors.slice(0, 5) // Log first 5 errors
      });
      
      // Verify autoCreationSummary is on results before sending
      if (!results.autoCreationSummary) {
        console.error('❌ [CLOUD] CRITICAL: autoCreationSummary is missing from results object!');
        console.error('❌ [CLOUD] Results object keys:', Object.keys(results));
        // Force add it again
        results.autoCreationSummary = autoCreateSummary;
      } else {
        console.log('✅ [CLOUD] Verified: autoCreationSummary is present in results object');
        console.log('✅ [CLOUD] autoCreationSummary value:', JSON.stringify(results.autoCreationSummary));
      }
      
      // Ensure errors array is always present and properly formatted
      if (!results.errors) {
        results.errors = [];
      }
      
      // Log summary of auto-creation phase
      const autoCreateErrors = results.errors.filter(e => e.type === 'auto_create_error');
      if (autoCreateErrors.length > 0) {
        console.warn(`⚠️ [CLOUD] ${autoCreateErrors.length} auto-creation errors occurred. This may affect relations.`);
        console.warn(`⚠️ [CLOUD] Auto-creation errors:`, autoCreateErrors.map(e => e.message).join(', '));
      }
      
      // Warn if auto-creation didn't run
      if (autoCreateSummary.brandsCreated === 0 && autoCreateSummary.brandsFailed === 0 && brandNames && brandNames.size > 0) {
        console.error(`❌ [CLOUD] WARNING: No brands were created or failed! This suggests the auto-creation loop did not run.`);
        console.error(`❌ [CLOUD] Brand names found: ${Array.from(brandNames).join(', ')}`);
        results.errors.push({
          type: 'auto_creation_warning',
          message: `No brands were created despite finding ${brandNames.size} unique brand names. Check logs for details.`,
          brandNames: Array.from(brandNames)
        });
      }
      if (autoCreateSummary.careInstructionsCreated === 0 && autoCreateSummary.careInstructionsFailed === 0 && careInstructionNames && careInstructionNames.size > 0) {
        console.error(`❌ [CLOUD] WARNING: No care instructions were created or failed! This suggests the auto-creation loop did not run.`);
        console.error(`❌ [CLOUD] Care instruction names found: ${Array.from(careInstructionNames).join(', ')}`);
        results.errors.push({
          type: 'auto_creation_warning',
          message: `No care instructions were created despite finding ${careInstructionNames.size} unique care instruction names. Check logs for details.`,
          careInstructionNames: Array.from(careInstructionNames)
        });
      }
      
      // Add validation summary to help debug issues
      if (transformedDataset.fabrics && transformedDataset.fabrics.length > 0) {
        const fabricsWithBrands = transformedDataset.fabrics.filter(f => f.brand_name).length;
        const fabricsWithCareInstructions = transformedDataset.fabrics.filter(f => f.care_instruction_names).length;
        console.log(`📊 [CLOUD] Data validation summary:`);
        console.log(`   - Total fabrics: ${transformedDataset.fabrics.length}`);
        console.log(`   - Fabrics with brand_name: ${fabricsWithBrands}`);
        console.log(`   - Fabrics with care_instruction_names: ${fabricsWithCareInstructions}`);
        console.log(`   - Unique brands found: ${brandNames?.size || 0}`);
        console.log(`   - Unique care instructions found: ${careInstructionNames?.size || 0}`);
      }
      
      // Final verification before sending response
      console.log('🔍 [CLOUD] Final check - results object has autoCreationSummary:', 'autoCreationSummary' in results);
      console.log('🔍 [CLOUD] Final check - results.autoCreationSummary value:', results.autoCreationSummary);
      console.log('🔍 [CLOUD] Final check - typeof results.autoCreationSummary:', typeof results.autoCreationSummary);
      
      // Ensure autoCreationSummary is always present in response
      if (!results.autoCreationSummary) {
        console.warn('⚠️ [CLOUD] autoCreationSummary missing, creating default');
        results.autoCreationSummary = {
          brandsCreated: 0,
          brandsFailed: 0,
          careInstructionsCreated: 0,
          careInstructionsFailed: 0,
          totalBrandsInMap: 0,
          totalCareInstructionsInMap: 0
        };
      }
      
      // Explicitly set response body with all required fields
      ctx.body = {
        created: results.created || 0,
        updated: results.updated || 0,
        skipped: results.skipped || 0,
        failed: results.failed || 0,
        errors: results.errors || [],
        autoCreationSummary: results.autoCreationSummary
      };
      
      // Log what was actually sent
      console.log('📤 [CLOUD] Response sent. ctx.body has autoCreationSummary:', 'autoCreationSummary' in ctx.body);
      console.log('📤 [CLOUD] Response structure:', {
        hasCreated: 'created' in ctx.body,
        hasUpdated: 'updated' in ctx.body,
        hasSkipped: 'skipped' in ctx.body,
        hasFailed: 'failed' in ctx.body,
        hasErrors: 'errors' in ctx.body,
        hasAutoCreationSummary: 'autoCreationSummary' in ctx.body
      });
    } catch (error) {
      const errorDetails = {
        message: error.message,
        stack: error.stack,
        name: error.name
      };
      console.error('❌ [CLOUD] Server-side bulk import error:', errorDetails);
      console.error('❌ [CLOUD] Full error object:', error);
      ctx.status = 500;
      ctx.body = { 
        error: error.message,
        details: errorDetails,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        errors: [{
          type: 'fatal_error',
          message: error.message,
          error: error.message,
          details: errorDetails
        }],
        autoCreationSummary: {
          brandsCreated: 0,
          brandsFailed: 0,
          careInstructionsCreated: 0,
          careInstructionsFailed: 0,
          totalBrandsInMap: 0,
          totalCareInstructionsInMap: 0
        }
      };
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
        brands: 'api::brand.brand'
      };

      const allProducts = {};

      // Fetch all products for each type
      for (const [productType, contentType] of Object.entries(contentTypes)) {
        try {
          let products;
          
          if (selectedProductsByType && selectedProductsByType[productType] && selectedProductsByType[productType].length > 0) {
            // Export only selected products
            const selectedIds = selectedProductsByType[productType];
            products = await strapi.entityService.findMany(contentType, {
              filters: { id: { $in: selectedIds } },
              populate: '*'
            });
          } else {
            // Export all products
            products = await strapi.entityService.findMany(contentType, {
              populate: '*'
            });
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
        'curtain-types': 'api::curtain-type.curtain-type',
        'blind-types': 'api::blind-type.blind-type',
        'cushion-types': 'api::cushion-type.cushion-type'
      };

      const relationData = {};

      // Fetch all relation data
      for (const [type, contentType] of Object.entries(contentTypes)) {
        try {
          const items = await strapi.entityService.findMany(contentType, {
            populate: '*'
          });
          
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

  // Parse PDF file and extract structured data
  async parsePDF(ctx) {
    try {
      console.log('📄 Starting PDF parsing...');
      console.log('📄 Request method:', ctx.request.method);
      console.log('📄 Request path:', ctx.request.path);
      console.log('📄 Request headers:', ctx.request.headers);
      console.log('📄 Request body keys:', Object.keys(ctx.request.body || {}));
      console.log('📄 Request files:', ctx.request.files ? Object.keys(ctx.request.files) : 'no files');
      
      // Get uploaded file from multipart form data
      // Strapi uses koa-body, files can be in different locations
      const files = ctx.request.files || ctx.request.body?.files;
      const file = files?.file || files?.['files.file'] || ctx.request.body?.file;
      
      if (!file) {
        ctx.status = 400;
        ctx.body = { error: 'No PDF file provided' };
        return;
      }

      console.log(`📄 PDF file received:`, {
        name: file.name || file.originalname,
        size: file.size,
        type: file.type || file.mimetype,
        path: file.path || file.filepath
      });

      // Check file type
      const fileName = (file.name || file.originalname || '').toLowerCase();
      const fileType = (file.type || file.mimetype || '').toLowerCase();
      if (!fileType.includes('pdf') && !fileName.endsWith('.pdf')) {
        ctx.status = 400;
        ctx.body = { error: 'File must be a PDF' };
        return;
      }

      // Read PDF file
      const fs = require('fs');
      const path = require('path');
      const pdfParse = require('pdf-parse');
      
      let pdfBuffer;
      
      // Try different ways to get the file buffer
      if (file.buffer) {
        // File is already in memory as buffer
        pdfBuffer = file.buffer;
      } else if (file.path || file.filepath) {
        // File is on disk, read it
        const filePath = file.path || file.filepath;
        pdfBuffer = fs.readFileSync(filePath);
        
        // Clean up temporary file after reading
        try {
          fs.unlinkSync(filePath);
        } catch (err) {
          console.warn('⚠️ Could not delete temporary PDF file:', err);
        }
      } else if (file.stream) {
        // File is a stream, convert to buffer
        const chunks = [];
        for await (const chunk of file.stream) {
          chunks.push(chunk);
        }
        pdfBuffer = Buffer.concat(chunks);
      } else {
        throw new Error('Could not read PDF file - no buffer, path, or stream available');
      }
      
      const pdfData = await pdfParse(pdfBuffer);
      
      console.log(`📄 PDF parsed: ${pdfData.numpages} pages, ${pdfData.text.length} characters`);

      // Extract text content
      const text = pdfData.text;
      
      // Parse structured data from PDF text
      // This is a basic parser - you may need to customize based on your PDF structure
      const parsedData = parsePDFText(text);
      
      console.log(`📄 Extracted data:`, Object.keys(parsedData).map(key => `${key}: ${parsedData[key].length} items`).join(', '));

      
      ctx.body = {
        success: true,
        data: parsedData,
        message: `Successfully parsed PDF: ${pdfData.numpages} pages`
      };
    } catch (error) {
      console.error('❌ Error parsing PDF:', error);
      ctx.status = 500;
      ctx.body = { error: error.message || 'Failed to parse PDF' };
    }
  },

  // Look up a color code and return the color name
  async lookupColorCode(ctx) {
    try {
      const { code } = ctx.query;

      if (!code || code.trim().length === 0) {
        ctx.status = 400;
        ctx.body = { error: 'Color code is required' };
        return;
      }

      // Import color-code-matcher service
      const { matchColorCodeToRecord } = require('../../api/fabric/services/color-code-matcher');

      // Look up the color code
      const colorCodeRecord = await matchColorCodeToRecord(strapi, code);

      if (!colorCodeRecord) {
        ctx.status = 404;
        ctx.body = { error: `Color code "${code}" not found` };
        return;
      }

      ctx.body = {
        success: true,
        data: colorCodeRecord,
        message: `Color code "${code}" found: "${colorCodeRecord.name}"`
      };
    } catch (error) {
      console.error('❌ Error looking up color code:', error);
      ctx.status = 500;
      ctx.body = { error: error.message || 'Failed to look up color code' };
    }
  },

  // Create fabric with automatic colour based on color code
  async createFabricWithColour(ctx) {
    try {
      const { fabric, imageId } = ctx.request.body;

      if (!fabric || !fabric.name) {
        ctx.status = 400;
        ctx.body = { error: 'Fabric data with name is required' };
        return;
      }

      // Import color-code-matcher service
      const { resolveFabricWithColour } = require('../../api/fabric/services/color-code-matcher');

      // Resolve fabric with automatic colour creation
      const fabricWithColour = await resolveFabricWithColour(strapi, fabric, imageId);

      if (!fabricWithColour) {
        ctx.status = 500;
        ctx.body = { error: 'Failed to process fabric with colour' };
        return;
      }

      // Create the fabric in Strapi
      const createdFabric = await strapi.entityService.create('api::fabric.fabric', {
        data: fabricWithColour,
      });

      ctx.body = {
        success: true,
        data: createdFabric,
        message: `Fabric "${fabric.name}" created successfully`
      };
    } catch (error) {
      console.error('❌ Error creating fabric with colour:', error);
      ctx.status = 500;
      ctx.body = { error: error.message || 'Failed to create fabric' };
    }
  }
};

/**
 * Parse PDF text and extract structured data
 * This function attempts to extract table data and map it to fabric schema
 */
function parsePDFText(text) {
  const result = {
    fabrics: [],
    care_instructions: []
  };

  // Split text into lines
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  // Try to identify table structure
  // Look for patterns that might indicate table headers
  let headerLineIndex = -1;
  const possibleHeaders = ['product', 'name', 'code', 'price', 'composition', 'pattern', 'width', 'care'];
  
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const lineLower = lines[i].toLowerCase();
    const headerMatches = possibleHeaders.filter(header => lineLower.includes(header));
    if (headerMatches.length >= 3) {
      headerLineIndex = i;
      break;
    }
  }

  // If we found headers, try to parse as table
  if (headerLineIndex >= 0) {
    console.log(`📄 Found potential table headers at line ${headerLineIndex + 1}`);
    
    // Extract header row
    const headerLine = lines[headerLineIndex];
    const headers = headerLine.split(/\s{2,}|\t/).map(h => h.trim().toLowerCase());
    
    console.log(`📄 Detected headers:`, headers);
    
    // Parse data rows (next 100 rows or until end)
    const dataStartIndex = headerLineIndex + 1;
    const dataEndIndex = Math.min(dataStartIndex + 100, lines.length);
    
    for (let i = dataStartIndex; i < dataEndIndex; i++) {
      const line = lines[i];
      
      // Skip empty lines or lines that look like headers
      if (line.length < 10 || possibleHeaders.some(h => line.toLowerCase().includes(h))) {
        continue;
      }
      
      // Try to split by multiple spaces or tabs
      const values = line.split(/\s{2,}|\t/).map(v => v.trim()).filter(v => v.length > 0);
      
      if (values.length >= 3) {
        // Map values to fabric object
        const fabric = mapPDFRowToFabric(values, headers);
        if (fabric && fabric.name) {
          result.fabrics.push(fabric);
        }
      }
    }
  } else {
    // No clear table structure - try to extract data using patterns
    console.log('📄 No clear table structure found, attempting pattern-based extraction...');
    
    // Look for product codes, prices, etc.
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Look for price patterns (e.g., £25.50, $30.00, 25.50)
      const priceMatch = line.match(/(?:£|\$|€)?\s*(\d+\.?\d*)/);
      // Look for product codes (alphanumeric codes)
      const codeMatch = line.match(/\b([A-Z]{2,}\d{2,}|\d{2,}[A-Z]{2,})\b/);
      // Look for dimensions (e.g., 140cm, 20cm)
      const dimensionMatch = line.match(/(\d+)\s*cm/gi);
      
      if (priceMatch || codeMatch) {
        const fabric = {
          name: line.substring(0, 50).trim() || `Product ${result.fabrics.length + 1}`,
          productId: codeMatch ? codeMatch[1] : `FAB-${Date.now()}-${result.fabrics.length + 1}`,
          price_per_metre: priceMatch ? parseFloat(priceMatch[1]) : null,
          patternRepeat_cm: null,
          usableWidth_cm: dimensionMatch && dimensionMatch.length > 0 ? parseFloat(dimensionMatch[0]) : null,
          composition: extractComposition(line),
          pattern: extractPattern(line),
          availability: 'in_stock',
          is_featured: false
        };
        
        // Extract care instructions if mentioned
        const careText = extractCareInstructions(line);
        if (careText) {
          result.care_instructions.push({
            name: careText
          });
        }
        
        result.fabrics.push(fabric);
      }
    }
  }

  // Remove duplicates based on productId
  const uniqueFabrics = [];
  const seenIds = new Set();
  result.fabrics.forEach(fabric => {
    if (fabric.productId && !seenIds.has(fabric.productId)) {
      seenIds.add(fabric.productId);
      uniqueFabrics.push(fabric);
    } else if (!fabric.productId) {
      // Generate unique ID for fabrics without one
      const uniqueId = `FAB-${Date.now()}-${uniqueFabrics.length + 1}`;
      fabric.productId = uniqueId;
      uniqueFabrics.push(fabric);
    }
  });
  result.fabrics = uniqueFabrics;

  // Remove duplicate care instructions
  const uniqueCareInstructions = [];
  const seenCare = new Set();
  result.care_instructions.forEach(ci => {
    if (!seenCare.has(ci.name.toLowerCase())) {
      seenCare.add(ci.name.toLowerCase());
      uniqueCareInstructions.push(ci);
    }
  });
  result.care_instructions = uniqueCareInstructions;

  return result;
}

/**
 * Map PDF row values to fabric object based on headers
 */
function mapPDFRowToFabric(values, headers) {
  const fabric = {
    availability: 'in_stock',
    is_featured: false
  };

  headers.forEach((header, index) => {
    const value = values[index] || '';
    
    if (header.includes('name') || header.includes('product') || header.includes('description')) {
      fabric.name = value || fabric.name || 'Unknown Product';
    } else if (header.includes('code') || header.includes('id') || header.includes('sku')) {
      fabric.productId = value || `FAB-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    } else if (header.includes('price') || header.includes('cost')) {
      const price = parseFloat(value.replace(/[£$€,]/g, ''));
      if (!isNaN(price)) {
        fabric.price_per_metre = price;
      }
    } else if (header.includes('width') || header.includes('usable')) {
      const width = parseFloat(value.replace(/[cm]/gi, ''));
      if (!isNaN(width)) {
        fabric.usableWidth_cm = width;
      }
    } else if (header.includes('repeat') || header.includes('pattern repeat')) {
      const repeat = parseFloat(value.replace(/[cm]/gi, ''));
      if (!isNaN(repeat)) {
        fabric.patternRepeat_cm = repeat;
      }
    } else if (header.includes('composition') || header.includes('material')) {
      fabric.composition = value;
    } else if (header.includes('pattern')) {
      fabric.pattern = value;
    } else if (header.includes('martindale') || header.includes('durability')) {
      const martindale = parseInt(value);
      if (!isNaN(martindale)) {
        fabric.martindale = martindale;
      }
    } else if (header.includes('care') || header.includes('washing')) {
      // This will be handled separately for care instructions
    }
  });

  // Ensure required fields have defaults
  if (!fabric.name) {
    fabric.name = values[0] || 'Unknown Product';
  }
  if (!fabric.productId) {
    fabric.productId = `FAB-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  }
  if (!fabric.composition) {
    fabric.composition = extractComposition(values.join(' '));
  }
  if (!fabric.pattern) {
    fabric.pattern = extractPattern(values.join(' ')) || 'Solid';
  }
  if (fabric.price_per_metre === undefined || fabric.price_per_metre === null) {
    // Try to extract price from all values
    const priceMatch = values.join(' ').match(/(?:£|\$|€)?\s*(\d+\.?\d*)/);
    if (priceMatch) {
      fabric.price_per_metre = parseFloat(priceMatch[1]);
    }
  }

  return fabric;
}

/**
 * Extract composition from text
 */
function extractComposition(text) {
  const compositionPatterns = [
    /(\d+%?\s*(?:cotton|polyester|linen|silk|wool|viscose|acrylic|nylon|blend))/gi,
    /(100%\s*(?:cotton|polyester|linen|silk|wool|viscose|acrylic|nylon))/gi
  ];
  
  for (const pattern of compositionPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0].trim();
    }
  }
  
  return 'Unknown';
}

/**
 * Extract pattern from text
 */
function extractPattern(text) {
  const patternKeywords = ['solid', 'striped', 'floral', 'geometric', 'abstract', 'plain', 'check', 'plaid'];
  const textLower = text.toLowerCase();
  
  for (const keyword of patternKeywords) {
    if (textLower.includes(keyword)) {
      return keyword.charAt(0).toUpperCase() + keyword.slice(1);
    }
  }
  
  return 'Solid';
}

/**
 * Extract care instructions from text
 */
function extractCareInstructions(text) {
  const careKeywords = [
    'machine wash', 'hand wash', 'dry clean', 'do not bleach',
    'tumble dry', 'line dry', 'iron', 'steam', 'delicate'
  ];
  
  const textLower = text.toLowerCase();
  for (const keyword of careKeywords) {
    if (textLower.includes(keyword)) {
      return keyword.charAt(0).toUpperCase() + keyword.slice(1);
    }
  }
  
  return null;
}

