'use strict';

require('../../node_modules/ts-node/register');

const test = require('node:test');
const assert = require('node:assert/strict');
const quoteAuth = require('../src/policies/storefront-quote-auth');

const originalInternalSecret = process.env.STRAPI_INTERNAL_SECURITY_SECRET;

test('accepts the server-only internal secret for the MTM quote policy', async () => {
  process.env.STRAPI_INTERNAL_SECURITY_SECRET = 'internal-secret-test';

  const context = { request: { headers: { 'x-strapi-internal-security-secret': 'internal-secret-test' } }, state: {} };
  assert.equal(await quoteAuth(context), true);
});

test('rejects an incorrect internal secret for the MTM quote policy', async () => {
  process.env.STRAPI_INTERNAL_SECURITY_SECRET = 'internal-secret-test';

  const context = { request: { headers: { 'x-strapi-internal-security-secret': 'wrong-secret' } }, state: {} };
  assert.equal(await quoteAuth(context), false);
});

test.after(() => {
  if (originalInternalSecret === undefined) delete process.env.STRAPI_INTERNAL_SECURITY_SECRET;
  else process.env.STRAPI_INTERNAL_SECURITY_SECRET = originalInternalSecret;
});
