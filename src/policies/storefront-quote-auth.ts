'use strict';

const crypto = require('node:crypto');
const { authenticateCatalogWrite } = require('../auth/catalog-write-auth');

function matchesSecret(supplied: unknown, expected: string | undefined): boolean {
  if (!expected || typeof supplied !== 'string' || !supplied) return false;

  const suppliedDigest = crypto.createHash('sha256').update(supplied, 'utf8').digest();
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(suppliedDigest, expectedDigest);
}

module.exports = async (policyContext: any) => {
  const internalSecret = policyContext?.request?.headers?.['x-strapi-internal-security-secret'];
  if (matchesSecret(internalSecret, process.env.STRAPI_INTERNAL_SECURITY_SECRET)) {
    return true;
  }

  const authentication = await authenticateCatalogWrite(policyContext);
  if (authentication) policyContext.state.catalogWriteAuth = authentication;
  return Boolean(authentication);
};

export {};
