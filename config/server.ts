export default ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('PUBLIC_URL', 'http://localhost:1337'),
  // Retry durable order-status email intents in-process.  The worker is
  // deliberately small and rate-limited by the same persistent email budget
  // used by request-driven mail, so a transient provider failure cannot lose
  // a paid-order notification or create an unbounded send loop.
  cron: {
    enabled: env.bool('ORDER_EMAIL_RETRY_CRON_ENABLED', true),
    tasks: {
      orderEmailDelivery: {
        task: async ({ strapi }) => {
          try {
            const { retryOrderStatusEmails } = require('../src/extensions/order-status-email');
            const result = await retryOrderStatusEmails(strapi, { limit: 25 });
            if (result.sent || result.failed) {
              strapi.log.info(`Order email retry worker: sent=${result.sent} failed=${result.failed} scanned=${result.scanned}`);
            }
          } catch {
            strapi.log.error('Order email retry worker failed');
          }
        },
        options: { rule: '* * * * *' },
      },
    },
  },
  app: {
    keys: env.array('APP_KEYS'),
  },
  http: {
    serverOptions: {
      // 10 minutes timeout for long transfers/uploads
      requestTimeout: 10 * 60 * 1000,
    },
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT'),
    },
    remote: {
      enabled: true, // Enable data transfer
    },
  },
});
