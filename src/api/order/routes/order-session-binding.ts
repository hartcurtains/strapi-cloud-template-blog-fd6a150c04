export default {
  routes: [
    {
      method: 'POST',
      path: '/order-session-binding/bind',
      handler: 'order-session-binding.bind',
      config: { auth: false, policies: ['global::checkout-cancellation-auth'] },
    },
  ],
};
