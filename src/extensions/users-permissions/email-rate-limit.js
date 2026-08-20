'use strict';

const crypto = require('node:crypto');
const { errors } = require('@strapi/utils');
const { createSecurityStateStore } = require('../../api/security-state/services/security-state');

const { RateLimitError } = errors;

function hashKey(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function normalizedEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 320) : '';
}

function requestIp(ctx) {
  return String(ctx?.request?.ip || ctx?.ip || 'unknown').trim().slice(0, 128) || 'unknown';
}

function emailRateLimitChecks(ctx, email) {
  const recipient = normalizedEmail(email) || 'invalid-recipient';
  const ip = requestIp(ctx);
  return [
    ['email-global-minute', hashKey('email:global')],
    ['email-global-hour', hashKey('email:global')],
    ['email-global-day', hashKey('email:global')],
    ['email-ip-hour', hashKey(`email:ip:${ip}`)],
    ['email-recipient-hour', hashKey(`email:recipient:${recipient}`)],
    ['email-recipient-day', hashKey(`email:recipient:${recipient}`)],
  ];
}

async function enforceEmailRateLimits(strapi, ctx, email, storeOverride = null) {
  const store = storeOverride || strapi.emailRateLimitStore || createSecurityStateStore(strapi.db.connection);
  try {
    for (const [actionCategory, hashedKey] of emailRateLimitChecks(ctx, email)) {
      const result = await store.checkRateLimit({ actionCategory, hashedKey });
      if (!result?.allowed) {
        if (result?.retryAfter) ctx.set?.('Retry-After', String(result.retryAfter));
        throw new RateLimitError('Too many email requests. Please try again later.');
      }
    }
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    strapi.log.error('Email rate-limit persistence failed');
    throw new RateLimitError('Email service temporarily unavailable. Please try again later.');
  }
}

module.exports = {
  emailRateLimitChecks,
  enforceEmailRateLimits,
};
