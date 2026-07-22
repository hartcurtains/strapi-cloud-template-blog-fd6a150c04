const { createAbandonmentStore } = require('../services/abandonment');

const ORDER_NUMBER = /^[A-Za-z0-9._-]{1,128}$/;

function validBody(body: any) {
  return Boolean(
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    Object.keys(body).length === 1 &&
    ORDER_NUMBER.test(body.orderNumber)
  );
}

export default {
  async transition(ctx) {
    const body = ctx.request.body as any;
    if (!validBody(body)) return ctx.badRequest('Invalid abandonment request');

    try {
      const result = await createAbandonmentStore(strapi.db.connection).transition({
        orderNumber: body.orderNumber,
      });
      return ctx.send(result);
    } catch {
      strapi.log.error('Atomic abandoned-payment transition failed');
      return ctx.internalServerError('Abandoned-payment transition failed');
    }
  },
};
