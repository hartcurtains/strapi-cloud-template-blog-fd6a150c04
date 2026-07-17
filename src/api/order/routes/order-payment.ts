export default {
  routes: [
    {
      method: 'POST',
      path: '/order-payment/transition',
      handler: 'order-payment.transition',
      config: { auth: false, policies: ['global::stripe-webhook-lifecycle-auth'] },
    },
  ],
};
