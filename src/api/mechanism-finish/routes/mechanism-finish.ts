/**
 * Admin-only mechanism finish routes.
 *
 * The storefront configurator has its own public, normalized read payload.
 * These direct content API routes are deliberately protected so they are only
 * available to the local admin service/API token or a Strapi admin JWT.
 */

const { mutationPolicyConfig } = require('../../../catalog/catalog-mutation-surface');

const adminPolicy = mutationPolicyConfig('api::mechanism-finish.mechanism-finish');

export default {
  routes: [
    { method: 'GET', path: '/mechanism-finishes', handler: 'mechanism-finish.find', config: adminPolicy },
    { method: 'GET', path: '/mechanism-finishes/:id', handler: 'mechanism-finish.findOne', config: adminPolicy },
    { method: 'POST', path: '/mechanism-finishes', handler: 'mechanism-finish.create', config: adminPolicy },
    { method: 'PUT', path: '/mechanism-finishes/:id', handler: 'mechanism-finish.update', config: adminPolicy },
    { method: 'PATCH', path: '/mechanism-finishes/:id', handler: 'mechanism-finish.update', config: adminPolicy },
    { method: 'DELETE', path: '/mechanism-finishes/:id', handler: 'mechanism-finish.delete', config: adminPolicy },
  ],
};
