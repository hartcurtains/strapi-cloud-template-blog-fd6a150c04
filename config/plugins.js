export default {
  'users-permissions': {
    config: {
      register: {
        allowedFields: [
          'title', 'firstname', 'lastname',
          'gdprConsent', 'gdprConsentDate', 'termsAccepted', 'termsAcceptedDate',
        ],
      },
    },
  },
  'order-management': {
    enabled: true,
    resolve: './src/plugins/order-management',
  },
};
