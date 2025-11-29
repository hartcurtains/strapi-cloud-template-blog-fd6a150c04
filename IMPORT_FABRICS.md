# Fabric Import Guide

## Overview
This guide explains how to import fabrics from `fixed-fabrics-import.json` into Strapi with all relations (brands and care instructions).

## What Was Fixed

1. **JSON File**: All fabrics with `patternRepeat_cm = 0` now have `pattern` set to `"Plain"`
2. **Import Endpoint**: Added `/api/fabrics/import` endpoint that handles:
   - Creating/updating brands
   - Creating/updating care instructions
   - Importing fabrics with proper relations
3. **Node.js Error**: Fixed the `undici` module error by reinstalling node_modules

## How to Import

### Option 1: Using the API Endpoint (Recommended)

1. Start Strapi:
   ```bash
   npm run dev
   ```

2. Once Strapi is running, make a POST request to:
   ```
   POST http://localhost:1337/api/fabrics/import
   ```

   You can use:
   - **cURL**:
     ```bash
     curl -X POST http://localhost:1337/api/fabrics/import
     ```
   
   - **Postman/Insomnia**: POST request to `http://localhost:1337/api/fabrics/import`
   
   - **Browser Console** (if you're logged into Strapi admin):
     ```javascript
     fetch('http://localhost:1337/api/fabrics/import', { method: 'POST' })
       .then(r => r.json())
       .then(console.log)
     ```

### Option 2: Using the Script Directly

The script is available at `scripts/import-fabrics.js` and can be integrated into your bootstrap process if needed.

## Import Process

The import will:
1. ✅ Read `fixed-fabrics-import.json`
2. ✅ Fix patterns (set to "Plain" if `patternRepeat_cm = 0`)
3. ✅ Create or find brands (from `brand_name` field)
4. ✅ Create or find care instructions (from `care_instruction_names` field, split by comma)
5. ✅ Import fabrics with relations:
   - Links to brand
   - Links to care instructions
6. ✅ Update existing fabrics (matched by `productId`) or create new ones

## Response Format

The API returns:
```json
{
  "success": true,
  "message": "Fabric import completed",
  "created": 121,
  "updated": 0,
  "failed": 0,
  "total": 121,
  "errors": []
}
```

## Notes

- The import is **idempotent**: running it multiple times will update existing fabrics instead of creating duplicates
- Fabrics are matched by `productId`
- Brands and care instructions are matched by `name`
- All imported fabrics are automatically published



