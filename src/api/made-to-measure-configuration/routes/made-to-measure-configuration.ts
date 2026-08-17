/**
 * Admin-only made-to-measure configuration routes.
 *
 * Public configurator metadata continues to be served by the storefront
 * controller. Direct CRUD access is restricted to the catalog admin boundary.
 */

const { mutationPolicyConfig } = require('../../../catalog/catalog-mutation-surface');

const adminPolicy = mutationPolicyConfig('api::made-to-measure-configuration.made-to-measure-configuration');

export default {
  routes: [
    { method: 'GET', path: '/made-to-measure-configurations', handler: 'made-to-measure-configuration.find', config: adminPolicy },
    { method: 'GET', path: '/made-to-measure-configurations/:id', handler: 'made-to-measure-configuration.findOne', config: adminPolicy },
    { method: 'POST', path: '/made-to-measure-configurations', handler: 'made-to-measure-configuration.create', config: adminPolicy },
    { method: 'PUT', path: '/made-to-measure-configurations/:id', handler: 'made-to-measure-configuration.update', config: adminPolicy },
    { method: 'PATCH', path: '/made-to-measure-configurations/:id', handler: 'made-to-measure-configuration.update', config: adminPolicy },
    { method: 'DELETE', path: '/made-to-measure-configurations/:id', handler: 'made-to-measure-configuration.delete', config: adminPolicy },
  ],
};
