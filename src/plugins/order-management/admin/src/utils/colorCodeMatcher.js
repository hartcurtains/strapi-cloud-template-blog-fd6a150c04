/**
 * Color Code Matcher Utility (Client-Side)
 * 
 * Provides client-side functions for extracting color codes from fabric names
 * and looking up those codes via the API.
 */

/**
 * Extract color code from fabric name (last 2 characters, normalized to UPPERCASE)
 * 
 * @param {string} name - The fabric name (e.g., "ALASKAAQ")
 * @returns {string|null} The color code in uppercase (e.g., "AQ") or null if name too short
 */
export function extractCodeFromName(name) {
  if (!name || name.length < 2) {
    return null;
  }

  const code = name.slice(-2).toUpperCase();
  return code;
}

/**
 * Look up a color code via the API
 * 
 * @param {string} code - The color code to look up (will be normalized to uppercase)
 * @returns {Promise<object>} The color code record {id, code, name} or null if not found
 */
export async function lookupColorCode(code) {
  try {
    if (!code || code.trim().length === 0) {
      console.warn('⚠️  Color code is empty');
      return null;
    }

    const normalizedCode = code.toUpperCase();
    
    const response = await fetch(
      `/api/order-management/color-codes/lookup?code=${encodeURIComponent(normalizedCode)}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`⚠️  Color code "${normalizedCode}" not found`);
        return null;
      }
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    if (data.success && data.data) {
      console.log(`✅ Found color code "${normalizedCode}": "${data.data.name}"`);
      return data.data;
    }

    return null;
  } catch (error) {
    console.error('❌ Error looking up color code:', error);
    return null;
  }
}

/**
 * Extract color code from name and look it up
 * 
 * @param {string} name - The fabric name
 * @returns {Promise<object|null>} The color code record or null
 */
export async function extractAndLookupColorCode(name) {
  const code = extractCodeFromName(name);
  if (!code) {
    return null;
  }

  return await lookupColorCode(code);
}
