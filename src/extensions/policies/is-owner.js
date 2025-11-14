module.exports = async (ctx, next) => {
  const { id } = ctx.params; // from URL like /orders/:id
  const userId = ctx.state.user?.id; // comes from JWT

  if (!userId) {
    return ctx.unauthorized("You must be logged in");
  }

  // For orders, check ownership
  if (ctx.request.route.path.includes('/orders')) {
    const order = await strapi.db.query("api::order.order").findOne({
      where: { id, user: userId },
    });

    if (!order) {
      return ctx.unauthorized("You don't own this order");
    }
  }

  // For user profile updates, check self-ownership
  if (ctx.request.route.path.includes('/users')) {
    if (id !== userId.toString()) {
      return ctx.unauthorized("You can only update your own profile");
    }
  }

  return next();
};
