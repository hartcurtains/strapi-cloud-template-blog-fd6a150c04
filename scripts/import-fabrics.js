/**
 * Import Fabrics from JSON with Relations
 * 
 * This script imports fabrics from fixed-fabrics-import.json
 * and handles relations with brands and care_instructions
 */

const fs = require('fs');
const path = require('path');

module.exports = async ({ strapi }) => {
  console.log('🚀 Starting fabric import...');
  
  const jsonPath = path.join(process.cwd(), 'fixed-fabrics-import.json');
  
  if (!fs.existsSync(jsonPath)) {
    console.error('❌ fixed-fabrics-import.json not found!');
    return;
  }

  const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const fabrics = jsonData.fabrics || [];

  console.log(`📦 Found ${fabrics.length} fabrics to import`);

  // Fix pattern if patternRepeat_cm = 0
  fabrics.forEach(fabric => {
    if (fabric.patternRepeat_cm === 0) {
      fabric.pattern = 'Plain';
    }
  });

  // Step 1: Get or create brands
  const brandMap = new Map();
  const uniqueBrands = [...new Set(fabrics.map(f => f.brand_name).filter(Boolean))];
  
  console.log(`🏷️  Processing ${uniqueBrands.length} brands...`);
  for (const brandName of uniqueBrands) {
    try {
      // Try to find existing brand
      let brand = await strapi.entityService.findMany('api::brand.brand', {
        filters: { name: brandName },
        limit: 1,
      });

      if (!brand || brand.length === 0) {
        // Create new brand
        brand = await strapi.entityService.create('api::brand.brand', {
          data: {
            name: brandName,
            publishedAt: new Date(),
          },
        });
        console.log(`  ✅ Created brand: ${brandName}`);
      } else {
        brand = brand[0];
        console.log(`  ✓ Found existing brand: ${brandName}`);
      }
      
      brandMap.set(brandName, brand.id);
    } catch (error) {
      console.error(`  ❌ Error processing brand ${brandName}:`, error.message);
    }
  }

  // Step 2: Get or create care instructions
  const careInstructionMap = new Map();
  const allCareInstructions = new Set();
  
  fabrics.forEach(fabric => {
    if (fabric.care_instruction_names) {
      // Split by comma and trim
      const instructions = fabric.care_instruction_names
        .split(',')
        .map(i => i.trim())
        .filter(Boolean);
      instructions.forEach(inst => allCareInstructions.add(inst));
    }
  });

  console.log(`🧼 Processing ${allCareInstructions.size} care instructions...`);
  for (const careName of allCareInstructions) {
    try {
      // Try to find existing care instruction
      let careInstruction = await strapi.entityService.findMany('api::care-instruction.care-instruction', {
        filters: { name: careName },
        limit: 1,
      });

      if (!careInstruction || careInstruction.length === 0) {
        // Create new care instruction
        careInstruction = await strapi.entityService.create('api::care-instruction.care-instruction', {
          data: {
            name: careName,
            publishedAt: new Date(),
          },
        });
        console.log(`  ✅ Created care instruction: ${careName}`);
      } else {
        careInstruction = careInstruction[0];
        console.log(`  ✓ Found existing care instruction: ${careName}`);
      }
      
      careInstructionMap.set(careName, careInstruction.id);
    } catch (error) {
      console.error(`  ❌ Error processing care instruction ${careName}:`, error.message);
    }
  }

  // Step 3: Import fabrics
  console.log(`🧵 Importing ${fabrics.length} fabrics...`);
  let imported = 0;
  let updated = 0;
  let failed = 0;

  for (const fabricData of fabrics) {
    try {
      // Check if fabric already exists by productId
      const existing = await strapi.entityService.findMany('api::fabric.fabric', {
        filters: { productId: fabricData.productId },
        limit: 1,
      });

      // Prepare fabric data
      const fabricPayload = {
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
          .map(i => i.trim())
          .filter(Boolean);
        
        const careIds = careNames
          .map(name => careInstructionMap.get(name))
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
    } catch (error) {
      failed++;
      console.error(`\n❌ Error importing fabric ${fabricData.productId}:`, error.message);
    }
  }

  console.log(`\n\n📊 Import Summary:`);
  console.log(`   ✅ Created: ${imported}`);
  console.log(`   🔄 Updated: ${updated}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📦 Total: ${fabrics.length}`);
  console.log('✅ Fabric import complete!');
};





