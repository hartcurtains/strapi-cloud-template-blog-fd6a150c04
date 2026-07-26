import { factories } from '@strapi/strapi';

const { createLifecycleStore } = require('../services/lifecycle');

const EVENT_ID = /^evt_[A-Za-z0-9_]{1,250}$/;
const EVENT_TYPE = /^[a-z0-9_.]{1,100}$/;
const ORDER_NUMBER = /^[A-Za-z0-9._-]{1,128}$/;
const CLAIM_TOKEN = /^[0-9a-f-]{36}$/i;

function lifecycle(strapi) {
  return createLifecycleStore(strapi.db.connection);
}

function validEvent(body) {
  return body && EVENT_ID.test(body.eventId) && (!body.eventType || EVENT_TYPE.test(body.eventType));
}

function sanitiseErrorMessage(value: unknown) {
  if (typeof value !== 'string') return 'Unknown database error';
  return value
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:evt|cs|cus|pi|tok|whsec|sk|pk)_[A-Za-z0-9_]+\b/gi, '[redacted-id]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[redacted-uuid]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/'[^']*'/g, "'[redacted-value]'")
    .slice(0, 500);
}

function sanitisedDatabaseError(error: unknown) {
  const source = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  return {
    name: typeof source.name === 'string' ? source.name.slice(0, 100) : 'Error',
    message: sanitiseErrorMessage(source.message),
    code: typeof source.code === 'string' || typeof source.code === 'number'
      ? String(source.code).slice(0, 50)
      : undefined,
  };
}

export default factories.createCoreController('api::stripe-webhook-processing.stripe-webhook-processing' as any, ({ strapi }) => ({
  async claimEvent(ctx) {
    const body = ctx.request.body as any;
    if (!validEvent(body) || !Number.isInteger(body.leaseSeconds) || body.leaseSeconds < 30 || body.leaseSeconds > 900) {
      return ctx.badRequest('Invalid lifecycle request');
    }
    try {
      return ctx.send(await lifecycle(strapi).claimEvent(body));
    } catch (error) {
      strapi.log.error('Stripe webhook event claim failed', sanitisedDatabaseError(error));
      return ctx.internalServerError('Lifecycle operation failed');
    }
  },

  async claimOrder(ctx) {
    const body = ctx.request.body as any;
    if (!validEvent(body) || !ORDER_NUMBER.test(body.orderNumber) || !CLAIM_TOKEN.test(body.claimToken)) {
      return ctx.badRequest('Invalid lifecycle request');
    }
    try {
      return ctx.send(await lifecycle(strapi).claimOrder(body));
    } catch (error) {
      strapi.log.error('Stripe webhook order claim failed');
      return ctx.internalServerError('Lifecycle operation failed');
    }
  },

  async complete(ctx) {
    const body = ctx.request.body as any;
    if (!validEvent(body) || !CLAIM_TOKEN.test(body.claimToken)) {
      return ctx.badRequest('Invalid lifecycle request');
    }
    try {
      return ctx.send(await lifecycle(strapi).complete(body));
    } catch (error) {
      strapi.log.error('Stripe webhook completion failed');
      return ctx.internalServerError('Lifecycle operation failed');
    }
  },

  async markReconciliationRequired(ctx) {
    const body = ctx.request.body as any;
    if (!validEvent(body) || !CLAIM_TOKEN.test(body.claimToken)) {
      return ctx.badRequest('Invalid lifecycle request');
    }
    try {
      return ctx.send(await lifecycle(strapi).markReconciliationRequired(body));
    } catch (error) {
      strapi.log.error('Stripe webhook reconciliation marking failed');
      return ctx.internalServerError('Lifecycle operation failed');
    }
  },

  async release(ctx) {
    const body = ctx.request.body as any;
    if (!validEvent(body) || !CLAIM_TOKEN.test(body.claimToken)) {
      return ctx.badRequest('Invalid lifecycle request');
    }
    try {
      return ctx.send(await lifecycle(strapi).release(body));
    } catch (error) {
      strapi.log.error('Stripe webhook release failed');
      return ctx.internalServerError('Lifecycle operation failed');
    }
  },
}));
