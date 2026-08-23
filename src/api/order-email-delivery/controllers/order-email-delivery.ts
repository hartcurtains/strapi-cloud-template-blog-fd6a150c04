import { retryOrderStatusEmails } from '../../../extensions/order-status-email';

export default {
  async retry(ctx) {
    const rawLimit = ctx.request.body?.limit;
    const limit = rawLimit === undefined ? 25 : Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      return ctx.badRequest('Limit must be an integer between 1 and 100');
    }

    try {
      const result = await retryOrderStatusEmails(strapi, { limit });
      return ctx.send({ result: 'completed', data: result });
    } catch {
      strapi.log.error('Order email retry worker failed');
      return ctx.internalServerError('Order email retry failed');
    }
  },
};
