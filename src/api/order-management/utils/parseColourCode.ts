/**
 * Parses the last two chars from a filename (before extension) as the colour code.
 * Supports:
 * - 2 digits: Shirt_Design_01.jpg -> 01, img12.jpg -> 12
 * - 2 letters: ADELINEWA.jpg -> WA (baseName: ADELINE), ADELINESA.jpg -> SA
 * Returns null when no 2-char code is found.
 */

export interface ParseColourCodeResult {
  code: string | null;
  baseName: string;
  /** Filename without extension (identifier) */
  identifier: string;
}

export function parseColourCodeFromFilename(filename: string): ParseColourCodeResult {
  const identifier = filename.replace(/\.[^/.]+$/, '').trim();
  // Try 2-digit numeric code first (e.g. name_01, name-12)
  const digitMatch = identifier.match(/^(.*?)[-_]?(\d{2})$/);
  if (digitMatch) {
    const baseName = digitMatch[1].replace(/[-_]+$/, '').trim();
    return { code: digitMatch[2], baseName, identifier };
  }
  // Then try 2-letter code (e.g. ADELINEWA -> ADELINE + WA)
  const letterMatch = identifier.match(/^(.*?)([A-Za-z]{2})$/);
  if (letterMatch) {
    const baseName = letterMatch[1].replace(/[-_]+$/, '').trim();
    return { code: letterMatch[2], baseName, identifier };
  }
  return { code: null, baseName: identifier, identifier };
}
