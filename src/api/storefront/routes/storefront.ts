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
