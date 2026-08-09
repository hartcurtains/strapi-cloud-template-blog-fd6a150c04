/**
 * normalized-colour router
 *
 * The storefront needs read-only access to the canonical colour catalogue.
 * Writes remain available through the Strapi admin Content Manager rather
 * than being exposed through the public REST API.
 */

export default {
  routes: [
    {
      method: 'GET',
      path: '/normalized-colours',
      handler: 'normalized-colour.find',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/normalized-colours/:id',
      handler: 'normalized-colour.findOne',
      config: {
        auth: false,
      },
    },
  ],
}
