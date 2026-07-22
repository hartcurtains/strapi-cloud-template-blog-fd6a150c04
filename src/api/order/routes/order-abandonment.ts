export default {
  routes: [
    {
      method: 'POST',
      path: '/order-abandonment/transition',
      handler: 'order-abandonment.transition',
      config: { auth: false, policies: ['global::abandoned-payment-auth'] },
    },
  ],
};
