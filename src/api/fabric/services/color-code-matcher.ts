/**
 * Color Code Matcher Service
 * 
 * Handles extraction, lookup, and creation of colour records based on color codes.
 * Color codes are 2-letter codes (e.g., "AQ" for Aqua) extracted from fabric names.
 * 
 * Workflow:
 * 1. Extract color code from fabric name (last 2 chars, uppercase)
 * 2. Look up in color-codes collection to get the human-readable name
 * 3. Create a NEW colour record with that name
 * 4. Link the fabric to the created colour via the colours manyToMany relation
 */

import type { Core } from '@strapi/strapi';

interface ColorCodeRecord {
  id: string;
  documentId?: string;
  code: string;
  name: string;
}

interface ColourRecord {
  id: string;
  documentId?: string;
  name: string;
}

/**
 * Extract color code from fabric name (last 2 characters, normalized to UPPERCASE)
 * 
 * @param fabricName - The fabric name (e.g., "ALASKAAQ")
 * @returns The color code in uppercase (e.g., "AQ") or null if name too short
 */
export function extractColorCode(fabricName: string): string | null {
  if (!fabricName || fabricName.length < 2) {
    return null;
  }

  const code = fabricName.slice(-2).toUpperCase();
  return code;
}

/**
 * Look up a color code in the color-codes collection
 * 
 * @param strapi - Strapi instance
 * @param code - The color code to look up (will be normalized to uppercase)
 * @returns The color code record with id, code, and name
 */
export async function matchColorCodeToRecord(
  strapi: Core.Strapi,
  code: string
): Promise<ColorCodeRecord | null> {
  try {
    // Normalize code to uppercase
    const normalizedCode = code.toUpperCase();

    const records = await strapi.entityService.findMany('api::color-code.color-code', {
      filters: { code: normalizedCode },
      limit: 1,
    });

    if (records && Array.isArray(records) && records.length > 0) {
      return records[0] as ColorCodeRecord;
    }

    return null;
  } catch (error: any) {
    console.warn(`⚠️  Error looking up color code "${code}":`, error.message);
    return null;
  }
}

/**
 * Create a NEW colour record with the given name
 * 
 * @param strapi - Strapi instance
 * @param colorName - The colour name to use (from color-code lookup)
 * @param imageId - Optional image ID to attach to the colour record
 * @returns The created colour record with id and name
 */
export async function createColourFromColorCode(
  strapi: Core.Strapi,
  colorName: string,
  imageId?: string | number
): Promise<ColourRecord | null> {
  try {
    const data: any = {
      name: colorName,
    };

    // Attach image if provided
    if (imageId) {
      data.thumbnail = imageId;
    }

    const created = await strapi.entityService.create('api::colour.colour', {
      data,
    });

    return created as ColourRecord;
  } catch (error: any) {
    console.error(`❌ Error creating colour record for "${colorName}":`, error.message);
    return null;
  }
}

/**
 * Resolve fabric with automatic colour creation based on color code
 * 
 * Orchestrates the full workflow:
 * 1. Extract color code from fabric name
 * 2. Look up the code in color-codes collection
 * 3. If found, create a NEW colour record
 * 4. Link the fabric to the created colour
 * 5. Return the updated fabric data with colours relation
 * 
 * @param strapi - Strapi instance
 * @param fabricData - The fabric data object with name field
 * @param imageId - Optional image ID to attach to the colour record
 * @returns Updated fabric data with colours relation populated, or null if processing failed
 */
export async function resolveFabricWithColour(
  strapi: Core.Strapi,
  fabricData: any,
  imageId?: string | number
): Promise<any | null> {
  try {
    if (!fabricData || !fabricData.name) {
      console.warn('⚠️  Fabric data missing or no name provided');
      return fabricData;
    }

    // Step 1: Extract color code from fabric name
    const colorCode = extractColorCode(fabricData.name);
    if (!colorCode) {
      console.warn(`⚠️  Could not extract color code from fabric name: "${fabricData.name}" (name too short)`);
      return fabricData;
    }

    // Step 2: Look up color code in color-codes collection
    const colorCodeRecord = await matchColorCodeToRecord(strapi, colorCode);
    if (!colorCodeRecord) {
      console.warn(`⚠️  Color code "${colorCode}" not found in color-codes collection (skipping colour creation)`);
      return fabricData;
    }

    // Step 3: Create NEW colour record with the name from color-code
    const createdColour = await createColourFromColorCode(strapi, colorCodeRecord.name, imageId);
    if (!createdColour) {
      console.warn(`⚠️  Failed to create colour record for "${colorCodeRecord.name}"`);
      return fabricData;
    }

    // Step 4: Link the fabric to the created colour
    // Use documentId if available (Strapi v5+), fallback to id
    const colourId = createdColour.documentId || createdColour.id;

    const updatedFabricData = {
      ...fabricData,
      colours: [colourId], // Array of colour IDs to link via manyToMany relation
    };

    console.log(`✅ Auto-created colour "${createdColour.name}" (code: ${colorCode}) for fabric "${fabricData.name}"`);
    return updatedFabricData;
  } catch (error: any) {
    console.error('❌ Error in resolveFabricWithColour:', error.message);
    return fabricData;
  }
}
