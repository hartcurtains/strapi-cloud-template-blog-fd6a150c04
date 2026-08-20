const utils = require('@strapi/utils');
const { ApplicationError, ValidationError } = utils.errors;
const { enforceEmailRateLimits } = require('./email-rate-limit');
const {
  confirmEmail,
  sendConfirmationEmail,
} = require('./confirmation-email');
const { requestPasswordReset, resetPassword } = require('./password-reset-email');

module.exports = (plugin) => {
  const originalContentApiRoutes = plugin.routes['content-api'];
  plugin.routes['content-api'] = (strapiInstance) => {
    const generated = originalContentApiRoutes(strapiInstance);
    const routes = Array.isArray(generated) ? generated : generated?.routes;
    if (!Array.isArray(routes)) return generated;

    const patchedRoutes = routes.map((route) => {
      if (route.path !== '/auth/email-confirmation') return route;
      return {
        ...route,
        method: 'POST',
        config: {
          ...route.config,
          middlewares: ['plugin::users-permissions.rateLimit'],
        },
      };
    });

    // Strapi 4 factories returned the route array directly. Strapi 5 wraps
    // it in a content-api descriptor, so preserve that descriptor for route
    // registration while keeping compatibility with either shape.
    return Array.isArray(generated)
      ? patchedRoutes
      : { ...generated, routes: patchedRoutes };
  };

  const originalUserService = plugin.services.user;
  plugin.services.user = ({ strapi: strapiInstance }) => ({
    ...originalUserService({ strapi: strapiInstance }),
    sendConfirmationEmail: (user) => sendConfirmationEmail(strapiInstance, user),
  });

  // The auth controller is a factory in Strapi v5. Wrap the factory so the
  // registration override is actually installed on the instantiated
  // controller rather than on the factory function itself.
  const originalAuthController = plugin.controllers.auth;
  plugin.controllers.auth = ({ strapi: strapiInstance }) => {
    const controller = originalAuthController({ strapi: strapiInstance });

    return {
      ...controller,
      register: async (ctx) => {
        const body = ctx.request.body || {};
        const forbiddenFields = [
          'role', 'roles', 'confirmed', 'blocked', 'provider',
          'confirmationToken', 'confirmationTokenExpiresAt', 'resetPasswordToken',
        ];
        const attemptedFields = forbiddenFields.filter((field) =>
          Object.prototype.hasOwnProperty.call(body, field)
        );
        if (attemptedFields.length > 0) {
          strapiInstance.log.warn('Rejected privileged fields in a registration request');
          throw new ApplicationError('Privileged account fields cannot be set during registration');
        }

        if (body.gdprConsent !== true || body.termsAccepted !== true) {
          throw new ValidationError('Privacy and terms consent are required');
        }

        const firstNameSource = body.firstname ?? body.first_name;
        const lastNameSource = body.lastname ?? body.last_name;
        const firstName = typeof firstNameSource === 'string' ? firstNameSource.trim() : '';
        const lastName = typeof lastNameSource === 'string' ? lastNameSource.trim() : '';
        if (!firstName || !lastName) {
          throw new ValidationError('First name and last name are required');
        }

        await enforceEmailRateLimits(strapiInstance, ctx, body.email);

        const consentedAt = new Date().toISOString();
        ctx.request.body = {
          username: body.username,
          email: typeof body.email === 'string' ? body.email.trim().toLowerCase() : body.email,
          password: body.password,
          title: body.title || null,
          firstname: firstName,
          lastname: lastName,
          gdprConsent: true,
          gdprConsentDate: consentedAt,
          termsAccepted: true,
          termsAcceptedDate: consentedAt,
        };

        // Delegate account creation, duplicate checks, role assignment,
        // confirmation-token generation, email delivery and response
        // sanitization to Strapi's maintained controller.
        return controller.register(ctx);
      },
      forgotPassword: async (ctx) => {
        await enforceEmailRateLimits(strapiInstance, ctx, ctx.request.body?.email);
        return requestPasswordReset(ctx, strapiInstance);
      },
      resetPassword: async (ctx) => resetPassword(ctx, strapiInstance),
      emailConfirmation: async (ctx) => confirmEmail(ctx, strapiInstance),
      sendEmailConfirmation: async (ctx) => {
        await enforceEmailRateLimits(strapiInstance, ctx, ctx.request.body?.email);
        const email = typeof ctx.request.body?.email === 'string'
          ? ctx.request.body.email.trim().toLowerCase()
          : '';
        if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new ValidationError('A valid email address is required');
        }
        const user = await strapiInstance.db.query('plugin::users-permissions.user').findOne({
          where: { email },
        });
        if (user && user.confirmed !== true && user.blocked !== true) {
          await sendConfirmationEmail(strapiInstance, user);
        }
        // Do not disclose whether an address exists, is blocked or is already confirmed.
        return ctx.send({ sent: true });
      },
    };
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
    delete updateData.resetPasswordTokenExpiresAt;
    delete updateData.confirmationToken;
    delete updateData.confirmationTokenExpiresAt;

    const user = await strapi.entityService.update("plugin::users-permissions.user", id, {
      data: updateData,
    });

    return user;
  };

  return plugin;
};
