'use strict';

const MAX_CONTACT_EMAIL_REQUEST_BYTES = 32 * 1024;
const LIMITED_PATHS = new Set([
  '/api/security-internal/contact-email',
  '/security-internal/contact-email',
]);

function isLimitedRequest(ctx: any): boolean {
  return String(ctx?.method || '').toUpperCase() === 'POST'
    && LIMITED_PATHS.has(String(ctx?.path || '').replace(/\/$/, ''));
}

const contactEmailPrebodyLimit = async (ctx: any, next: any) => {
  if (!isLimitedRequest(ctx)) return next();

  const contentType = String(ctx.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    ctx.status = 415;
    ctx.body = { error: 'JSON request body required' };
    return;
  }

  const rawContentLength = String(ctx.get('content-length') || '').trim();
  const contentLength = Number(rawContentLength);
  if (!/^\d+$/.test(rawContentLength) || !Number.isSafeInteger(contentLength)) {
    ctx.status = 411;
    ctx.body = { error: 'Content-Length required' };
    return;
  }

  if (contentLength > MAX_CONTACT_EMAIL_REQUEST_BYTES) {
    ctx.status = 413;
    ctx.body = { error: 'Request is too large' };
    return;
  }

  return next();
};

module.exports = () => contactEmailPrebodyLimit;
module.exports.handler = contactEmailPrebodyLimit;
module.exports.MAX_CONTACT_EMAIL_REQUEST_BYTES = MAX_CONTACT_EMAIL_REQUEST_BYTES;

export {};
