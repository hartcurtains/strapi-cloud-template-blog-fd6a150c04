export default {
  routes: [
    {
      method: 'GET',
      path: '/storefront/navigation',
      handler: 'storefront.navigation',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/storefront/catalogue-snapshot',
      handler: 'storefront.catalogueSnapshot',
      config: {
        // The browser never calls this route. Require the existing
        // server-to-server catalogue secret so the full aggregate cannot
        // be pulled anonymously. The controller/service projection still
        // removes pricing formulas and private relations.
        auth: false,
        policies: ['global::catalogue-snapshot-auth'],
      },
    },
    {
      method: 'GET',
      path: '/storefront/configurator-options',
      handler: 'storefront.configuratorOptions',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/storefront/made-to-measure/quote',
      handler: 'storefront.madeToMeasureQuote',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/storefront/samples/validate',
      handler: 'storefront.validateSamples',
      config: { auth: false },
    },
  ],
}
