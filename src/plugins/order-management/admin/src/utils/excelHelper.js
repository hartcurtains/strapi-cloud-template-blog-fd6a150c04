import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

export const excelHelper = {
  // Export all products to multi-sheet Excel
  exportToExcel: (allProducts, filename = 'all-products.xlsx') => {
    try {
      const workbook = XLSX.utils.book_new();
      
      // Define product type configurations
      const productConfigs = {
        fabrics: {
          name: 'Fabrics',
          fields: ['id', 'name', 'description', 'productId', 'brand_name', 'slug', 'colour', 'pattern', 'composition', 'price_per_metre', 'patternRepeat_cm', 'usableWidth_cm', 'martindale', 'availability', 'is_featured', 'featured_until', 'curtain_names', 'blind_names', 'cushion_names', 'care_instruction_names', 'createdAt', 'updatedAt'],
          widths: [8, 25, 40, 15, 20, 15, 15, 15, 20, 20, 12, 12, 12, 12, 12, 10, 20, 20, 20, 20, 20, 20, 20],
          relations: ['brand', 'curtains', 'blinds', 'cushions', 'care_instructions']
        },
        curtains: {
          name: 'Curtains',
          fields: ['id', 'name', 'description', 'fabric_names', 'lining_names', 'trimming_names', 'curtain_type_name', 'pricing_rules_names', 'price_per_metre', 'availability', 'createdAt', 'updatedAt'],
          widths: [8, 25, 40, 30, 20, 20, 20, 30, 12, 12, 20, 20],
          relations: ['fabrics', 'linings', 'trimmings', 'curtain_type', 'pricing_rules']
        },
        blinds: {
          name: 'Blinds',
          fields: ['id', 'name', 'description', 'fabric_names', 'lining_names', 'trimming_names', 'mechanisation_names', 'blind_type_name', 'pricing_rules_names', 'price_per_metre', 'availability', 'createdAt', 'updatedAt'],
          widths: [8, 25, 40, 30, 20, 20, 20, 20, 30, 12, 12, 20, 20],
          relations: ['fabrics', 'linings', 'trimmings', 'mechanisations', 'blind_type', 'pricing_rules']
        },
        cushions: {
          name: 'Cushions',
          fields: ['id', 'name', 'description', 'fabric_names', 'cushion_type_name', 'pricing_rules_names', 'price_per_metre', 'availability', 'createdAt', 'updatedAt'],
          widths: [8, 25, 40, 30, 20, 30, 12, 12, 20, 20],
          relations: ['fabrics', 'cushion_type', 'pricing_rules']
        },
        linings: {
          name: 'Linings',
          fields: ['id', 'liningType', 'price', 'colour', 'fabric_names', 'createdAt', 'updatedAt'],
          widths: [8, 20, 12, 15, 30, 20, 20],
          relations: ['fabrics']
        },
        trimmings: {
          name: 'Trimmings',
          fields: ['id', 'type', 'price', 'fabric_names', 'createdAt', 'updatedAt'],
          widths: [8, 20, 12, 30, 20, 20],
          relations: ['fabrics']
        },
        mechanisations: {
          name: 'Mechanisations',
          fields: ['id', 'type', 'price', 'blind_names', 'createdAt', 'updatedAt'],
          widths: [8, 20, 12, 30, 20, 20],
          relations: ['blinds']
        },
        brands: {
          name: 'Brands',
          fields: ['id', 'name', 'description', 'thumbnail_url', 'fabric_names', 'createdAt', 'updatedAt'],
          widths: [8, 25, 40, 30, 30, 20, 20],
          relations: ['fabrics']
        },
        pricing_rules: {
          name: 'Pricing Rules',
          fields: ['id', 'name', 'product_type', 'formula', 'curtain_names', 'blind_names', 'cushion_names', 'createdAt', 'updatedAt'],
          widths: [8, 25, 15, 40, 30, 30, 30, 20, 20],
          relations: ['curtains', 'blinds', 'cushions']
        },
        care_instructions: {
          name: 'Care Instructions',
          fields: ['id', 'name', 'description', 'fabric_names', 'createdAt', 'updatedAt'],
          widths: [8, 25, 40, 40, 20, 20],
          relations: ['fabrics']
        }
      };

      // Track export summary
      let totalExported = 0;
      let totalSkipped = 0;
      
      // Process each product type
      Object.keys(productConfigs).forEach(productType => {
        const config = productConfigs[productType];
        const products = allProducts[productType] || [];
        
        // Always create sheets, even if empty (so users can see the structure)
        console.log(`📊 Creating sheet for ${productType}: ${products.length} products`);
        
        // Validate and filter products with missing required fields
        const validProducts = [];
        const skippedProducts = [];
        
        products.forEach((product) => {
          // Validate required fields based on product type
          let isValid = true;
          let missingFields = [];
          
          // All product types require 'name'
          if (!product.name || product.name.trim() === '') {
            missingFields.push('name');
            isValid = false;
          }
          
          // Type-specific validation
          if (productType === 'fabrics' && (!product.productId || product.productId.trim() === '')) {
            missingFields.push('productId');
            isValid = false;
          }
          
          if (productType === 'linings' && (!product.liningType || product.liningType.trim() === '')) {
            missingFields.push('liningType');
            isValid = false;
          }
          
          if (productType === 'trimmings' && (!product.type || product.type.trim() === '')) {
            missingFields.push('type');
            isValid = false;
          }
          
          if (productType === 'mechanisations' && (!product.type || product.type.trim() === '')) {
            missingFields.push('type');
            isValid = false;
          }
          
          if (isValid) {
            validProducts.push(product);
          } else {
            skippedProducts.push({
              id: product.id,
              name: product.name || '(no name)',
              missingFields: missingFields
            });
          }
        });
        
        // Log skipped products
        if (skippedProducts.length > 0) {
          console.warn(`⚠️ Skipped ${skippedProducts.length} ${productType} with missing data:`, skippedProducts);
          totalSkipped += skippedProducts.length;
        }
        
        totalExported += validProducts.length;
        
        // Flatten valid products with relations
        const flattenedProducts = validProducts.map(product => {
          const flattened = {};
          
          // Add basic fields
          config.fields.forEach(field => {
            if (field === 'brand_name') {
              // Special handling for brand_name - extract from populated brand relation
              flattened[field] = product.brand?.name || '';
            } else if (field === 'curtain_type_name') {
              // Special handling for curtain_type_name - extract from populated curtain_type relation
              flattened[field] = product.curtain_type?.name || '';
            } else if (field === 'blind_type_name') {
              // Special handling for blind_type_name - extract from populated blind_type relation
              flattened[field] = product.blind_type?.name || '';
            } else if (field === 'cushion_type_name') {
              // Special handling for cushion_type_name - extract from populated cushion_type relation
              flattened[field] = product.cushion_type?.name || '';
            } else if (field === 'fabric_names') {
              // Special handling for fabric_names - extract from populated fabrics relation
              if (product.fabrics && Array.isArray(product.fabrics)) {
                const names = product.fabrics.map(f => f?.name || '').filter(Boolean);
                flattened[field] = names.length > 0 ? names.join(', ') : '';
              } else {
                flattened[field] = '';
              }
            } else if (field === 'curtain_names') {
              // Special handling for curtain_names - extract from populated curtains relation
              if (product.curtains && Array.isArray(product.curtains)) {
                const names = product.curtains.map(c => c?.name || '').filter(Boolean);
                flattened[field] = names.length > 0 ? names.join(', ') : '';
              } else {
                flattened[field] = '';
              }
            } else if (field === 'blind_names') {
              // Special handling for blind_names - extract from populated blinds relation
              if (product.blinds && Array.isArray(product.blinds)) {
                const names = product.blinds.map(b => b?.name || '').filter(Boolean);
                flattened[field] = names.length > 0 ? names.join(', ') : '';
              } else {
                flattened[field] = '';
              }
            } else if (field === 'cushion_names') {
              // Special handling for cushion_names - extract from populated cushions relation
              if (product.cushions && Array.isArray(product.cushions)) {
                const names = product.cushions.map(c => c?.name || '').filter(Boolean);
                flattened[field] = names.length > 0 ? names.join(', ') : '';
              } else {
                flattened[field] = '';
              }
            } else if (field === 'lining_names') {
              // Special handling for lining_names - extract from populated linings relation
              if (product.linings && Array.isArray(product.linings)) {
                const names = product.linings.map(l => l?.name || l?.liningType || '').filter(Boolean);
                flattened[field] = names.length > 0 ? names.join(', ') : '';
              } else {
                flattened[field] = '';
              }
            } else if (field === 'trimming_names') {
              // Special handling for trimming_names - extract from populated trimmings relation
              if (product.trimmings && Array.isArray(product.trimmings)) {
                const names = product.trimmings.map(t => t?.name || t?.type || '').filter(Boolean);
                flattened[field] = names.length > 0 ? names.join(', ') : '';
              } else {
                flattened[field] = '';
              }
            } else if (field === 'mechanisation_names') {
              // Special handling for mechanisation_names - extract from populated mechanisations relation
              if (product.mechanisations && Array.isArray(product.mechanisations)) {
                const names = product.mechanisations.map(m => m?.name || m?.type || '').filter(Boolean);
                flattened[field] = names.length > 0 ? names.join(', ') : '';
              } else {
                flattened[field] = '';
              }
            } else if (field === 'pricing_rules_names') {
              // Special handling for pricing_rules_names - extract from populated pricing_rules relation
              if (product.pricing_rules && Array.isArray(product.pricing_rules)) {
                const names = product.pricing_rules.map(p => p?.name || '').filter(Boolean);
                flattened[field] = names.length > 0 ? names.join(', ') : '';
              } else {
                flattened[field] = '';
              }
            } else if (field === 'care_instruction_names') {
              // Special handling for care_instruction_names - extract from populated care_instructions relation
              if (product.care_instructions && Array.isArray(product.care_instructions)) {
                const names = product.care_instructions.map(c => c?.name || '').filter(Boolean);
                flattened[field] = names.length > 0 ? names.join(', ') : '';
              } else {
                flattened[field] = '';
              }
            } else if (field === 'formula') {
              // Special handling for JSON fields - preserve JSON format
              if (product[field]) {
                flattened[field] = typeof product[field] === 'object' ? JSON.stringify(product[field]) : product[field];
              } else {
                flattened[field] = '';
              }
            } else if (field === 'thumbnail_url') {
              // Special handling for thumbnail_url - extract from populated thumbnail relation
              if (product.thumbnail && product.thumbnail.url) {
                flattened[field] = product.thumbnail.url;
              } else {
                flattened[field] = '';
              }
            } else {
              flattened[field] = product[field] || '';
            }
          });
          
          return flattened;
        });

        const worksheet = XLSX.utils.json_to_sheet(flattenedProducts);
        
        // Set column widths using explicit config only
        if (config.widths) {
          worksheet['!cols'] = config.widths.map(w => ({ wch: w }));
        }

        // Add auto-filter
        if (flattenedProducts.length > 0) {
          const range = XLSX.utils.encode_range({
            s: { c: 0, r: 0 },
            e: { c: Object.keys(flattenedProducts[0]).length - 1, r: flattenedProducts.length }
          });
          worksheet['!autofilter'] = { ref: range };
        }

        XLSX.utils.book_append_sheet(workbook, worksheet, config.name);
      });
      
      const excelBuffer = XLSX.write(workbook, { 
        bookType: 'xlsx', 
        type: 'array',
        cellStyles: true
      });
      
      const blob = new Blob([excelBuffer], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      });
      
      saveAs(blob, filename);
      
      // Show export summary
      let summaryMessage = `✅ Exported ${totalExported} products`;
      if (totalSkipped > 0) {
        summaryMessage += ` (skipped ${totalSkipped} with missing required fields)`;
      }
      summaryMessage += ` across multiple sheets to ${filename}`;
      console.log(summaryMessage);
      return true;
    } catch (error) {
      console.error('❌ Error exporting to Excel:', error);
      return false;
    }
  },

  // Export selected products to multi-sheet Excel
  exportSelectedToExcel: (selectedProductsByType, allProducts, filename = 'selected-products.xlsx') => {
    try {
      const workbook = XLSX.utils.book_new();
      
      // Define product type configurations
      const productConfigs = {
        fabrics: {
          name: 'Fabrics',
          fields: ['id', 'name', 'description', 'productId', 'brand_name', 'slug', 'colour', 'pattern', 'composition', 'price_per_metre', 'patternRepeat_cm', 'usableWidth_cm', 'martindale', 'availability', 'is_featured', 'featured_until', 'createdAt', 'updatedAt'],
          widths: [8, 25, 40, 15, 20, 15, 15, 15, 20, 20, 12, 12, 12, 12, 12, 10, 20, 20, 20],
          relations: []
        },
        curtains: {
          name: 'Curtains',
          fields: ['id', 'name', 'description', 'fabric_names', 'lining_names', 'trimming_names', 'curtain_type_name', 'pricing_rules_names', 'price_per_metre', 'availability', 'createdAt', 'updatedAt'],
          widths: [8, 25, 40, 30, 20, 20, 20, 30, 12, 12, 20, 20],
          relations: ['fabrics', 'linings', 'trimmings', 'curtain_type', 'pricing_rules']
        },
        blinds: {
          name: 'Blinds',
          fields: ['id', 'name', 'description', 'fabric_names', 'lining_names', 'trimming_names', 'mechanisation_names', 'blind_type_name', 'pricing_rules_names', 'price_per_metre', 'availability', 'createdAt', 'updatedAt'],
          widths: [8, 25, 40, 30, 20, 20, 20, 20, 30, 12, 12, 20, 20],
          relations: ['fabrics', 'linings', 'trimmings', 'mechanisations', 'blind_type', 'pricing_rules']
        },
        cushions: {
          name: 'Cushions',
          fields: ['id', 'name', 'description', 'fabric_names', 'cushion_type_name', 'pricing_rules_names', 'price_per_metre', 'availability', 'createdAt', 'updatedAt'],
          widths: [8, 25, 40, 30, 20, 30, 12, 12, 20, 20],
          relations: ['fabrics', 'cushion_type', 'pricing_rules']
        },
        linings: {
          name: 'Linings',
          fields: ['id', 'liningType', 'price', 'colour', 'fabric_names', 'createdAt', 'updatedAt'],
          widths: [8, 20, 12, 15, 30, 20, 20],
          relations: ['fabrics']
        },
        trimmings: {
          name: 'Trimmings',
          fields: ['id', 'type', 'price', 'fabric_names', 'createdAt', 'updatedAt'],
          widths: [8, 20, 12, 30, 20, 20],
          relations: ['fabrics']
        },
        mechanisations: {
          name: 'Mechanisations',
          fields: ['id', 'type', 'price', 'blind_names', 'createdAt', 'updatedAt'],
          widths: [8, 20, 12, 30, 20, 20],
          relations: ['blinds']
        },
        brands: {
          name: 'Brands',
          fields: ['id', 'name', 'description', 'thumbnail_url', 'fabric_names', 'createdAt', 'updatedAt'],
          widths: [8, 25, 40, 30, 30, 20, 20],
          relations: ['fabrics']
        },
        pricing_rules: {
          name: 'Pricing Rules',
          fields: ['id', 'name', 'product_type', 'formula', 'curtain_names', 'blind_names', 'cushion_names', 'createdAt', 'updatedAt'],
          widths: [8, 25, 15, 40, 30, 30, 30, 20, 20],
          relations: ['curtains', 'blinds', 'cushions']
        },
        care_instructions: {
          name: 'Care Instructions',
          fields: ['id', 'name', 'description', 'fabric_names', 'createdAt', 'updatedAt'],
          widths: [8, 25, 40, 40, 20, 20],
          relations: ['fabrics']
        }
      };

      // Track export summary
      let totalExported = 0;
      let totalSkipped = 0;
      
      // Process each product type
      Object.keys(productConfigs).forEach(productType => {
        const config = productConfigs[productType];
        let products = allProducts[productType] || [];
        
        // Filter to only selected products if specified
        if (selectedProductsByType && selectedProductsByType[productType] && selectedProductsByType[productType].length > 0) {
          const selectedIds = selectedProductsByType[productType];
          products = products.filter(product => selectedIds.includes(product.id));
        }
        
        if (products.length === 0) return; // Skip empty sheets
        
        // Validate and filter products with missing required fields
        const validProducts = [];
        const skippedProducts = [];
        
        products.forEach((product) => {
          // Validate required fields based on product type
          let isValid = true;
          let missingFields = [];
          
          // All product types require 'name'
          if (!product.name || product.name.trim() === '') {
            missingFields.push('name');
            isValid = false;
          }
          
          // Type-specific validation
          if (productType === 'fabrics' && (!product.productId || product.productId.trim() === '')) {
            missingFields.push('productId');
            isValid = false;
          }
          
          if (productType === 'linings' && (!product.liningType || product.liningType.trim() === '')) {
            missingFields.push('liningType');
            isValid = false;
          }
          
          if (productType === 'trimmings' && (!product.type || product.type.trim() === '')) {
            missingFields.push('type');
            isValid = false;
          }
          
          if (productType === 'mechanisations' && (!product.type || product.type.trim() === '')) {
            missingFields.push('type');
            isValid = false;
          }
          
          if (isValid) {
            validProducts.push(product);
          } else {
            skippedProducts.push({
              id: product.id,
              name: product.name || '(no name)',
              missingFields: missingFields
            });
          }
        });
        
        // Log skipped products
        if (skippedProducts.length > 0) {
          console.warn(`⚠️ Skipped ${skippedProducts.length} ${productType} with missing data:`, skippedProducts);
          totalSkipped += skippedProducts.length;
        }
        
        totalExported += validProducts.length;
        
        // Flatten valid products with relations
        const flattenedProducts = validProducts.map(product => {
          const flattened = {};
          
          // Add basic fields
          config.fields.forEach(field => {
            if (field === 'brand_name') {
              // Special handling for brand_name - extract from populated brand relation
              console.log(`🔍 Debug brand export (selected) for product "${product.name}":`, {
                hasBrand: !!product.brand,
                brandData: product.brand,
                brandName: product.brand?.name
              });
              flattened[field] = product.brand?.name || '';
            } else if (field === 'formula') {
              // Special handling for JSON fields - preserve JSON format
              if (product[field]) {
                flattened[field] = typeof product[field] === 'object' ? JSON.stringify(product[field]) : product[field];
              } else {
                flattened[field] = '';
              }
            } else if (field === 'thumbnail_url') {
              // Special handling for thumbnail_url - extract from populated thumbnail relation
              if (product.thumbnail && product.thumbnail.url) {
                flattened[field] = product.thumbnail.url;
              } else {
                flattened[field] = '';
              }
            } else {
              flattened[field] = product[field] || '';
            }
          });
          
          return flattened;
        });

        const worksheet = XLSX.utils.json_to_sheet(flattenedProducts);
        
        // Set column widths using explicit config only
        if (config.widths) {
          worksheet['!cols'] = config.widths.map(w => ({ wch: w }));
        }

        // Add auto-filter
        if (flattenedProducts.length > 0) {
          const range = XLSX.utils.encode_range({
            s: { c: 0, r: 0 },
            e: { c: Object.keys(flattenedProducts[0]).length - 1, r: flattenedProducts.length }
          });
          worksheet['!autofilter'] = { ref: range };
        }

        XLSX.utils.book_append_sheet(workbook, worksheet, config.name);
      });
      
      const excelBuffer = XLSX.write(workbook, { 
        bookType: 'xlsx', 
        type: 'array',
        cellStyles: true
      });
      
      const blob = new Blob([excelBuffer], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      });
      
      saveAs(blob, filename);
      
      // Show export summary
      let summaryMessage = `✅ Exported ${totalExported} selected products`;
      if (totalSkipped > 0) {
        summaryMessage += ` (skipped ${totalSkipped} with missing required fields)`;
      }
      summaryMessage += ` across multiple sheets to ${filename}`;
      console.log(summaryMessage);
      return true;
    } catch (error) {
      console.error('❌ Error exporting selected products to Excel:', error);
      return false;
    }
  },

  // Export all products to CSV format
  exportToCSV: (allProducts, filename = 'products.csv') => {
    try {
      const csvData = [];
      
      // Define product type configurations (same as Excel)
      const productConfigs = {
        fabrics: {
          name: 'Fabrics',
          fields: ['id', 'name', 'description', 'productId', 'brand_name', 'slug', 'colour', 'pattern', 'composition', 'price_per_metre', 'patternRepeat_cm', 'usableWidth_cm', 'martindale', 'availability', 'is_featured', 'featured_until', 'curtain_names', 'blind_names', 'cushion_names', 'care_instruction_names', 'createdAt', 'updatedAt'],
          relations: ['brand', 'curtains', 'blinds', 'cushions', 'care_instructions']
        },
        curtains: {
          name: 'Curtains',
          fields: ['id', 'name', 'description', 'productId', 'slug', 'price_per_metre', 'availability', 'is_featured', 'featured_until', 'createdAt', 'updatedAt'],
          relations: ['fabrics', 'linings', 'trimmings', 'curtain_type', 'pricing_rules']
        },
        blinds: {
          name: 'Blinds',
          fields: ['id', 'name', 'description', 'productId', 'slug', 'price_per_metre', 'availability', 'is_featured', 'featured_until', 'createdAt', 'updatedAt'],
          relations: ['fabrics', 'linings', 'trimmings', 'mechanisations', 'blind_type', 'pricing_rules']
        },
        cushions: {
          name: 'Cushions',
          fields: ['id', 'name', 'description', 'productId', 'slug', 'price_per_metre', 'availability', 'is_featured', 'featured_until', 'createdAt', 'updatedAt'],
          relations: ['fabrics', 'cushion_type', 'pricing_rules']
        },
        linings: {
          name: 'Linings',
          fields: ['id', 'liningType', 'price', 'colour', 'createdAt', 'updatedAt'],
          relations: ['brand']
        },
        trimmings: {
          name: 'Trimmings',
          fields: ['id', 'type', 'price', 'createdAt', 'updatedAt'],
          relations: ['brand']
        },
        mechanisations: {
          name: 'Mechanisations',
          fields: ['id', 'type', 'price', 'createdAt', 'updatedAt'],
          relations: ['brand']
        },
        brands: {
          name: 'Brands',
          fields: ['id', 'name', 'description', 'createdAt', 'updatedAt'],
          relations: ['fabrics']
        },
        pricing_rules: {
          name: 'Pricing Rules',
          fields: ['id', 'name', 'product_type', 'formula', 'curtain_names', 'blind_names', 'cushion_names', 'createdAt', 'updatedAt'],
          widths: [8, 25, 15, 40, 30, 30, 30, 20, 20],
          relations: ['curtains', 'blinds', 'cushions']
        },
        care_instructions: {
          name: 'Care Instructions',
          fields: ['id', 'name', 'description', 'fabric_names', 'createdAt', 'updatedAt'],
          widths: [8, 25, 40, 40, 20, 20],
          relations: ['fabrics']
        }
      };

      // Process each product type
      Object.keys(productConfigs).forEach(productType => {
        const config = productConfigs[productType];
        const products = allProducts[productType] || [];
        
        // Always create sections, even if empty (so users can see the structure)
        console.log(`📊 Creating CSV section for ${productType}: ${products.length} products`);
        
        // Add type header
        csvData.push(`\n=== ${config.name.toUpperCase()} ===`);
        
        // Create headers row using explicit fields only
        const headers = [...config.fields];
        csvData.push(headers.join(','));
        
        // Add data rows
        products.forEach(product => {
          const row = [];
          
          // Add basic fields
          config.fields.forEach(field => {
            if (field === 'brand_name') {
              row.push(`"${product.brand?.name || ''}"`);
            } else if (field === 'curtain_type_name') {
              row.push(`"${product.curtain_type?.name || ''}"`);
            } else if (field === 'blind_type_name') {
              row.push(`"${product.blind_type?.name || ''}"`);
            } else if (field === 'cushion_type_name') {
              row.push(`"${product.cushion_type?.name || ''}"`);
            } else if (field === 'fabric_names') {
              if (product.fabrics && Array.isArray(product.fabrics)) {
                const names = product.fabrics.map(f => f?.name || '').filter(Boolean);
                const value = names.length > 0 ? names.join(', ') : '';
                row.push(`"${value.replace(/"/g, '""')}"`);
              } else {
                row.push(`""`);
              }
            } else if (field === 'curtain_names') {
              if (product.curtains && Array.isArray(product.curtains)) {
                const names = product.curtains.map(c => c?.name || '').filter(Boolean);
                const value = names.length > 0 ? names.join(', ') : '';
                row.push(`"${value.replace(/"/g, '""')}"`);
              } else {
                row.push(`""`);
              }
            } else if (field === 'blind_names') {
              if (product.blinds && Array.isArray(product.blinds)) {
                const names = product.blinds.map(b => b?.name || '').filter(Boolean);
                const value = names.length > 0 ? names.join(', ') : '';
                row.push(`"${value.replace(/"/g, '""')}"`);
              } else {
                row.push(`""`);
              }
            } else if (field === 'cushion_names') {
              if (product.cushions && Array.isArray(product.cushions)) {
                const names = product.cushions.map(c => c?.name || '').filter(Boolean);
                const value = names.length > 0 ? names.join(', ') : '';
                row.push(`"${value.replace(/"/g, '""')}"`);
              } else {
                row.push(`""`);
              }
            } else if (field === 'lining_names') {
              if (product.linings && Array.isArray(product.linings)) {
                const names = product.linings.map(l => l?.name || l?.liningType || '').filter(Boolean);
                const value = names.length > 0 ? names.join(', ') : '';
                row.push(`"${value.replace(/"/g, '""')}"`);
              } else {
                row.push(`""`);
              }
            } else if (field === 'trimming_names') {
              if (product.trimmings && Array.isArray(product.trimmings)) {
                const names = product.trimmings.map(t => t?.name || t?.type || '').filter(Boolean);
                const value = names.length > 0 ? names.join(', ') : '';
                row.push(`"${value.replace(/"/g, '""')}"`);
              } else {
                row.push(`""`);
              }
            } else if (field === 'mechanisation_names') {
              if (product.mechanisations && Array.isArray(product.mechanisations)) {
                const names = product.mechanisations.map(m => m?.name || m?.type || '').filter(Boolean);
                const value = names.length > 0 ? names.join(', ') : '';
                row.push(`"${value.replace(/"/g, '""')}"`);
              } else {
                row.push(`""`);
              }
            } else if (field === 'pricing_rules_names') {
              if (product.pricing_rules && Array.isArray(product.pricing_rules)) {
                const names = product.pricing_rules.map(p => p?.name || '').filter(Boolean);
                const value = names.length > 0 ? names.join(', ') : '';
                row.push(`"${value.replace(/"/g, '""')}"`);
              } else {
                row.push(`""`);
              }
            } else if (field === 'care_instruction_names') {
              if (product.care_instructions && Array.isArray(product.care_instructions)) {
                const names = product.care_instructions.map(c => c?.name || '').filter(Boolean);
                const value = names.length > 0 ? names.join(', ') : '';
                row.push(`"${value.replace(/"/g, '""')}"`);
              } else {
                row.push(`""`);
              }
            } else if (field === 'formula') {
              // Special handling for JSON fields - preserve JSON format
              const value = product[field] ? (typeof product[field] === 'object' ? JSON.stringify(product[field]) : product[field]) : '';
              row.push(`"${value.toString().replace(/"/g, '""')}"`);
            } else if (field === 'thumbnail_url') {
              // Special handling for thumbnail_url - extract from populated thumbnail relation
              const thumbnailUrl = product.thumbnail && product.thumbnail.url ? product.thumbnail.url : '';
              row.push(`"${thumbnailUrl.replace(/"/g, '""')}"`);
            } else {
              const value = product[field] || '';
              // Escape commas and quotes in CSV
              row.push(`"${value.toString().replace(/"/g, '""')}"`);
            }
          });
          
          // Do not append any auto relation columns; explicit fields already handled above
          
          csvData.push(row.join(','));
        });
      });
      
      // Convert to CSV string
      const csvContent = csvData.join('\n');
      
      // Create and download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      console.log(`📊 CSV export completed: ${filename}`);
      return { success: true, filename };
      
    } catch (error) {
      console.error('❌ CSV export failed:', error);
      throw error;
    }
  },

  // Export selected products to CSV format
  exportSelectedToCSV: (selectedProductsByType, allProducts, filename = 'selected-products.csv') => {
    try {
      const csvData = [];
      
      // Define product type configurations (same as Excel)
      const productConfigs = {
        fabrics: {
          name: 'Fabrics',
          fields: ['id', 'name', 'description', 'productId', 'brand_name', 'slug', 'colour', 'pattern', 'composition', 'price_per_metre', 'patternRepeat_cm', 'usableWidth_cm', 'martindale', 'availability', 'is_featured', 'featured_until', 'curtain_names', 'blind_names', 'cushion_names', 'care_instruction_names', 'createdAt', 'updatedAt'],
          relations: ['brand', 'curtains', 'blinds', 'cushions', 'care_instructions']
        },
        curtains: {
          name: 'Curtains',
          fields: ['id', 'name', 'description', 'productId', 'slug', 'price_per_metre', 'availability', 'is_featured', 'featured_until', 'createdAt', 'updatedAt'],
          relations: ['fabrics', 'linings', 'trimmings', 'curtain_type', 'pricing_rules']
        },
        blinds: {
          name: 'Blinds',
          fields: ['id', 'name', 'description', 'productId', 'slug', 'price_per_metre', 'availability', 'is_featured', 'featured_until', 'createdAt', 'updatedAt'],
          relations: ['fabrics', 'linings', 'trimmings', 'mechanisations', 'blind_type', 'pricing_rules']
        },
        cushions: {
          name: 'Cushions',
          fields: ['id', 'name', 'description', 'productId', 'slug', 'price_per_metre', 'availability', 'is_featured', 'featured_until', 'createdAt', 'updatedAt'],
          relations: ['fabrics', 'cushion_type', 'pricing_rules']
        },
        linings: {
          name: 'Linings',
          fields: ['id', 'liningType', 'price', 'colour', 'createdAt', 'updatedAt'],
          relations: ['brand']
        },
        trimmings: {
          name: 'Trimmings',
          fields: ['id', 'type', 'price', 'createdAt', 'updatedAt'],
          relations: ['brand']
        },
        mechanisations: {
          name: 'Mechanisations',
          fields: ['id', 'type', 'price', 'createdAt', 'updatedAt'],
          relations: ['brand']
        },
        brands: {
          name: 'Brands',
          fields: ['id', 'name', 'description', 'createdAt', 'updatedAt'],
          relations: ['fabrics']
        },
        pricing_rules: {
          name: 'Pricing Rules',
          fields: ['id', 'name', 'product_type', 'formula', 'curtain_names', 'blind_names', 'cushion_names', 'createdAt', 'updatedAt'],
          widths: [8, 25, 15, 40, 30, 30, 30, 20, 20],
          relations: ['curtains', 'blinds', 'cushions']
        },
        care_instructions: {
          name: 'Care Instructions',
          fields: ['id', 'name', 'description', 'fabric_names', 'createdAt', 'updatedAt'],
          widths: [8, 25, 40, 40, 20, 20],
          relations: ['fabrics']
        }
      };

      // Process each product type
      Object.keys(productConfigs).forEach(productType => {
        const config = productConfigs[productType];
        let products = allProducts[productType] || [];
        
        // Filter to only selected products if specified
        if (selectedProductsByType && selectedProductsByType[productType] && selectedProductsByType[productType].length > 0) {
          const selectedIds = selectedProductsByType[productType];
          products = products.filter(product => selectedIds.includes(product.id));
        }
        
        // Always create sections, even if empty (so users can see the structure)
        console.log(`📊 Creating CSV section for ${productType}: ${products.length} products`);
        
        // Add type header
        csvData.push(`\n=== ${config.name.toUpperCase()} ===`);
        
        // Create headers row using explicit fields only
        const headers = [...config.fields];
        csvData.push(headers.join(','));
        
        // Add data rows
        products.forEach(product => {
          const row = [];
          
          // Add basic fields
          config.fields.forEach(field => {
            if (field === 'brand_name') {
              row.push(`"${product.brand?.name || ''}"`);
            } else if (field === 'curtain_type_name') {
              row.push(`"${product.curtain_type?.name || ''}"`);
            } else if (field === 'blind_type_name') {
              row.push(`"${product.blind_type?.name || ''}"`);
            } else if (field === 'cushion_type_name') {
              row.push(`"${product.cushion_type?.name || ''}"`);
            } else if (field === 'fabric_names') {
              if (product.fabrics && Array.isArray(product.fabrics)) {
                const names = product.fabrics.map(f => f?.name || '').filter(Boolean);
                const value = names.length > 0 ? names.join(', ') : '';
                row.push(`"${value.replace(/"/g, '""')}"`);
              } else {
                row.push(`""`);
              }
            } else if (field === 'curtain_names') {
              if (product.curtains && Array.isArray(product.curtains)) {
                const names = product.curtains.map(c => c?.name || '').filter(Boolean);
                const value = names.length > 0 ? names.join(', ') : '';
                row.push(`"${value.replace(/"/g, '""')}"`);
              } else {
                row.push(`""`);
              }
            } else if (field === 'blind_names') {
              if (product.blinds && Array.isArray(product.blinds)) {
                const names = product.blinds.map(b => b?.name || '').filter(Boolean);
                const value = names.length > 0 ? names.join(', ') : '';
                row.push(`"${value.replace(/"/g, '""')}"`);
              } else {
                row.push(`""`);
              }
            } else if (field === 'cushion_names') {
              if (product.cushions && Array.isArray(product.cushions)) {
                const names = product.cushions.map(c => c?.name || '').filter(Boolean);
                const value = names.length > 0 ? names.join(', ') : '';
                row.push(`"${value.replace(/"/g, '""')}"`);
              } else {
                row.push(`""`);
              }
            } else if (field === 'lining_names') {
              if (product.linings && Array.isArray(product.linings)) {
                const names = product.linings.map(l => l?.name || l?.liningType || '').filter(Boolean);
                const value = names.length > 0 ? names.join(', ') : '';
                row.push(`"${value.replace(/"/g, '""')}"`);
              } else {
                row.push(`""`);
              }
            } else if (field === 'trimming_names') {
              if (product.trimmings && Array.isArray(product.trimmings)) {
                const names = product.trimmings.map(t => t?.name || t?.type || '').filter(Boolean);
                const value = names.length > 0 ? names.join(', ') : '';
                row.push(`"${value.replace(/"/g, '""')}"`);
              } else {
                row.push(`""`);
              }
            } else if (field === 'mechanisation_names') {
              if (product.mechanisations && Array.isArray(product.mechanisations)) {
                const names = product.mechanisations.map(m => m?.name || m?.type || '').filter(Boolean);
                const value = names.length > 0 ? names.join(', ') : '';
                row.push(`"${value.replace(/"/g, '""')}"`);
              } else {
                row.push(`""`);
              }
            } else if (field === 'pricing_rules_names') {
              if (product.pricing_rules && Array.isArray(product.pricing_rules)) {
                const names = product.pricing_rules.map(p => p?.name || '').filter(Boolean);
                const value = names.length > 0 ? names.join(', ') : '';
                row.push(`"${value.replace(/"/g, '""')}"`);
              } else {
                row.push(`""`);
              }
            } else if (field === 'care_instruction_names') {
              if (product.care_instructions && Array.isArray(product.care_instructions)) {
                const names = product.care_instructions.map(c => c?.name || '').filter(Boolean);
                const value = names.length > 0 ? names.join(', ') : '';
                row.push(`"${value.replace(/"/g, '""')}"`);
              } else {
                row.push(`""`);
              }
            } else if (field === 'formula') {
              // Special handling for JSON fields - preserve JSON format
              const value = product[field] ? (typeof product[field] === 'object' ? JSON.stringify(product[field]) : product[field]) : '';
              row.push(`"${value.toString().replace(/"/g, '""')}"`);
            } else if (field === 'thumbnail_url') {
              // Special handling for thumbnail_url - extract from populated thumbnail relation
              const thumbnailUrl = product.thumbnail && product.thumbnail.url ? product.thumbnail.url : '';
              row.push(`"${thumbnailUrl.replace(/"/g, '""')}"`);
            } else {
              const value = product[field] || '';
              // Escape commas and quotes in CSV
              row.push(`"${value.toString().replace(/"/g, '""')}"`);
            }
          });
          
          // Do not append any auto relation columns; explicit fields already handled above
          
          csvData.push(row.join(','));
        });
      });
      
      // Convert to CSV string
      const csvContent = csvData.join('\n');
      
      // Create and download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      console.log(`📊 CSV export (selected) completed: ${filename}`);
      return { success: true, filename };
      
    } catch (error) {
      console.error('❌ CSV export (selected) failed:', error);
      throw error;
    }
  },

  // Import products from Excel
  importFromExcel: async (file) => {
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      
      console.log(`📊 Imported ${jsonData.length} rows from Excel`);
      return jsonData;
    } catch (error) {
      console.error('❌ Error importing from Excel:', error);
      throw error;
    }
  },

  // Import from multi-sheet Excel
  importFromMultiSheetExcel: async (file) => {
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const dataset = {};
      
      // Read all sheets except Instructions and Lookups
      workbook.SheetNames.forEach(sheetName => {
        if (sheetName !== 'Instructions' && sheetName !== 'Lookups') {
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);
          // Filter out empty rows
          const filteredData = jsonData.filter(row => 
            Object.values(row).some(value => value !== '' && value !== null && value !== undefined)
          );
          dataset[sheetName.toLowerCase()] = filteredData;
        }
      });
      
      console.log(`📊 Imported multi-sheet data:`, Object.keys(dataset).map(key => `${key}: ${dataset[key].length} rows`));
      return dataset;
    } catch (error) {
      console.error('❌ Error importing multi-sheet Excel:', error);
      throw error;
    }
  },

  // Create Excel template
  createTemplate: (productType = 'fabrics', comprehensive = false) => {
    const workbook = XLSX.utils.book_new();
    
    // Define all product types and their fields
    const productSchemas = {
      fabrics: {
        headers: ['name', 'description', 'brand_name', 'colour', 'pattern', 'composition', 'price_per_metre', 'patternRepeat_cm', 'usableWidth_cm', 'martindale', 'availability', 'is_featured', 'featured_until', 'curtain_names', 'blind_names', 'cushion_names', 'care_instruction_names'],
        sampleData: ['Sample Fabric', 'Beautiful cotton fabric', 'Sample Brand', 'Blue', 'Solid', '100% Cotton', 25.50, 20, 140, '', 'in_stock', false, '', 'Sample Curtain', 'Sample Blind', 'Sample Cushion', 'Machine Wash'],
        required: ['name', 'brand_name', 'colour', 'pattern', 'composition', 'price_per_metre', 'patternRepeat_cm', 'usableWidth_cm', 'availability'],
        instructions: 'Fill in fabric details. Brand name must exist in Brands sheet. ProductId and slug will be auto-generated. All fields except description, featured_until, and martindale are required. Use comma-separated names for relations.',
        defaults: {
          colour: 'Blue',
          pattern: 'Solid',
          composition: '100% Cotton',
          price_per_metre: 25.50,
          patternRepeat_cm: 20,
          usableWidth_cm: 140,
          // martindale is NOT set to a default - leave it empty if not provided
          availability: 'in_stock',
          is_featured: false
        }
      },
      curtains: {
        headers: ['name', 'description', 'fabric_names', 'lining_names', 'trimming_names', 'curtain_type_name', 'pricing_rules_names', 'price_per_metre', 'availability'],
        sampleData: ['Sample Curtain', 'Beautiful curtain design', 'Sample Fabric, Blue Velvet', 'Blackout', 'Piping', 'Standard', 'Standard Pricing, Premium Pricing', 35.00, 'in_stock'],
        required: ['name'],
        instructions: 'Enter curtain name. Use comma-separated names for fabrics, linings, trimmings, pricing rules. Curtain type must exist in Curtain Types.'
      },
      blinds: {
        headers: ['name', 'description', 'fabric_names', 'lining_names', 'trimming_names', 'mechanisation_names', 'blind_type_name', 'pricing_rules_names', 'price_per_metre', 'availability'],
        sampleData: ['Sample Blind', 'Modern blind design', 'Sample Fabric, Navy Velvet', 'Blackout', 'Piping', 'Motorized', 'Roller', 'Standard Pricing, Premium Pricing', 42.00, 'in_stock'],
        required: ['name'],
        instructions: 'Enter blind name. Use comma-separated names for fabrics, linings, trimmings, mechanisations, pricing rules. Blind type must exist in Blind Types.'
      },
      cushions: {
        headers: ['name', 'description', 'fabric_names', 'cushion_type_name', 'pricing_rules_names', 'price_per_metre', 'availability'],
        sampleData: ['Sample Cushion', 'Comfortable cushion', 'Sample Fabric, Velvet', 'Square', 'Standard Pricing, Premium Pricing', 28.00, 'in_stock'],
        required: ['name'],
        instructions: 'Enter cushion name. Use comma-separated names for fabrics, pricing rules. Cushion type must exist in Cushion Types.'
      },
      linings: {
        headers: ['liningType', 'price', 'colour', 'curtain_names', 'blind_names'],
        sampleData: ['Blackout', 15.50, 'White', 'Sample Curtain', 'Sample Blind'],
        required: ['liningType', 'price', 'colour'],
        instructions: 'Enter lining type, price, and colour. Use comma-separated names for curtain and blind relations.'
      },
      trimmings: {
        headers: ['type', 'price', 'curtain_names', 'blind_names'],
        sampleData: ['Piping', 8.75, 'Sample Curtain', 'Sample Blind'],
        required: ['type', 'price'],
        instructions: 'Enter trimming type and price. Use comma-separated names for curtain and blind relations.'
      },
      mechanisations: {
        headers: ['type', 'price', 'blind_names'],
        sampleData: ['Motorized', 45.00, 'Sample Blind'],
        required: ['type', 'price'],
        instructions: 'Enter mechanisation type and price. Use comma-separated names for blind relations.'
      },
      brands: {
        headers: ['name', 'description', 'thumbnail_url', 'fabric_names'],
        sampleData: ['Sample Brand', 'Premium fabric brand', 'https://example.com/brand-logo.png', 'Sample Fabric'],
        required: ['name'],
        instructions: 'Enter brand name and description. Optional: Add thumbnail_url for brand logo (will be auto-uploaded to Strapi media library). Use comma-separated names for fabric relations.'
      },
      pricing_rules: {
        headers: ['name', 'product_type', 'formula', 'curtain_names', 'blind_names', 'cushion_names'],
        sampleData: ['Standard Pricing', 'curtain', '{"base_price": 25, "multiplier": 1.2}', 'Sample Curtain', 'Sample Blind', 'Sample Cushion'],
        required: ['name', 'product_type', 'formula'],
        instructions: 'Enter pricing rule name, product type (curtain/blind/cushion), and formula as JSON. Formula will be used for price calculations. Use comma-separated names for relations.'
      },
      'curtain-types': {
        headers: ['name', 'description', 'curtain_names'],
        sampleData: ['Standard', 'Standard curtain type', 'Sample Curtain'],
        required: ['name'],
        instructions: 'Enter curtain type name and description. Use comma-separated names for curtain relations.'
      },
      'blind-types': {
        headers: ['name', 'description', 'blind_names'],
        sampleData: ['Roller', 'Roller blind type', 'Sample Blind'],
        required: ['name'],
        instructions: 'Enter blind type name and description. Use comma-separated names for blind relations.'
      },
      'cushion-types': {
        headers: ['name', 'description', 'cushion_names'],
        sampleData: ['Square', 'Square cushion type', 'Sample Cushion'],
        required: ['name'],
        instructions: 'Enter cushion type name and description. Use comma-separated names for cushion relations.'
      },
      'care-instructions': {
        headers: ['name', 'description', 'fabric_names'],
        sampleData: ['Machine Wash', 'Machine washable fabrics', 'Sample Fabric'],
        required: ['name'],
        instructions: 'Enter care instruction name and description. Use comma-separated names for fabric relations.'
      }
    };

    // Determine which schemas to include
    const schemasToInclude = comprehensive ? 
      Object.entries(productSchemas) : 
      Object.entries(productSchemas).filter(([type]) => type === productType);

    // Add instructions sheet for comprehensive template
    if (comprehensive) {
      const instructionsData = [
        ['📋 COMPREHENSIVE PRODUCT TEMPLATE INSTRUCTIONS'],
        [''],
        ['🎯 PURPOSE: This template allows you to create ALL types of products in one file'],
        [''],
        ['📝 HOW TO USE:'],
        ['1. Fill in the Brands sheet first (required for fabrics)'],
        ['2. Fill in Linings, Trimmings, Mechanisations sheets'],
        ['3. Fill in Pricing Rules sheet (optional, for advanced pricing)'],
        ['4. Fill in Fabrics sheet (reference brands from step 1)'],
        ['5. Fill in Curtains, Blinds, Cushions sheets (reference fabrics, linings, pricing rules, etc.)'],
        [''],
        ['⚡ AUTO-GENERATED FIELDS (don\'t fill these):'],
        ['- productId: Auto-generated for fabrics only (FAB-XXXXXX-1234)'],
        ['- slug: Auto-generated by Strapi UID plugin for fabrics'],
        ['- createdAt/updatedAt: Auto-set to current time'],
        [''],
        ['🔗 RELATION FIELDS:'],
        ['- Use comma-separated names: "Fabric A, Fabric B"'],
        ['- Names must match exactly (case-sensitive)'],
        ['- Missing brands will be AUTO-CREATED automatically'],
        ['- Missing fabrics/linings/trimmings will show warnings and be skipped'],
        ['- Missing pricing rules will show warnings (require manual creation)'],
        [''],
        ['🖼️ IMAGE HANDLING:'],
        ['- Add thumbnail_url column in Brands sheet for brand logos'],
        ['- Images will be automatically downloaded and uploaded to Strapi'],
        ['- Use publicly accessible image URLs (http/https)'],
        [''],
        ['📊 SHEET DESCRIPTIONS:'],
        ...Object.entries(productSchemas).map(([type, schema]) => [
          `${type.toUpperCase()}: ${schema.instructions}`
        ]),
        [''],
        ['✅ IMPORT PROCESS:'],
        ['1. Upload this file using "Import from Excel"'],
        ['2. Review validation results in preview modal'],
        ['3. Confirm import to add all products to database'],
        [''],
        ['💡 TIP: Export existing products first to see the exact format!']
      ];
      
      const instructionsSheet = XLSX.utils.aoa_to_sheet(instructionsData);
      XLSX.utils.book_append_sheet(workbook, instructionsSheet, '📋 Instructions');
    }

    // Create sheets for each product type
    schemasToInclude.forEach(([type, schema]) => {
      const worksheetData = [
        schema.headers, // Header row
        schema.sampleData, // Sample data row
        ['', '', '', '', '', '', '', '', '', '', '', '', '', ''], // Empty row for user data
        ['', '', '', '', '', '', '', '', '', '', '', '', '', ''], // Empty row for user data
      ];

      const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
      
      // Set column widths
      const columnWidths = schema.headers.map(() => ({ wch: 15 }));
      worksheet['!cols'] = columnWidths;
      
      // Add auto-filter to header row
      const range = XLSX.utils.encode_range({
        s: { c: 0, r: 0 },
        e: { c: schema.headers.length - 1, r: worksheetData.length - 1 }
      });
      worksheet['!autofilter'] = { ref: range };
      
      // Add data validation dropdowns for relation fields
      schema.headers.forEach((header, colIndex) => {
        if (header.endsWith('_names') || header.endsWith('_name')) {
          // Add dropdown validation for relation fields (now using names)
          const validationRange = XLSX.utils.encode_range({
            s: { c: colIndex, r: 1 },
            e: { c: colIndex, r: 100 } // Allow up to 100 rows
          });
          
          // Create dropdown reference based on the relation type
          let dropdownSource = '';
          if (header.includes('fabric')) {
            dropdownSource = comprehensive ? 'Fabrics!A:A' : 'Lookups!A:A'; // Reference fabric names from Fabrics sheet
          } else if (header.includes('lining')) {
            dropdownSource = comprehensive ? 'Linings!A:A' : 'Lookups!A:A'; // Reference lining types from Linings sheet
          } else if (header.includes('trimming')) {
            dropdownSource = comprehensive ? 'Trimmings!A:A' : 'Lookups!A:A'; // Reference trimming types from Trimmings sheet
          } else if (header.includes('mechanisation')) {
            dropdownSource = comprehensive ? 'Mechanisations!A:A' : 'Lookups!A:A'; // Reference mechanisation types from Mechanisations sheet
          } else if (header.includes('brand')) {
            dropdownSource = comprehensive ? 'Brands!A:A' : 'Lookups!A:A'; // Reference brand names from Brands sheet
          } else if (header.includes('curtain_type')) {
            dropdownSource = comprehensive ? 'CurtainTypes!A:A' : 'Lookups!A:A'; // Reference curtain types
          } else if (header.includes('blind_type')) {
            dropdownSource = comprehensive ? 'BlindTypes!A:A' : 'Lookups!A:A'; // Reference blind types
          } else if (header.includes('cushion_type')) {
            dropdownSource = comprehensive ? 'CushionTypes!A:A' : 'Lookups!A:A'; // Reference cushion types
          }
          
          if (dropdownSource) {
            worksheet['!dataValidation'] = worksheet['!dataValidation'] || [];
            worksheet['!dataValidation'].push({
              ref: validationRange,
              type: 'list',
              formula1: dropdownSource,
              showDropDown: true,
              allowBlank: true,
              showErrorMessage: true,
              errorTitle: 'Invalid Selection',
              error: 'Please select a valid option from the dropdown. Use comma-separated values for multiple selections.'
            });
          }
        } else if (header === 'availability') {
          // Add dropdown for availability
          const validationRange = XLSX.utils.encode_range({
            s: { c: colIndex, r: 1 },
            e: { c: colIndex, r: 100 }
          });
          
          worksheet['!dataValidation'] = worksheet['!dataValidation'] || [];
          worksheet['!dataValidation'].push({
            ref: validationRange,
            type: 'list',
            formula1: 'Lookups!B2:B4', // Reference availability options from Lookups sheet
            showDropDown: true,
            allowBlank: false,
            showErrorMessage: true,
            errorTitle: 'Invalid Availability',
            error: 'Please select: in_stock, out_of_stock, or discontinued'
          });
        } else if (header === 'is_featured') {
          // Add dropdown for boolean fields
          const validationRange = XLSX.utils.encode_range({
            s: { c: colIndex, r: 1 },
            e: { c: colIndex, r: 100 }
          });
          
          worksheet['!dataValidation'] = worksheet['!dataValidation'] || [];
          worksheet['!dataValidation'].push({
            ref: validationRange,
            type: 'list',
            formula1: 'Lookups!B7:B8', // Reference boolean options from Lookups sheet
            showDropDown: true,
            allowBlank: true,
            showErrorMessage: true,
            errorTitle: 'Invalid Boolean',
            error: 'Please select: true or false'
          });
        }
      });
      
      // Add sheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, type.charAt(0).toUpperCase() + type.slice(1));
    });

    // Create Instructions sheet
    const instructionsData = [
      ['INSTRUCTIONS FOR EXCEL IMPORT'],
      [''],
      comprehensive ? 
        ['1. Fill in data in the appropriate sheets (Fabrics, Curtains, Blinds, etc.)'] :
        [`1. Fill in data in the ${productType.charAt(0).toUpperCase() + productType.slice(1)} sheet`],
      ['2. For relation fields (ending with _names), use comma-separated names: "Sample Fabric, Blue Velvet"'],
      ['3. Required fields must be filled for each product type'],
      ['4. Remove sample rows before importing'],
      ['5. Availability options: in_stock, out_of_stock, discontinued'],
      ['6. Boolean fields: true/false'],
      ['7. Date format: YYYY-MM-DDTHH:mm:ss.sssZ'],
      ['8. SLUGS ARE AUTO-GENERATED: Do not include slug column - slugs are automatically created from name and productId'],
      comprehensive ? 
        ['9. Use dropdowns for relation fields - they show actual names from other sheets'] :
        ['9. Use dropdowns for relation fields - they show valid options from the Lookups sheet'],
      ['10. For _names fields, you can select multiple items from dropdowns'],
      ['11. Names are automatically converted to IDs during import'],
      [''],
      ['REQUIRED FIELDS BY PRODUCT TYPE:'],
      [''],
      ...schemasToInclude.map(([type, schema]) => [
        `${type.toUpperCase()}: ${schema.required.join(', ')}`
      ]),
      [''],
      ['AUTO-SLUG GENERATION:'],
      ['- Slugs are automatically generated from name and productId fields'],
      ['- Do not include slug column in your Excel file'],
      ['- Slugs will be unique and URL-friendly'],
      [''],
      ['DROPDOWN USAGE:'],
      ['- Click on cells with dropdown arrows to select valid options'],
      comprehensive ? 
        ['- Relation fields show actual names from other sheets'] :
        ['- Relation fields show valid options from the Lookups sheet'],
      ['- Use comma-separated values for multiple selections (e.g., "Sample Fabric, Blue Velvet")'],
      ['- Names are automatically converted to IDs during import']
    ];

    const instructionsSheet = XLSX.utils.aoa_to_sheet(instructionsData);
    instructionsSheet['!cols'] = [{ wch: 50 }];
    XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions');

    // Create Lookups sheet for data validation
    const lookupsData = [
      ['AVAILABILITY_OPTIONS'],
      ['in_stock'],
      ['out_of_stock'],
      ['discontinued'],
      [''],
      ['BOOLEAN_OPTIONS'],
      ['true'],
      ['false'],
      [''],
      ['RELATION HELPERS'],
      ['Use dropdowns in relation fields to select valid options'],
      ['For multiple selections, use comma-separated values'],
      ['Example: "1,2,3" for multiple fabric IDs']
    ];

    const lookupsSheet = XLSX.utils.aoa_to_sheet(lookupsData);
    lookupsSheet['!cols'] = [{ wch: 20 }];
    XLSX.utils.book_append_sheet(workbook, lookupsSheet, 'Lookups');

    // Create helper sheets for dropdown references (only for comprehensive templates)
    if (comprehensive) {
    const helperSheets = [
      { name: 'CurtainTypes', data: [['name'], ['Standard'], ['Eyelet'], ['Tab Top'], ['Pencil Pleat']] },
      { name: 'BlindTypes', data: [['name'], ['Roller'], ['Venetian'], ['Vertical'], ['Roman']] },
      { name: 'CushionTypes', data: [['name'], ['Square'], ['Rectangle'], ['Round'], ['Bolster']] }
    ];

    helperSheets.forEach(sheet => {
      const helperSheet = XLSX.utils.aoa_to_sheet(sheet.data);
      helperSheet['!cols'] = [{ wch: 15 }];
      XLSX.utils.book_append_sheet(workbook, helperSheet, sheet.name);
    });
    }

    // Generate and download the file
    const excelBuffer = XLSX.write(workbook, { 
      bookType: 'xlsx', 
      type: 'array'
    });
    
    const blob = new Blob([excelBuffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
    
    const filename = comprehensive ? 
      'comprehensive-product-template.xlsx' : 
      `${productType}-template.xlsx`;
    
    saveAs(blob, filename);
    
    console.log(`✅ Created ${comprehensive ? 'comprehensive' : productType + '-specific'} template with dropdowns`);
    return true;
  },

  // Validate imported data
  validateImportData: (data, productType = 'fabrics') => {
    const errors = [];
    const requiredFields = ['name', 'productId', 'colour', 'pattern', 'composition', 'price_per_metre', 'patternRepeat_cm', 'usableWidth_cm', 'martindale', 'availability'];
    
    data.forEach((row, index) => {
      const rowErrors = [];
      
      // Check required fields
      requiredFields.forEach(field => {
        if (!row[field] || row[field] === '') {
          // Create detailed error message with row number and specific missing field
          let errorMsg = `${productType} Row ${index + 1}`;
          // Include name for context if available
          if (row.name) {
            errorMsg += ` (Name: '${row.name}')`;
          }
          errorMsg += `: Missing required field: ${field}`;
          rowErrors.push(errorMsg);
        }
      });
      
      // Validate data types
      if (row.price_per_metre && isNaN(parseFloat(row.price_per_metre))) {
        rowErrors.push('price_per_metre must be a number');
      }
      
      if (row.patternRepeat_cm && isNaN(parseFloat(row.patternRepeat_cm))) {
        rowErrors.push('patternRepeat_cm must be a number');
      }
      
      if (row.usableWidth_cm && isNaN(parseFloat(row.usableWidth_cm))) {
        rowErrors.push('usableWidth_cm must be a number');
      }
      
      if (row.martindale && isNaN(parseInt(row.martindale))) {
        rowErrors.push('martindale must be a number');
      }
      
      // Validate availability
      if (row.availability && !['in_stock', 'out_of_stock', 'discontinued'].includes(row.availability)) {
        rowErrors.push('availability must be one of: in_stock, out_of_stock, discontinued');
      }
      
      // Validate boolean fields
      if (row.is_featured && !['true', 'false', true, false].includes(row.is_featured)) {
        rowErrors.push('is_featured must be true or false');
      }
      
      if (rowErrors.length > 0) {
        errors.push({
          row: index + 1,
          errors: rowErrors
        });
      }
    });
    
    return {
      isValid: errors.length === 0,
      errors: errors
    };
  },

  // Validate multi-sheet imported data
  validateImportDataMulti: async (dataset, relationData = null) => {
    const errors = [];
    const warnings = [];
    const info = [];
    
    const productSchemas = {
      fabrics: ['name', 'brand_name', 'composition', 'price_per_metre'],
      curtains: ['name'],
      blinds: ['name'],
      cushions: ['name'],
      linings: ['liningType', 'price', 'colour'],
      trimmings: ['type', 'price'],
      mechanisations: ['type', 'price'],
      brands: ['name']
    };

    Object.entries(dataset).forEach(([sheetName, data]) => {
      const requiredFields = productSchemas[sheetName] || [];
      
      data.forEach((row, index) => {
        const rowErrors = [];
        const rowWarnings = [];
        
        // Check required fields
        requiredFields.forEach(field => {
          if (!row[field] || row[field] === '') {
            // Create detailed error message with row number, product type, and specific missing field
            let errorMsg = `${sheetName} Row ${index + 1}`;
            // If we have a name or type field, include it in the error for context
            if (row.name) {
              errorMsg += ` (Name: '${row.name}')`;
            } else if (row.type) {
              errorMsg += ` (Type: '${row.type}')`;
            } else if (row.liningType) {
              errorMsg += ` (LiningType: '${row.liningType}')`;
            }
            errorMsg += `: Missing required field: ${field}`;
            rowErrors.push(errorMsg);
          }
        });
        
        // Validate numeric fields
        if (row.price && isNaN(parseFloat(row.price))) {
          rowErrors.push('price must be a number');
        }
        
        if (row.price_per_metre && isNaN(parseFloat(row.price_per_metre))) {
          rowErrors.push('price_per_metre must be a number');
        }
        
        // Validate availability
        if (row.availability && !['in_stock', 'out_of_stock', 'discontinued'].includes(row.availability)) {
          rowErrors.push('availability must be one of: in_stock, out_of_stock, discontinued');
        }
        
        // Validate name-based relation fields using real data (warnings only - can continue with valid ones)
        if (relationData) {
        if (row.fabric_names) {
            const fabricNames = row.fabric_names.split(',').map(name => name.trim()).filter(n => n);
            const validFabrics = relationData.fabrics?.byName || {};
            
            // Check which fabric names don't exist in database OR import file
            const invalidNames = fabricNames.filter(name => {
              if (!name || typeof name !== 'string') return true; // Skip invalid names
              const existsInDB = validFabrics[name];
              const existsInImport = dataset.fabrics?.some(fabric => 
                fabric.name && fabric.name.toLowerCase().trim() === name.toLowerCase().trim()
              );
              return !existsInDB && !existsInImport;
            });
            
          if (invalidNames.length > 0) {
              rowWarnings.push(`⚠️ Fabrics not found (will be skipped): ${invalidNames.join(', ')}`);
            } else {
              // All fabrics found - log success
              console.log(`✅ All fabrics found for ${sheetName} Row ${index + 1}: ${fabricNames.join(', ')}`);
          }
        }
        
        if (row.lining_names) {
            const liningNames = row.lining_names.split(',').map(name => name.trim()).filter(n => n);
            const validLinings = relationData.linings?.byType || {};
            
            // Check which lining names don't exist in database OR import file
            const invalidNames = liningNames.filter(name => {
              if (!name || typeof name !== 'string') return true; // Skip invalid names
              const existsInDB = validLinings[name];
              const existsInImport = dataset.linings?.some(lining => 
                lining.name && lining.name.toLowerCase().trim() === name.toLowerCase().trim()
              );
              return !existsInDB && !existsInImport;
            });
            
          if (invalidNames.length > 0) {
              rowWarnings.push(`⚠️ Linings not found (will be skipped): ${invalidNames.join(', ')}`);
            } else {
              console.log(`✅ All linings found for ${sheetName} Row ${index + 1}: ${liningNames.join(', ')}`);
          }
        }
        
        if (row.trimming_names) {
            const trimmingNames = row.trimming_names.split(',').map(name => name.trim()).filter(n => n);
            const validTrimmings = relationData.trimmings?.byType || {};
            
            // Check which trimming names don't exist in database OR import file
            const invalidNames = trimmingNames.filter(name => {
              if (!name || typeof name !== 'string') return true; // Skip invalid names
              const existsInDB = validTrimmings[name];
              const existsInImport = dataset.trimmings?.some(trimming => 
                trimming.name && trimming.name.toLowerCase().trim() === name.toLowerCase().trim()
              );
              return !existsInDB && !existsInImport;
            });
            
          if (invalidNames.length > 0) {
              rowWarnings.push(`⚠️ Trimmings not found (will be skipped): ${invalidNames.join(', ')}`);
            } else {
              console.log(`✅ All trimmings found for ${sheetName} Row ${index + 1}: ${trimmingNames.join(', ')}`);
          }
        }
        
        if (row.mechanisation_names) {
            const mechanisationNames = row.mechanisation_names.split(',').map(name => name.trim()).filter(n => n);
            const validMechanisations = relationData.mechanisations?.byType || {};
            
            // Check which mechanisation names don't exist in database OR import file
            const invalidNames = mechanisationNames.filter(name => {
              if (!name || typeof name !== 'string') return true; // Skip invalid names
              const existsInDB = validMechanisations[name];
              const existsInImport = dataset.mechanisations?.some(mechanisation => 
                mechanisation.name && mechanisation.name.toLowerCase().trim() === name.toLowerCase().trim()
              );
              return !existsInDB && !existsInImport;
            });
            
            if (invalidNames.length > 0) {
              rowWarnings.push(`⚠️ Mechanisations not found (will be skipped): ${invalidNames.join(', ')}`);
            } else {
              console.log(`✅ All mechanisations found for ${sheetName} Row ${index + 1}: ${mechanisationNames.join(', ')}`);
            }
        }
          
          if (row.curtain_type_name) {
            const validCurtainTypes = relationData['curtain-types']?.byName || {};
            const curtainTypeExistsInImport = dataset.curtaintypes?.some(type => 
              type.name.toLowerCase().trim() === row.curtain_type_name.toLowerCase().trim()
            );
            
            if (!validCurtainTypes[row.curtain_type_name] && !curtainTypeExistsInImport) {
              rowErrors.push(`❌ Curtain type required but not found: ${row.curtain_type_name}`);
            } else if (!validCurtainTypes[row.curtain_type_name] && curtainTypeExistsInImport) {
              console.log(`✅ Curtain type "${row.curtain_type_name}" exists in import file, will be created`);
            }
          }
          
          if (row.blind_type_name) {
            const validBlindTypes = relationData['blind-types']?.byName || {};
            const blindTypeExistsInImport = dataset.blindtypes?.some(type => 
              type.name.toLowerCase().trim() === row.blind_type_name.toLowerCase().trim()
            );
            
            if (!validBlindTypes[row.blind_type_name] && !blindTypeExistsInImport) {
              rowErrors.push(`❌ Blind type required but not found: ${row.blind_type_name}`);
            } else if (!validBlindTypes[row.blind_type_name] && blindTypeExistsInImport) {
              console.log(`✅ Blind type "${row.blind_type_name}" exists in import file, will be created`);
            }
          }
          
          if (row.cushion_type_name) {
            const validCushionTypes = relationData['cushion-types']?.byName || {};
            const cushionTypeExistsInImport = dataset.cushiontypes?.some(type => 
              type.name.toLowerCase().trim() === row.cushion_type_name.toLowerCase().trim()
            );
            
            if (!validCushionTypes[row.cushion_type_name] && !cushionTypeExistsInImport) {
              rowErrors.push(`❌ Cushion type required but not found: ${row.cushion_type_name}`);
            } else if (!validCushionTypes[row.cushion_type_name] && cushionTypeExistsInImport) {
              console.log(`✅ Cushion type "${row.cushion_type_name}" exists in import file, will be created`);
            }
          }
          
          // Validate brand name for fabrics (required for fabrics)
          if (sheetName === 'fabrics' && row.brand_name) {
            const brandNameLower = row.brand_name.toLowerCase().trim();
            
            // Check if brand exists in database
            const brandExistsInDB = Object.values(relationData.brands?.byName || {})
              .some(b => b.name.toLowerCase().trim() === brandNameLower);
            
            // Check if brand exists in current import file
            const brandExistsInImport = dataset.brands?.some(brand => 
              brand.name.toLowerCase().trim() === brandNameLower
            );
            
            if (!brandExistsInDB && !brandExistsInImport) {
              // Brand doesn't exist anywhere - will be auto-created
              rowWarnings.push(`ℹ️ Brand "${row.brand_name}" will be auto-created`);
            } else if (!brandExistsInDB && brandExistsInImport) {
              // Brand exists in import file but not in database - this is OK, it will be created
              console.log(`✅ Brand "${row.brand_name}" exists in import file, will be created`);
            }
          }
        }
        
        if (rowErrors.length > 0) {
          errors.push({
            sheet: sheetName,
            row: index + 1,
            errors: rowErrors
          });
        }
        
        if (rowWarnings.length > 0) {
          warnings.push({
            sheet: sheetName,
            row: index + 1,
            warnings: rowWarnings
          });
        }
      });
    });
    
    // Collect auto-creatable brands for info display
    const autoCreatableBrands = new Set();
    if (dataset.fabrics) {
      dataset.fabrics.forEach(row => {
        if (row.brand_name && relationData) {
          const brandNameLower = row.brand_name.toLowerCase().trim();
          const brandExistsInDB = Object.values(relationData.brands?.byName || {})
            .some(b => b.name.toLowerCase().trim() === brandNameLower);
          
          if (!brandExistsInDB) {
            autoCreatableBrands.add(row.brand_name);
          }
        }
      });
    }
    
    if (autoCreatableBrands.size > 0) {
      info.push({
        type: 'auto_create',
        message: `Will auto-create ${autoCreatableBrands.size} brands: ${Array.from(autoCreatableBrands).join(', ')}`,
        items: Array.from(autoCreatableBrands)
      });
    }
    
    return {
      isValid: errors.length === 0,
      errors: errors,
      warnings: warnings,
      info: info
    };
  },

  // Transform imported data to match API format
  transformImportData: (data) => {
    const parseDDMMYYYY = (value) => {
      if (!value) return null;
      if (typeof value === 'string') {
        const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!m) return null;
        const day = parseInt(m[1], 10);
        const month = parseInt(m[2], 10) - 1; // zero-based
        const year = parseInt(m[3], 10);
        const d = new Date(Date.UTC(year, month, day, 0, 0, 0));
        return d.toISOString();
      }
      if (typeof value === 'number') {
        // Excel serial date (days since 1899-12-30). Convert to UTC midnight
        const excelEpoch = Date.UTC(1899, 11, 30);
        const ms = excelEpoch + value * 24 * 60 * 60 * 1000;
        return new Date(ms).toISOString();
      }
      if (value instanceof Date && !isNaN(value)) {
        return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0)).toISOString();
      }
      return null;
    };

    return data.map(row => {
      const isFeatured = row.is_featured === 'true' || row.is_featured === true;
      let featuredUntilIso = null;
      if (isFeatured && row.featured_until) {
        featuredUntilIso = parseDDMMYYYY(row.featured_until) || new Date(row.featured_until).toISOString();
      }
      return {
        name: row.name?.toString().trim(),
        description: row.description?.toString().trim() || null,
        productId: row.productId?.toString().trim(),
        // Don't set slug - let auto-slug plugin generate it from name and productId
        colour: row.colour?.toString().trim(),
        pattern: row.pattern?.toString().trim(),
        composition: row.composition?.toString().trim(),
        price_per_metre: row.price_per_metre ? parseFloat(row.price_per_metre) : null,
        patternRepeat_cm: row.patternRepeat_cm ? parseFloat(row.patternRepeat_cm) : null,
        usableWidth_cm: row.usableWidth_cm ? parseFloat(row.usableWidth_cm) : null,
        martindale: row.martindale ? parseInt(row.martindale) : null,
        availability: row.availability ? row.availability.toString().trim().toLowerCase() : undefined,
        is_featured: isFeatured,
        featured_until: featuredUntilIso,
        images: [] // Empty array for new imports
      };
    });
  },

  // Transform multi-sheet imported data to match API format
  transformImportDataMulti: (dataset, relationData = null) => {
    const transformed = {};
    
    Object.entries(dataset).forEach(([sheetName, data]) => {
      transformed[sheetName] = data.map(row => {
        const baseData = {
          name: row.name?.toString().trim() || 'Unknown',
          description: row.description?.toString().trim() || null,
        };

        // Handle specific fields for each product type
        switch (sheetName) {
          case 'fabrics':
            const parseDDMMYYYY = (value) => {
              if (!value) return null;
              if (typeof value === 'string') {
                const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                if (!m) return null;
                const day = parseInt(m[1], 10);
                const month = parseInt(m[2], 10) - 1;
                const year = parseInt(m[3], 10);
                const d = new Date(Date.UTC(year, month, day, 0, 0, 0));
                return d.toISOString();
              }
              if (typeof value === 'number') {
                const excelEpoch = Date.UTC(1899, 11, 30);
                const ms = excelEpoch + value * 24 * 60 * 60 * 1000;
                return new Date(ms).toISOString();
              }
              if (value instanceof Date && !isNaN(value)) {
                return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0)).toISOString();
              }
              return null;
            };

            const isFeatured = row.is_featured === 'true' || row.is_featured === true;
            const isCurtain = row.is_curtain === 'true' || row.is_curtain === true;
            let featuredUntil = null;
            if (isFeatured && row.featured_until) {
              featuredUntil = parseDDMMYYYY(row.featured_until) || new Date(row.featured_until).toISOString();
            }

            const transformedFabric = {
              ...baseData,
              productId: row.productId?.toString().trim(),
              // Don't set slug - let auto-slug plugin generate it from name and productId
              colour: row.colour?.toString().trim(),
              pattern: row.pattern?.toString().trim(),
              composition: row.composition?.toString().trim(),
              price_per_metre: row.price_per_metre ? parseFloat(row.price_per_metre) : null,
              patternRepeat_cm: row.patternRepeat_cm ? parseFloat(row.patternRepeat_cm) : null,
              usableWidth_cm: row.usableWidth_cm ? parseFloat(row.usableWidth_cm) : null,
              martindale: row.martindale && row.martindale !== null ? parseInt(row.martindale) : undefined,
              availability: row.availability ? row.availability.toString().trim().toLowerCase() : undefined,
              is_featured: isFeatured,
              is_curtain: isCurtain,
              featured_until: featuredUntil,
              images: [],
              // Pass relation names as strings - backend will convert to IDs
              brand_name: row.brand_name?.toString().trim(),
              curtain_names: row.curtain_names?.toString().trim(),
              blind_names: row.blind_names?.toString().trim(),
              cushion_names: row.cushion_names?.toString().trim(),
              care_instruction_names: row.care_instruction_names?.toString().trim(),
              // Handle collections: pass as-is (array or string), backend will convert to collection field
              collections: row.collections || row.collection || undefined
            };

            const requiredDefaults = {
              colour: 'Unknown',
              pattern: 'Solid',
              patternRepeat_cm: 0,
              usableWidth_cm: 0,
              availability: 'in_stock'
            };

            Object.entries(requiredDefaults).forEach(([key, value]) => {
              if (
                transformedFabric[key] === undefined ||
                transformedFabric[key] === null ||
                transformedFabric[key] === '' ||
                (typeof transformedFabric[key] === 'number' && Number.isNaN(transformedFabric[key]))
              ) {
                transformedFabric[key] = value;
              }
            });

            // Remove martindale if it's null or NaN (leave it empty)
            if (
              transformedFabric.martindale === undefined ||
              transformedFabric.martindale === null ||
              Number.isNaN(transformedFabric.martindale)
            ) {
              delete transformedFabric.martindale;
            }

            console.log(`🔗 Frontend: Passing relation names for fabric "${row.name}":`, {
              brand_name: transformedFabric.brand_name,
              curtain_names: transformedFabric.curtain_names,
              blind_names: transformedFabric.blind_names,
              cushion_names: transformedFabric.cushion_names,
              care_instruction_names: transformedFabric.care_instruction_names
            });

            return transformedFabric;
          
          case 'curtains':
            return {
              ...baseData,
              price_per_metre: row.price_per_metre ? parseFloat(row.price_per_metre) : null,
              availability: row.availability?.toString().trim(),
              // Pass relation names as strings - backend will convert to IDs
              fabric_names: row.fabric_names?.toString().trim(),
              lining_names: row.lining_names?.toString().trim(),
              trimming_names: row.trimming_names?.toString().trim(),
              curtain_type_name: row.curtain_type_name?.toString().trim(),
              pricing_rules_names: row.pricing_rules_names?.toString().trim()
            };
          
          case 'blinds':
            return {
              ...baseData,
              price_per_metre: row.price_per_metre ? parseFloat(row.price_per_metre) : null,
              availability: row.availability?.toString().trim(),
              // Pass relation names as strings - backend will convert to IDs
              fabric_names: row.fabric_names?.toString().trim(),
              lining_names: row.lining_names?.toString().trim(),
              trimming_names: row.trimming_names?.toString().trim(),
              mechanisation_names: row.mechanisation_names?.toString().trim(),
              blind_type_name: row.blind_type_name?.toString().trim(),
              pricing_rules_names: row.pricing_rules_names?.toString().trim()
            };
          
          case 'cushions':
            return {
              ...baseData,
              price_per_metre: row.price_per_metre ? parseFloat(row.price_per_metre) : null,
              availability: row.availability?.toString().trim(),
              // Pass relation names as strings - backend will convert to IDs
              fabric_names: row.fabric_names?.toString().trim(),
              cushion_type_name: row.cushion_type_name?.toString().trim(),
              pricing_rules_names: row.pricing_rules_names?.toString().trim()
            };
          
          case 'linings':
            return {
              ...baseData,
              name: row.liningType?.toString().trim() || row.name?.toString().trim() || 'Unknown',
              liningType: row.liningType?.toString().trim(),
              price: row.price ? parseFloat(row.price) : null,
              colour: row.colour?.toString().trim(),
              // Pass relation names as strings - backend will convert to IDs
              fabric_names: row.fabric_names?.toString().trim()
            };
          
          case 'trimmings':
            return {
              ...baseData,
              name: row.type?.toString().trim() || row.name?.toString().trim() || 'Unknown',
              type: row.type?.toString().trim(),
              price: row.price ? parseFloat(row.price) : null,
              // Pass relation names as strings - backend will convert to IDs
              fabric_names: row.fabric_names?.toString().trim()
            };
          
          case 'mechanisations':
            return {
              ...baseData,
              name: row.type?.toString().trim() || row.name?.toString().trim() || 'Unknown',
              type: row.type?.toString().trim(),
              price: row.price ? parseFloat(row.price) : null,
              // Pass relation names as strings - backend will convert to IDs
              blind_names: row.blind_names?.toString().trim()
            };
          
          case 'brands':
            return {
              ...baseData,
              thumbnail_url: row.thumbnail_url?.toString().trim(),
              // Pass relation names as strings - backend will convert to IDs
              fabric_names: row.fabric_names?.toString().trim()
            };
          
          case 'pricing_rules':
            return {
              ...baseData,
              product_type: row.product_type?.toString().trim(),
              formula: row.formula ? (typeof row.formula === 'string' ? JSON.parse(row.formula) : row.formula) : null,
              // Pass relation names as strings - backend will convert to IDs
              curtain_names: row.curtain_names?.toString().trim(),
              blind_names: row.blind_names?.toString().trim(),
              cushion_names: row.cushion_names?.toString().trim()
            };
          
          case 'care_instructions':
            return {
              ...baseData,
              // Pass relation names as strings - backend will convert to IDs
              fabric_names: row.fabric_names?.toString().trim()
            };
          
          default:
            return baseData;
        }
      });
    });
    
    return transformed;
  },

  // Bulk import products
  bulkImport: async (transformedData, apiPath, getAuthHeaders) => {
    console.log('📤 Starting bulk import...');
    console.log('📤 API Path:', apiPath);
    console.log('📤 Total rows to import:', transformedData.length);
    
    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    for (let i = 0; i < transformedData.length; i++) {
      try {
        console.log(`📤 Importing row ${i + 1}/${transformedData.length}:`, transformedData[i]);
        
        const response = await fetch(apiPath, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            data: transformedData[i]
          })
        });

        console.log(`📤 Row ${i + 1} response status:`, response.status);

        if (response.ok) {
          const responseData = await response.json();
          console.log(`✅ Row ${i + 1} imported successfully:`, responseData);
          results.success++;
        } else {
          const errorText = await response.text();
          console.error(`❌ Row ${i + 1} failed. Status: ${response.status}`);
          console.error(`❌ Error response:`, errorText);
          
          let errorMessage;
          try {
            const errorData = JSON.parse(errorText);
            errorMessage = errorData.error?.message || errorData.message || `HTTP ${response.status}`;
          } catch (e) {
            errorMessage = `HTTP ${response.status}: ${errorText.substring(0, 100)}`;
          }
          
          results.failed++;
          results.errors.push({
            row: i + 1,
            data: transformedData[i],
            error: errorMessage
          });
        }
      } catch (error) {
        console.error(`❌ Row ${i + 1} exception:`, error);
        results.failed++;
        results.errors.push({
          row: i + 1,
          data: transformedData[i],
          error: error.message
        });
      }
    }

    console.log('📤 Bulk import completed:', results);
    return results;
  },

  // Server-side bulk import using custom endpoint
  bulkImportMultiSheet: async (transformedDataset, getAuthHeaders) => {
    console.log('📤 Starting multi-sheet bulk import via server endpoint...');
    
    try {
      const response = await fetch('/api/order-management/import', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          data: transformedDataset
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server import failed: ${response.status} - ${errorText}`);
      }

      let results;
      try {
        results = await response.json();
      } catch (parseError) {
        const responseText = await response.text();
        console.error('❌ Failed to parse import response:', responseText);
        throw new Error('Server returned invalid JSON response. Check server logs for details.');
      }
      
      console.log('📤 [FRONTEND] Server-side bulk import completed:', results);
      
      // Log auto-creation summary if available
      if (results.autoCreationSummary) {
        console.log('📊 [FRONTEND] AUTO-CREATION SUMMARY FROM BACKEND:');
        console.log(`   Brands: ${results.autoCreationSummary.brandsCreated} created, ${results.autoCreationSummary.brandsFailed} failed`);
        console.log(`   Care Instructions: ${results.autoCreationSummary.careInstructionsCreated} created, ${results.autoCreationSummary.careInstructionsFailed} failed`);
        console.log(`   Total brands in map: ${results.autoCreationSummary.totalBrandsInMap}`);
        console.log(`   Total care instructions in map: ${results.autoCreationSummary.totalCareInstructionsInMap}`);
        
        if (results.autoCreationSummary.brandsCreated === 0 && results.autoCreationSummary.brandsFailed === 0) {
          console.warn('⚠️ [FRONTEND] WARNING: No brands were created or failed! Check backend logs.');
        }
        if (results.autoCreationSummary.careInstructionsCreated === 0 && results.autoCreationSummary.careInstructionsFailed === 0) {
          console.warn('⚠️ [FRONTEND] WARNING: No care instructions were created or failed! Check backend logs.');
        }
      } else {
        console.warn('⚠️ [FRONTEND] WARNING: No autoCreationSummary in response! Backend code may not be deployed yet.');
      }
      
      // Log errors related to auto-creation
      if (results.errors && results.errors.length > 0) {
        const autoCreateErrors = results.errors.filter(e => e.type === 'auto_create_error' || e.type === 'missing_relation');
        if (autoCreateErrors.length > 0) {
          console.error('❌ [FRONTEND] Auto-creation errors:', autoCreateErrors);
        }
      }
      
      return results;
    } catch (error) {
      console.error('❌ Server-side bulk import error:', error);
      throw error;
    }
  }
};

export default excelHelper;
