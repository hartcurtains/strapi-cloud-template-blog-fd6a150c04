const { createSessionBindingStore } = require('../services/session-binding');

const ORDER_NUMBER = /^[A-Za-z0-9._-]{1,128}$/;
const SESSION_ID = /^cs_(?:test_|live_)?[A-Za-z0-9_]{8,255}$/;

export default {
  async bind(ctx) {
    const body = ctx.request.body as any;
    if (!body || !ORDER_NUMBER.test(body.orderNumber) || !SESSION_ID.test(body.stripeSessionId)) {
      return ctx.badRequest('Invalid session binding request');
    }

    try {
      return ctx.send(await createSessionBindingStore(strapi.db.connection).bind(body));
    } catch {
      strapi.log.error('Atomic checkout session binding failed');
      return ctx.internalServerError('Session binding operation failed');
    }
  },
};
