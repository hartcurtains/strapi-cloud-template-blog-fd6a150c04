/**
 * order controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController("api::order.order", ({ strapi }) => ({
  async find(ctx) {
    try {
      return await super.find(ctx);
    } catch (error) {
      console.error('Error fetching orders:', error);
      return ctx.internalServerError("Failed to fetch orders");
    }
  },

  async findOne(ctx) {
    try {
      return await super.findOne(ctx);
    } catch (error) {
      console.error('Error fetching order:', error);
      return ctx.internalServerError("Failed to fetch order");
    }
  },

  async create(ctx) {
    try {
      const { body } = ctx.request;
      const submitted = body?.data || body;
      if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) {
        return ctx.badRequest('Invalid order data');
      }

      const protectedFields = ['paymentStatus', 'stripeCustomerId', 'stripeSessionId'];
      if (protectedFields.some((field) => submitted[field] !== undefined)) {
        return ctx.badRequest('Protected order fields cannot be set during creation');
      }
      if (submitted.statusOrder !== undefined && submitted.statusOrder !== 'pending') {
        return ctx.badRequest('Orders must be created in pending state');
      }

      const allowedFields = [
        'orderNumber', 'customerName', 'customerEmail', 'customerPhone',
        'shippingAddress', 'postcode', 'billingAddress', 'subtotal',
        'shipping', 'total', 'notes', 'orderItems', 'user'
      ];
      const orderData = Object.fromEntries(
        allowedFields
          .filter((field) => submitted[field] !== undefined)
          .map((field) => [field, submitted[field]])
      );
      orderData.statusOrder = 'pending';
      orderData.paymentStatus = 'pending';

      const order = await strapi.entityService.create('api::order.order', { data: orderData as any });
      return ctx.send({ data: order });
    } catch (error) {
      console.error('❌ Order Controller - Error creating order:', error);
      console.error('❌ Order Controller - Error details:', error.message);
      console.error('❌ Order Controller - Error stack:', error.stack);
      return ctx.internalServerError("Failed to create order");
    }
  },

  async update(ctx) {
    try {
      const { id } = ctx.params;
      const { body } = ctx.request;
      const submitted = body?.data || body;
      const allowedFields = ['notes'];
      const updateData = Object.fromEntries(
        allowedFields
          .filter((field) => submitted?.[field] !== undefined)
          .map((field) => [field, submitted[field]])
      );
      if (submitted?.statusOrder !== undefined || submitted?.paymentStatus !== undefined ||
        submitted?.stripeCustomerId !== undefined || submitted?.stripeSessionId !== undefined) {
        return ctx.badRequest('Payment and workflow fields require a protected transition');
      }
      if (Object.keys(updateData).length === 0) return ctx.badRequest('No allowed order fields to update');

      const order = await strapi.entityService.update('api::order.order', id, { data: updateData });
      return ctx.send({ data: order });
    } catch (error) {
      console.error('❌ Order Controller - Error updating order:', error);
      console.error('❌ Order Controller - Error details:', error.message);
      return ctx.internalServerError("Failed to update order");
    }
  },

}));
