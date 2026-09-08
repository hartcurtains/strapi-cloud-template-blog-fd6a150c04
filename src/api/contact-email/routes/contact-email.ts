export default {
  routes: [
    {
      method: 'POST',
      path: '/security-internal/contact-email',
      handler: 'contact-email.send',
      config: { auth: false, policies: ['global::security-internal-auth'] },
    },
  ],
};
