export default {
  routes: [
    {
      method: 'POST',
      path: '/order-email-delivery/retry',
      handler: 'order-email-delivery.retry',
      config: { auth: false, policies: ['global::security-internal-auth'] },
    },
  ],
};
