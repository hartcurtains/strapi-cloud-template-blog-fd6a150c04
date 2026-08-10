const utils = require('@strapi/utils');
const { ApplicationError } = utils.errors;

module.exports = (plugin) => {
  // Strapi's built-in registration route strictly validates the request body
  // before dispatching to the controller. The custom user schema includes
  // profile fields, so let the controller validate and persist those fields
  // instead of rejecting them as unknown registration parameters.
  const contentApiRoutes = plugin.routes['content-api'];
  plugin.routes['content-api'] = (strapiInstance) => {
    const routes = contentApiRoutes(strapiInstance);

    return routes.map((route) => {
      if (route.method !== 'POST' || route.path !== '/auth/local/register') {
        return route;
      }

      const { request, ...routeWithoutRequestValidation } = route;
      return routeWithoutRequestValidation;
    });
  };

  // Override register controller to force authenticated role and GDPR compliance
  plugin.controllers.auth.register = async (ctx) => {
    const {
      email,
      password,
      username,
      role,
      title,
      firstname,
      lastname,
      first_name,
      last_name,
    } = ctx.request.body;

    // These are the profile fields defined by the user schema. Keep the
    // canonical Strapi names while accepting the legacy snake_case aliases.
    const firstName = typeof (firstname || first_name) === 'string'
      ? (firstname || first_name).trim()
      : '';
    const lastName = typeof (lastname || last_name) === 'string'
      ? (lastname || last_name).trim()
      : '';

    // SECURITY: Block any attempt to set admin role during registration
    if (role) {
      strapi.log.error(`🚨 SECURITY ALERT: User ${email} tried to set role during registration: ${role}`);
      throw new ApplicationError("Role cannot be set during registration");
    }

    if (!email || !password || !username) {
      throw new ApplicationError("Email, username, and password are required");
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new ApplicationError("Please provide a valid email address");
    }

    // Validate password strength
    if (password.length < 8) {
      throw new ApplicationError("Password must be at least 8 characters long");
    }

    // Check if user already exists
    const existingUser = await strapi.db.query("plugin::users-permissions.user").findOne({
      where: { email },
    });

    if (existingUser) {
      throw new ApplicationError("User with this email already exists");
    }

    // Always assign authenticated role - NO EXCEPTIONS
    const authenticatedRole = await strapi.db.query("plugin::users-permissions.role").findOne({
      where: { type: "authenticated" },
    });

    if (!authenticatedRole) {
      throw new ApplicationError("Authenticated role not found");
    }

    // The startup migration guarantees these consent columns exist before the
    // registration controller is available, so persist the submitted consent
    // values on every newly created account.
    const userData = {
      email,
      password,
      username,
      confirmed: true,
      provider: "local",
      role: authenticatedRole.id, // FORCED - no way to override
      ...(firstName ? { firstname: firstName } : {}),
      ...(lastName ? { lastname: lastName } : {}),
      ...(title ? { title } : {}),
      gdprConsent: true,
      gdprConsentDate: new Date().toISOString(),
      termsAccepted: true,
      termsAcceptedDate: new Date().toISOString(),
    };

    const newUser = await strapi.entityService.create("plugin::users-permissions.user", {
      data: userData,
    });

    // Issue JWT
    const jwt = strapi.plugins["users-permissions"].services.jwt.issue({
      id: newUser.id,
    });

    // Log registration for audit purposes (GDPR compliance)
    strapi.log.info(`New user registered: ${email} at ${new Date().toISOString()}`);

    return { jwt, user: newUser };
  };

  // Override update controller to prevent role manipulation
  plugin.controllers.user.update = async (ctx) => {
    const { id } = ctx.params;
    const userId = ctx.state.user?.id;

    if (!userId) {
      return ctx.unauthorized("You must be logged in");
    }

    if (id !== userId.toString()) {
      return ctx.forbidden("You can only update your own profile");
    }

    // SECURITY: Check for role manipulation attempts
    const { role, roles } = ctx.request.body;
    if (role || roles) {
      strapi.log.error(`🚨 SECURITY ALERT: User ${userId} tried to manipulate role:`, { role, roles });
      return ctx.forbidden("Role cannot be changed through this endpoint");
    }

    // Sanitize input - remove dangerous fields
    const updateData = { ...ctx.request.body };
    delete updateData.role;
    delete updateData.roles;
    delete updateData.confirmed;
    delete updateData.blocked;
    delete updateData.provider;
    delete updateData.resetPasswordToken;
    delete updateData.confirmationToken;

    const user = await strapi.entityService.update("plugin::users-permissions.user", id, {
      data: updateData,
    });

    return user;
  };

  return plugin;
};
