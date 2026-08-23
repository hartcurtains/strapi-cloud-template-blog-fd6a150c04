const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'cancelled'];
const STATUS_RANK: Record<string, number> = {
  pending: 0,
  processing: 1,
  shipped: 2,
  delivered: 3,
};

const ORDER_NUMBER = /^[A-Za-z0-9._-]{1,128}$/;
const { sendOrderStatusEmail } = require('../../../extensions/order-status-email');

function parseJson(value: unknown, fallback: any) {
  if (typeof value !== 'string') return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function applyDiscount(items: any[], discountPercent: number) {
  return items.map((item: any) => {
    const original = Number(item.total ?? item.totalPrice ?? item.lineTotal ?? item.price ?? 0);
    const discounted = roundMoney(original * (1 - discountPercent / 100));
    const quantity = Number(item.quantity ?? item.qty ?? 1) || 1;
    return {
      ...item,
      originalLineTotal: original,
      discountPercent,
      discountAmount: roundMoney(original - discounted),
      lineTotal: discounted,
      total: discounted,
      totalPrice: discounted,
      price: discounted,
      pricePerUnit: roundMoney(discounted / quantity),
      unitPrice: roundMoney(discounted / quantity),
    };
  });
}

export default {
  async transition(ctx) {
    const body = ctx.request.body as any;
    const orderNumber = typeof body?.orderNumber === 'string' ? body.orderNumber.trim() : '';
    const status = typeof body?.status === 'string' ? body.status.trim().toLowerCase() : '';
    const paymentStatus = body?.paymentStatus === undefined
      ? undefined
      : String(body.paymentStatus).trim().toLowerCase();

    if (!ORDER_NUMBER.test(orderNumber) || !ORDER_STATUSES.includes(status)) {
      return ctx.badRequest('Invalid order transition request');
    }
    if (paymentStatus !== undefined && !PAYMENT_STATUSES.includes(paymentStatus)) {
      return ctx.badRequest('Invalid payment status');
    }

    const discountPercent = body?.discountPercent === undefined
      ? undefined
      : Number(body.discountPercent);
    if (discountPercent !== undefined && (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 50)) {
      return ctx.badRequest('Discount must be between 0 and 50 percent');
    }

    try {
      const matches = await strapi.entityService.findMany('api::order.order', {
        filters: { orderNumber: { $eq: orderNumber } },
        limit: 1,
      });
      const order: any = Array.isArray(matches) ? matches[0] : null;
      if (!order) return ctx.notFound('Order not found');

      const currentStatus = String(order.statusOrder || 'pending').toLowerCase();
      const currentPayment = String(order.paymentStatus || 'pending').toLowerCase();
      if (currentStatus === 'cancelled' && status !== 'cancelled') {
        return ctx.badRequest('Cancelled orders cannot be progressed');
      }
      if (status !== 'cancelled' && status !== 'pending' &&
        STATUS_RANK[status] < (STATUS_RANK[currentStatus] ?? 0)) {
        return ctx.badRequest('Order status cannot move backwards');
      }

      const requestedPayment = paymentStatus || currentPayment;
      if (['processing', 'shipped', 'delivered'].includes(status) && requestedPayment !== 'paid') {
        return ctx.badRequest('Payment is required before progressing the order');
      }

      const updateData: Record<string, any> = { statusOrder: status };
      if (paymentStatus !== undefined) updateData.paymentStatus = paymentStatus;
      if (status === 'cancelled' && currentPayment !== 'paid' && paymentStatus === undefined) {
        updateData.paymentStatus = 'cancelled';
      }

      if (discountPercent !== undefined) {
        const originalSubtotal = Number(order.subtotal || order.total || 0);
        const shipping = Number(order.shipping || 0);
        const subtotal = roundMoney(originalSubtotal * (1 - discountPercent / 100));
        updateData.subtotal = subtotal;
        updateData.total = roundMoney(subtotal + shipping);
        const existingItems = parseJson(order.orderItems, []);
        if (Array.isArray(existingItems)) updateData.orderItems = applyDiscount(existingItems, discountPercent);

        const breakdown = parseJson(order.quote_breakdown, {}) || {};
        updateData.quote_breakdown = {
          ...breakdown,
          subtotal,
          shipping,
          total: updateData.total,
          adminDiscount: {
            percent: discountPercent,
            amount: roundMoney(originalSubtotal - subtotal),
          },
        };
      }

      const updated = await strapi.entityService.update('api::order.order', order.id, { data: updateData });
      await sendOrderStatusEmail(strapi, { ...order, ...updated }, currentStatus, status, ctx);
      return ctx.send({ result: 'transitioned', data: updated });
    } catch (error) {
      strapi.log.error('Protected admin order transition failed', error);
      return ctx.internalServerError('Order transition failed');
    }
  },
};
