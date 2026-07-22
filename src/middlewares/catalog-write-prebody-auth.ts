'use strict';

const { authenticateCatalogWrite: authenticateCatalogWritePrebody } = require('../auth/catalog-write-auth');
const { matchCatalogMutation } = require('../catalog/catalog-mutation-surface');

function isSensitive(ctx: any): boolean {
  return Boolean(matchCatalogMutation(ctx.method, ctx.path));
}

const catalogWritePrebodyAuth = async (ctx: any, next: any) => {
  const mutation = matchCatalogMutation(ctx.method, ctx.path);
  if (!mutation) return next();

  const authentication = await authenticateCatalogWritePrebody(ctx);
  if (!authentication) {
    ctx.status = 401;
    ctx.body = { error: 'Unauthorized' };
    return;
  }

  ctx.state.catalogWriteAuth = authentication;
  try {
    return await next();
  } catch (error: any) {
    // Strapi's body middleware does not preserve Formidable's HTTP status. Keep
    // authenticated catalog uploads fail-closed with the expected 413 response.
    if (mutation.operation === 'bulk-image-upload' && error?.httpCode === 413) {
      ctx.status = 413;
      ctx.body = { error: 'Upload limit exceeded' };
      return;
    }
    throw error;
  }
};

module.exports = () => catalogWritePrebodyAuth;
module.exports.handler = catalogWritePrebodyAuth;
module.exports.isSensitive = isSensitive;
