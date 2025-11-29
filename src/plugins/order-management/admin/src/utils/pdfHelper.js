/**
 * PDF Helper Utility
 * Parses PDF files and extracts structured data for import into Strapi
 * Uses client-side PDF parsing to avoid server route issues
 */

// Helper functions for parsing PDF text
function parsePDFText(text) {
  console.log('📄 Parsing PDF text...');
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
    const priceMatch = values.join(' ').match(/(?:£|\$|€)?\s*(\d+\.?\d*)/);
    if (priceMatch) {
      fabric.price_per_metre = parseFloat(priceMatch[1]);
    }
  }

  return fabric;
}

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

export const pdfHelper = {
  /**
   * Parse PDF file and extract structured data (client-side)
   * @param {File} file - PDF file to parse
   * @returns {Promise<Object>} - Parsed data in same format as Excel import
   */
  parsePDF: async (file) => {
    try {
      console.log('📄 Starting client-side PDF parsing...');
      
      // Load PDF.js from CDN (no npm package needed)
      let pdfjs = window.pdfjsLib || window.pdfjs;
      
      if (!pdfjs) {
        // Load PDF.js from CDN
        await new Promise((resolve, reject) => {
          // Check if already loading
          if (window._pdfjsLoading) {
            window._pdfjsLoading.then(resolve).catch(reject);
            return;
          }
          
          window._pdfjsLoading = new Promise((res, rej) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js';
            script.onload = () => {
              pdfjs = window.pdfjsLib || window.pdfjs;
              if (pdfjs && pdfjs.GlobalWorkerOptions) {
                pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js';
              }
              window._pdfjsLoading = null;
              res();
            };
            script.onerror = () => {
              window._pdfjsLoading = null;
              rej(new Error('Failed to load PDF.js from CDN'));
            };
            document.head.appendChild(script);
          });
          
          window._pdfjsLoading.then(resolve).catch(reject);
        });
        
        pdfjs = window.pdfjsLib || window.pdfjs;
      }
      
      if (!pdfjs) {
        throw new Error('Could not load PDF.js library');
      }
      
      // Read file as array buffer
      const arrayBuffer = await file.arrayBuffer();
      
      // Load PDF document
      const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      
      console.log(`📄 PDF loaded: ${pdf.numPages} pages`);
      
      // Extract text from all pages
      let fullText = '';
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + '\n';
      }
      
      console.log(`📄 Extracted ${fullText.length} characters of text`);
      
      // Parse structured data from text
      const parsedData = parsePDFText(fullText);
      
      console.log(`📄 Extracted data:`, Object.keys(parsedData).map(key => `${key}: ${parsedData[key].length} items`).join(', '));
      
      return parsedData;
    } catch (error) {
      console.error('Error parsing PDF:', error);
      throw new Error(`PDF parsing failed: ${error.message}`);
    }
  },

  /**
   * Validate PDF data structure
   * @param {Object} data - Parsed PDF data
   * @returns {Object} - Validation result
   */
  validatePDFData: (data) => {
    const errors = [];
    const warnings = [];

    if (!data || typeof data !== 'object') {
      errors.push('Invalid PDF data structure');
      return { isValid: false, errors, warnings };
    }

    if (data.fabrics && !Array.isArray(data.fabrics)) {
      errors.push('Fabrics data must be an array');
    }

    if (data.fabrics && data.fabrics.length === 0) {
      warnings.push('No fabric data found in PDF');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
};

export default pdfHelper;
