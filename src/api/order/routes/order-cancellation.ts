export default {
  routes: [
    {
      method: 'POST',
      path: '/order-cancellation/transition',
      handler: 'order-cancellation.transition',
      config: { auth: false, policies: ['global::checkout-cancellation-auth'] },
    },
  ],
};
