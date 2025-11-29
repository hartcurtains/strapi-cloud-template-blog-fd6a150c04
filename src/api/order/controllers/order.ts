/**
 * order controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController("api::order.order", ({ strapi }) => ({
  async find(ctx) {
    console.log('🔍 Order Controller - Role-based access control (LOOSE MODE)');
    
    try {
      // Get user info from request headers (passed by Next.js API)
      const userIdHeader = ctx.request.header['x-user-id'];
      const userRole = ctx.request.header['x-user-role'];
      const isAdmin = ctx.request.header['x-is-admin'] === 'true';
      
      // Handle userId as string or string array
      const userId = Array.isArray(userIdHeader) ? userIdHeader[0] : userIdHeader;
      
      console.log('🔍 Order Controller - User ID:', userId);
      console.log('🔍 Order Controller - User Role:', userRole);
      console.log('🔍 Order Controller - Is Admin:', isAdmin);
      
      let whereClause = {};
      
      // LOOSE MODE: Allow all requests, but still apply filtering if user info is available
      if (isAdmin) {
        // Admin users can see all orders
        whereClause = {};
        console.log('🔍 Order Controller - Admin access: returning all orders');
      } else if (userId) {
        // Regular users can only see their own orders
        whereClause = { user: { id: parseInt(userId) } };
        console.log(`🔍 Order Controller - User access: returning orders for user ${userId}`);
      } else {
        // LOOSE MODE: No user info provided - allow access but return all orders
        console.log('🔍 Order Controller - No user info provided - allowing access (loose mode)');
        whereClause = {};
      }
      
      // Fetch orders with appropriate filtering
      const orders = await strapi.entityService.findMany("api::order.order", {
        where: whereClause,
        populate: {
          
        },
        sort: { createdAt: 'desc' },
      });
      
      console.log(`Found ${orders.length} orders for ${isAdmin ? 'admin' : `user ${userId || 'guest'}`}`);
      return ctx.send({ data: orders });
    } catch (error) {
      console.error('Error fetching orders:', error);
      return ctx.internalServerError("Failed to fetch orders");
    }
  },

  async findOne(ctx) {
    console.log('🔍 Order Controller - Finding single order');
    
    try {
      const { id } = ctx.params;
      const order = await strapi.entityService.findOne("api::order.order", id, {
        populate: {
          
        },
      });
      
      if (!order) {
        return ctx.notFound("Order not found");
      }
      
      return ctx.send({ data: order });
    } catch (error) {
      console.error('Error fetching order:', error);
      return ctx.internalServerError("Failed to fetch order");
    }
  },

  async create(ctx) {
    console.log('🔍 Order Controller - Creating new order (LOOSE MODE)');
    console.log('🔍 Order Controller - Request body:', JSON.stringify(ctx.request.body, null, 2));
    
    try {
      const { body } = ctx.request;
      console.log('📝 Incoming body:', JSON.stringify(body, null, 2));

      // Ensure data wrapper - Strapi expects { data: {...} } structure
      const orderData = body.data || body;
      console.log('📝 Processed orderData:', JSON.stringify(orderData, null, 2));
      
      // LOOSE MODE: Allow all order creation requests
      console.log('🔍 Order Controller - Allowing order creation (loose mode)');
      
      const order = await strapi.entityService.create("api::order.order", {
        data: orderData,
        populate: {
          
          // Removed blinds, curtains, cushions relations as they were deleted from schema
        },
      });
      
      console.log(`✅ Order Controller - Created order ${order.id}`);
      return ctx.send({ data: order });
    } catch (error) {
      console.error('❌ Order Controller - Error creating order:', error);
      console.error('❌ Order Controller - Error details:', error.message);
      console.error('❌ Order Controller - Error stack:', error.stack);
      return ctx.internalServerError("Failed to create order");
    }
  },

  async update(ctx) {
    console.log('🔍 Order Controller - Updating order');
    console.log('🔍 Order Controller - Request body:', JSON.stringify(ctx.request.body, null, 2));
    
    try {
      const { id } = ctx.params;
      const { body } = ctx.request;
      
      // Extract data from the request body (Strapi expects { data: {...} } structure)
      const updateData = body.data || body;
      console.log('🔍 Order Controller - Update data:', JSON.stringify(updateData, null, 2));
      
      const order = await strapi.entityService.update("api::order.order", id, {
        data: updateData,  // ✅ Now correctly passing just the data
        populate: {
          
        },
      });
      
      console.log(`✅ Order Controller - Updated order ${id}`);
      console.log('🔍 Order Controller - Updated order data:', JSON.stringify(order, null, 2));
      return ctx.send({ data: order });
    } catch (error) {
      console.error('❌ Order Controller - Error updating order:', error);
      console.error('❌ Order Controller - Error details:', error.message);
      return ctx.internalServerError("Failed to update order");
    }
  },

  async delete(ctx) {
    console.log('🔍 Order Controller - Deleting order');
    
    try {
      const { id } = ctx.params;
      
      await strapi.entityService.delete("api::order.order", id);
      
      console.log(`Deleted order ${id}`);
      return ctx.send({ data: { id } });
    } catch (error) {
      console.error('Error deleting order:', error);
      return ctx.internalServerError("Failed to delete order");
    }
  },
}));