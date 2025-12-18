export default ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
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
