/**
 * Update Fabric Flags (is_cushion, is_curtain, is_blind)
 *
 * Usage:
 *   node scripts/update-fabric-flags.js <json-file>
 *
 * The JSON file should be an array of objects with at minimum:
 *   { "productId": "FAB-NAME-1234", "is_cushion": true }
 *
 * Supported fields per entry:
 *   productId  (required) — matches existing fabric
 *   is_cushion (optional) — boolean
 *   is_curtain (optional) — boolean
 *   is_blind   (optional) — boolean
 *
 * Requires env var STRAPI_API_TOKEN with full-access permission on Fabric content type.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const STRAPI_URL = process.env.STRAPI_URL || 'https://energized-paradise-70d35b3d01.strapiapp.com';
const API_TOKEN = process.env.STRAPI_API_TOKEN;

if (!API_TOKEN) {
  console.error('❌ Set STRAPI_API_TOKEN env var first. Generate one in Strapi Admin > Settings > API Tokens.');
  process.exit(1);
}

const jsonFile = process.argv[2];
if (!jsonFile) {
  console.error('Usage: node scripts/update-fabric-flags.js <json-file>');
  process.exit(1);
}

const filePath = path.resolve(jsonFile);
if (!fs.existsSync(filePath)) {
  console.error(`❌ File not found: ${filePath}`);
  process.exit(1);
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, STRAPI_URL);
    const mod = url.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      method,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);

    const req = mod.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function findFabric(productId) {
  const res = await request('GET', `/api/fabrics?filters[productId][$eq]=${encodeURIComponent(productId)}&pagination[limit]=1`);
  if (res.status !== 200) return null;
  const docs = res.data?.data;
  return docs && docs.length > 0 ? docs[0] : null;
}

async function updateFabric(documentId, data) {
  return request('PUT', `/api/fabrics/${documentId}`, data);
}

async function main() {
  const updates = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  console.log(`📦 Loaded ${updates.length} updates from ${path.basename(filePath)}`);

  let updated = 0, notFound = 0, failed = 0;

  for (const item of updates) {
    const { productId, ...flags } = item;
    if (!productId) { failed++; continue; }

    try {
      const fabric = await findFabric(productId);
      if (!fabric) {
        notFound++;
        continue;
      }

      const payload = {};
      if (flags.is_cushion !== undefined) payload.is_cushion = flags.is_cushion;
      if (flags.is_curtain !== undefined) payload.is_curtain = flags.is_curtain;
      if (flags.is_blind !== undefined) payload.is_blind = flags.is_blind;

      if (Object.keys(payload).length === 0) continue;

      const res = await updateFabric(fabric.documentId, payload);
      if (res.status >= 200 && res.status < 300) {
        updated++;
      } else {
        console.error(`  ❌ ${productId}: ${res.status} ${JSON.stringify(res.data).slice(0, 120)}`);
        failed++;
      }
    } catch (err) {
      console.error(`  ❌ ${productId}: ${err.message}`);
      failed++;
    }

    if ((updated + failed) % 25 === 0) process.stdout.write('.');
  }

  console.log(`\n\n📊 Done:`);
  console.log(`   ✅ Updated: ${updated}`);
  console.log(`   ⚠️  Not found: ${notFound}`);
  console.log(`   ❌ Failed: ${failed}`);
}

main().catch(console.error);
