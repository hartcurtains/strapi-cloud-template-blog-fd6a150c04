export default {
  'users-permissions': {
    config: {
      register: {
        allowedFields: ['title', 'firstname', 'lastname'],
      },
    },
  },
  'order-management': {
    enabled: true,
    resolve: './src/plugins/order-management',
  },
};
