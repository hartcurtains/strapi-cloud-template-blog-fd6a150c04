'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

test('aggregate storefront route is server-authenticated and read-only', () => {
  const routes = read('src/api/storefront/routes/storefront.ts');
  assert.match(routes, /path:\s*'\/storefront\/catalogue-snapshot'/);
  assert.match(routes, /handler:\s*'storefront\.catalogueSnapshot'/);
  assert.match(routes, /catalogueSnapshot'[\s\S]*?auth:\s*false/);
  assert.match(routes, /catalogueSnapshot'[\s\S]*?global::catalogue-snapshot-auth/);
  const policy = read('src/policies/catalogue-snapshot-auth.ts');
  assert.match(policy, /CATALOGUE_REFRESH_SECRET/);
  assert.match(policy, /timingSafeEqual/);
  assert.match(policy, /x-catalogue-snapshot-secret/);
  assert.match(policy, /admin::api-token/);
});

test('aggregate projection excludes orders and pricing formulas', () => {
  const projection = read('src/api/storefront/services/catalogue-snapshot.ts');
  const controller = read('src/api/storefront/controllers/storefront.ts');
  assert.match(projection, /pricingRules = relationItems/);
  assert.match(projection, /stripFormulaFields/);
  assert.doesNotMatch(projection, /populate:[\s\S]*orders/);
  assert.match(projection, /lower === 'formula'/);
  assert.match(controller, /pricingRules: pricingRules\.map/);
  assert.doesNotMatch(controller, /product_type: item\.product_type \|\| '', formula:/);
});

test('catalogue mutations use one debounced server-only refresh trigger', () => {
  const refresh = read('src/api/storefront/services/catalogue-refresh.ts');
  assert.match(refresh, /CATALOGUE_REFRESH_SECRET/);
  assert.match(refresh, /Authorization:\s*`Bearer \$\{secret\}`/);
  assert.match(refresh, /setTimeout\(\(\) =>/);
  assert.match(refresh, /afterCreateMany/);
  assert.match(refresh, /afterUpdateMany/);
  assert.match(refresh, /afterDeleteMany/);
  assert.doesNotMatch(refresh, /NEXT_PUBLIC_/);
});
