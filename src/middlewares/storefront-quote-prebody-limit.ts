'use strict';

const MAX_STOREFRONT_REQUEST_BYTES = 256 * 1024;
const LIMITED_PATHS = new Set([
  '/api/storefront/made-to-measure/quote',
  '/storefront/made-to-measure/quote',
  '/api/storefront/samples/validate',
  '/storefront/samples/validate',
]);

function isLimitedRequest(ctx: any): boolean {
  return String(ctx?.method || '').toUpperCase() === 'POST'
    && LIMITED_PATHS.has(String(ctx?.path || '').replace(/\/$/, ''));
}

const storefrontQuotePrebodyLimit = async (ctx: any, next: any) => {
  if (!isLimitedRequest(ctx)) return next();

  const contentType = String(ctx.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    ctx.status = 415;
    ctx.body = { error: 'JSON request body required' };
    return;
  }

  const rawContentLength = String(ctx.get('content-length') || '').trim();
  const contentLength = Number(rawContentLength);
  // The Next.js server proxy sends a fixed JSON body. Requiring a declared
  // length prevents chunked requests from bypassing the pre-parser boundary.
  if (!/^\d+$/.test(rawContentLength) || !Number.isSafeInteger(contentLength)) {
    ctx.status = 411;
    ctx.body = { error: 'Content-Length required' };
    return;
  }

  if (contentLength > MAX_STOREFRONT_REQUEST_BYTES) {
    ctx.status = 413;
    ctx.body = { error: 'Request is too large' };
    return;
  }

  return next();
};

module.exports = () => storefrontQuotePrebodyLimit;
module.exports.handler = storefrontQuotePrebodyLimit;
module.exports.MAX_STOREFRONT_REQUEST_BYTES = MAX_STOREFRONT_REQUEST_BYTES;

export {};
