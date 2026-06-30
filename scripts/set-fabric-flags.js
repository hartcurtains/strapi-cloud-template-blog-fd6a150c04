/**
 * Standalone script to update is_cushion/is_curtain/is_blind flags
 * via Strapi Content API. No Strapi restart needed.
 *
 * Usage:
 *   STRAPI_URL=https://your-strapi.com STRAPI_TOKEN=your_token node hcbDBWIP/scripts/set-fabric-flags.js your-file.json
 *
 * The JSON should be an array of objects:
 *   [{ "productId": "FAB-AREZZO-9020", "is_cushion": true }, ...]
 *
 * Or wrapped:
 *   { "fabrics": [{ "productId": "FAB-AREZZO-9020", "is_cushion": true }, ...] }
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const STRAPI_URL = process.env.STRAPI_URL || 'https://energized-paradise-70d35b3d01.strapiapp.com';
const API_TOKEN = process.env.STRAPI_TOKEN;

if (!API_TOKEN) {
  console.error('Set STRAPI_TOKEN env var (API token from Strapi Admin > Settings > API Tokens)');
  process.exit(1);
}

const jsonFile = process.argv[2];
if (!jsonFile) {
  console.error('Usage: STRAPI_TOKEN=xxx node set-fabric-flags.js <json-file>');
  process.exit(1);
}

function api(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, STRAPI_URL);
    const mod = url.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = mod.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, json: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  let raw = JSON.parse(fs.readFileSync(path.resolve(jsonFile), 'utf8'));
  const items = Array.isArray(raw) ? raw : (raw.fabrics || raw.data || []);

  console.log(`Processing ${items.length} items against ${STRAPI_URL}`);

  let ok = 0, skip = 0, fail = 0;

  for (const item of items) {
    const pid = item.productId;
    if (!pid) { skip++; continue; }

    const flags = {};
    if (item.is_cushion !== undefined) flags.is_cushion = item.is_cushion;
    if (item.is_curtain !== undefined) flags.is_curtain = item.is_curtain;
    if (item.is_blind !== undefined) flags.is_blind = item.is_blind;

    if (Object.keys(flags).length === 0) { skip++; continue; }

    try {
      // Find the fabric by productId
      const search = await api('GET', `/api/fabrics?filters[productId][$eq]=${encodeURIComponent(pid)}&pagination[pageSize]=1`);
      const docs = search.json?.data;
      if (!docs || docs.length === 0) {
        console.log(`  ⚠ Not found: ${pid}`);
        skip++;
        continue;
      }

      const doc = docs[0];
      const res = await api('PUT', `/api/fabrics/${doc.documentId}`, flags);

      if (res.status >= 200 && res.status < 300) {
        ok++;
      } else {
        console.error(`  ❌ ${pid}: ${res.status} ${JSON.stringify(res.json).slice(0, 150)}`);
        fail++;
      }
    } catch (err) {
      console.error(`  ❌ ${pid}: ${err.message}`);
      fail++;
    }

    if ((ok + fail) % 10 === 0 && ok + fail > 0) process.stdout.write('.');
  }

  console.log(`\n\n✅ Updated: ${ok}  ⚠ Skipped: ${skip}  ❌ Failed: ${fail}`);
}

main().catch(console.error);
