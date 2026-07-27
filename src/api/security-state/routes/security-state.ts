export default {
  routes: [
    {
      method: 'POST',
      path: '/security-internal/rate-limit/check',
      handler: 'security-state.rateLimitCheck',
      config: { auth: false, policies: ['global::security-internal-auth'] },
    },
    {
      method: 'POST',
      path: '/security-internal/account-deletion-challenge/create',
      handler: 'security-state.accountDeletionChallengeCreate',
      config: { auth: false, policies: ['global::security-internal-auth'] },
    },
    {
      method: 'POST',
      path: '/security-internal/account-deletion-challenge/verify',
      handler: 'security-state.accountDeletionChallengeVerify',
      config: { auth: false, policies: ['global::security-internal-auth'] },
    },
  ],
};
