import {
  ContactEmailValidationError,
  sendContactEmail,
} from '../services/contact-email';

const GENERIC_RATE_LIMIT_MESSAGE = 'Too many email requests. Please try again later.';

export default {
  async send(ctx: any) {
    try {
      const result = await sendContactEmail(strapi, ctx, ctx.request.body);
      ctx.set('Cache-Control', 'no-store');
      return ctx.send(result);
    } catch (error: any) {
      if (error instanceof ContactEmailValidationError) {
        return ctx.badRequest('Invalid contact request');
      }

      if (error?.name === 'RateLimitError') {
        const persistenceFailure = error?.message === 'Email service temporarily unavailable. Please try again later.';
        ctx.status = persistenceFailure ? 503 : 429;
        ctx.body = { error: persistenceFailure ? 'Contact service temporarily unavailable.' : GENERIC_RATE_LIMIT_MESSAGE };
        return;
      }

      strapi.log.error('Contact email request failed (details suppressed)');
      ctx.status = 500;
      ctx.body = { error: 'Unable to send contact message.' };
    }
  },
};
