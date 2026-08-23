const { createCancellationStore } = require('../services/cancellation');
const { sendOrderStatusEmail } = require('../../../extensions/order-status-email');

const ORDER_NUMBER = /^[A-Za-z0-9._-]{1,128}$/;
const SESSION_ID = /^cs_(?:test_|live_)?[A-Za-z0-9_]{8,255}$/;

function validBody(body: any) {
  if (!body || !ORDER_NUMBER.test(body.orderNumber)) return false;
  const hasSession = typeof body.stripeSessionId === 'string';
  const hasOwner = body.ownerId !== undefined;
  if (hasSession === hasOwner) return false;
  if (hasSession) return SESSION_ID.test(body.stripeSessionId);
  return Number.isSafeInteger(body.ownerId) && body.ownerId > 0;
}

export default {
  async transition(ctx) {
    const body = ctx.request.body as any;
    if (!validBody(body)) return ctx.badRequest('Invalid cancellation request');

    try {
      const result = await createCancellationStore(strapi.db.connection).transition(body);
      if (result.result === 'cancelled') {
        const matches = await strapi.entityService.findMany('api::order.order', {
          filters: { orderNumber: { $eq: body.orderNumber } },
          limit: 1,
        });
        const order = Array.isArray(matches) ? matches[0] : null;
        if (order) await sendOrderStatusEmail(strapi, order, 'pending', 'cancelled');
      }
      return ctx.send(result);
    } catch {
      strapi.log.error('Atomic order cancellation failed');
      return ctx.internalServerError('Cancellation operation failed');
    }
  },
};
