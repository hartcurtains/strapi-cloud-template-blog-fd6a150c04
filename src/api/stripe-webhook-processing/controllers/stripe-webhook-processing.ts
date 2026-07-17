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

export default factories.createCoreController('api::stripe-webhook-processing.stripe-webhook-processing' as any, ({ strapi }) => ({
  async claimEvent(ctx) {
    const body = ctx.request.body as any;
    if (!validEvent(body) || !Number.isInteger(body.leaseSeconds) || body.leaseSeconds < 30 || body.leaseSeconds > 900) {
      return ctx.badRequest('Invalid lifecycle request');
    }
    try {
      return ctx.send(await lifecycle(strapi).claimEvent(body));
    } catch (error) {
      strapi.log.error('Stripe webhook event claim failed');
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
