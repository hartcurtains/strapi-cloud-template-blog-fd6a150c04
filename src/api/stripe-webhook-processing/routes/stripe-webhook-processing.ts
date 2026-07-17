export default {
  routes: [
    {
      method: 'POST',
      path: '/stripe-webhook-processing/claim-event',
      handler: 'stripe-webhook-processing.claimEvent',
      config: { auth: false, policies: ['global::stripe-webhook-lifecycle-auth'] },
    },
    {
      method: 'POST',
      path: '/stripe-webhook-processing/claim-order',
      handler: 'stripe-webhook-processing.claimOrder',
      config: { auth: false, policies: ['global::stripe-webhook-lifecycle-auth'] },
    },
    {
      method: 'POST',
      path: '/stripe-webhook-processing/complete',
      handler: 'stripe-webhook-processing.complete',
      config: { auth: false, policies: ['global::stripe-webhook-lifecycle-auth'] },
    },
    {
      method: 'POST',
      path: '/stripe-webhook-processing/release',
      handler: 'stripe-webhook-processing.release',
      config: { auth: false, policies: ['global::stripe-webhook-lifecycle-auth'] },
    },
  ],
};
