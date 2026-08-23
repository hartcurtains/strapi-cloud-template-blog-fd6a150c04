const { createPaymentStore } = require('../services/payment');
const { sendOrderStatusEmail } = require('../../../extensions/order-status-email');

const ORDER_NUMBER = /^[A-Za-z0-9._-]{1,128}$/;

function validBody(body: any) {
  if (!body || !ORDER_NUMBER.test(body.orderNumber)) return false;
  if (body.stripeSessionId !== undefined && typeof body.stripeSessionId !== 'string') return false;
  if (body.stripeCustomerId !== undefined && typeof body.stripeCustomerId !== 'string') return false;
  return true;
}

export default {
  async transition(ctx) {
    const body = ctx.request.body as any;
    if (!validBody(body)) return ctx.badRequest('Invalid payment transition request');

    try {
      const result = await createPaymentStore(strapi.db.connection).transition(body);
      if (result.result === 'transitioned') {
        const matches = await strapi.entityService.findMany('api::order.order', {
          filters: { orderNumber: { $eq: body.orderNumber } },
          limit: 1,
        });
        const order = Array.isArray(matches) ? matches[0] : null;
        if (order) await sendOrderStatusEmail(strapi, order, 'pending', 'processing');
      }
      return ctx.send(result);
    } catch {
      strapi.log.error('Atomic order payment transition failed');
      return ctx.internalServerError('Payment transition failed');
    }
  },
};
