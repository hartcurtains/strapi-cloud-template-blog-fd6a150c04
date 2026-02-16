/**
 * Manual test script for parseColourCodeFromFilename.
 * Run from project root: npx ts-node --project tsconfig.json src/api/order-management/scripts/test-parse-colour-code.ts
 * Or: node dist/src/api/order-management/scripts/test-parse-colour-code.js (after build)
 */

import { parseColourCodeFromFilename } from '../utils/parseColourCode';

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

const cases: Array<{ filename: string; expectedCode: string | null; expectedBaseName: string }> = [
  { filename: 'Shirt_Design_01.jpg', expectedCode: '01', expectedBaseName: 'Shirt_Design' },
  { filename: 'img12.jpg', expectedCode: '12', expectedBaseName: 'img' },
  { filename: 'img-12.png', expectedCode: '12', expectedBaseName: 'img' },
  { filename: 'img_12.jpeg', expectedCode: '12', expectedBaseName: 'img' },
  { filename: 'img1.jpg', expectedCode: null, expectedBaseName: 'img1' },
  { filename: 'noDigits.jpg', expectedCode: null, expectedBaseName: 'noDigits' },
  { filename: 'Fabric_Name_99.webp', expectedCode: '99', expectedBaseName: 'Fabric_Name' },
  { filename: 'single.jpeg', expectedCode: null, expectedBaseName: 'single' }
];

let passed = 0;
for (const { filename, expectedCode, expectedBaseName } of cases) {
  try {
    const result = parseColourCodeFromFilename(filename);
    assert(result.code === expectedCode, `${filename}: expected code ${expectedCode}, got ${result.code}`);
    assert(result.baseName === expectedBaseName, `${filename}: expected baseName "${expectedBaseName}", got "${result.baseName}"`);
    console.log(`✅ ${filename} -> code=${result.code}, baseName="${result.baseName}"`);
    passed++;
  } catch (e) {
    console.error(`❌ ${filename}:`, (e as Error).message);
  }
}
console.log(`\n${passed}/${cases.length} passed`);
