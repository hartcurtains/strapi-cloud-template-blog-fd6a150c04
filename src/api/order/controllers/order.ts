/**
 * order controller
 */

import { factories } from '@strapi/strapi';
import { calculateMadeToMeasureQuote, calculateOrderQuote, isAuthoritativeMadeToMeasureLine, isSampleLine, MadeToMeasureValidationError } from '../../storefront/services/made-to-measure';

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
      // Vercel creates orders with a full-access/custom Strapi API token. API
      // token auth intentionally does not populate ctx.state.user, so checking
      // only that field rejects every server-to-server checkout. Keep public
      // callers blocked: customer JWTs have a user credential but no API-token
      // credential, while Strapi still verifies the token's route permission.
      const auth = ctx.state.auth || {};
      const isApiTokenRequest = auth.strategy?.name === 'api-token' ||
        ['full-access', 'read-only', 'custom'].includes(auth.credentials?.type);
      if (!ctx.state.user?.id && !isApiTokenRequest) {
        return ctx.unauthorized('Sign-in is required before checkout.');
      }
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
      if (ctx.state.user?.id) orderData.user = ctx.state.user.id;
      else delete orderData.user;

      const orderItems = Array.isArray(orderData.orderItems) ? orderData.orderItems : [];
      const sampleItems = orderItems.filter(isSampleLine);
      const madeToMeasureItems = orderItems.filter(isAuthoritativeMadeToMeasureLine);
      const standardItems = orderItems.filter((item: any) =>
        !isSampleLine(item) && !isAuthoritativeMadeToMeasureLine(item)
      );
      const requiresCombinedQuote = sampleItems.length > 0 || standardItems.length > 0;
      if (requiresCombinedQuote) {
        // A mixed checkout is a single server quote: configured made-to-measure
        // products, ordinary fabric and samples are each re-priced from their
        // live records before the combined subtotal and total are persisted.
        const quote = await calculateOrderQuote(strapi, { items: orderItems, shipping: submitted.shipping });
        orderData.orderItems = quote.items;
        orderData.subtotal = quote.breakdown.subtotal;
        orderData.shipping = quote.breakdown.shipping;
        orderData.total = quote.breakdown.total;
        orderData.selected_options = quote.selectedOptions;
        orderData.quote_breakdown = quote.breakdown;
        orderData.sample_pricing_snapshot = quote.samplePricingSnapshot;
        orderData.pricing_version = quote.pricingVersion;
      }

      // New made-to-measure payloads opt into the authoritative calculator. Old
      // catalogue orders retain their existing orderItems/price shape and remain
      // readable without a backfill.
      if (madeToMeasureItems.length > 0 && !requiresCombinedQuote) {
        const quote = await calculateMadeToMeasureQuote(strapi, { items: madeToMeasureItems, shipping: submitted.shipping });
        orderData.subtotal = quote.breakdown.subtotal;
        orderData.shipping = quote.breakdown.delivery.total;
        orderData.total = quote.breakdown.total;
        orderData.selected_options = quote.items.map((item: any) => item.selectedOptions);
        orderData.quote_breakdown = quote.breakdown;
        orderData.pricing_version = quote.pricingVersion;
      }

      const order = await strapi.entityService.create('api::order.order', { data: orderData as any });
      return ctx.send({ data: order });
    } catch (error) {
      if (error instanceof MadeToMeasureValidationError) return ctx.badRequest({ error: error.message, details: error.issues });
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

      // Strapi v5 REST routes use documentId, while entityService.update
      // still expects the numeric record id. Resolve both forms so admin
      // notes updates work with the same identifier used by the UI.
      const numericId = Number(id);
      const existing = await strapi.db.query('api::order.order').findOne({
        where: Number.isInteger(numericId) && numericId > 0 ? { id: numericId } : { documentId: id },
        select: ['id'],
      });
      if (!existing) return ctx.notFound('Order not found');

      const order = await strapi.entityService.update('api::order.order', existing.id, { data: updateData });
      return ctx.send({ data: order });
    } catch (error) {
      console.error('❌ Order Controller - Error updating order:', error);
      console.error('❌ Order Controller - Error details:', error.message);
      return ctx.internalServerError("Failed to update order");
    }
  },

}));
