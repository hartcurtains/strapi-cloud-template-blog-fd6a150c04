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
        // The browser never calls this route. Require a server-side Strapi
        // API token so the full aggregate cannot be pulled anonymously;
        // pricing formulas and private relations are still removed by the
        // controller/service projection.
        auth: true,
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
