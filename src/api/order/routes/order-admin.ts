export default {
  routes: [
    {
      method: 'POST',
      path: '/order-admin/transition',
      handler: 'order-admin.transition',
      config: { auth: false, policies: ['global::security-internal-auth'] },
    },
  ],
};
