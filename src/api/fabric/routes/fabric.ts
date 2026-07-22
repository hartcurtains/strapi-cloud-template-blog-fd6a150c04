/**
 * fabric router
 */

import { factories } from '@strapi/strapi';
const { customMutationPolicyConfig, mutationPolicyConfig } = require('../../../catalog/catalog-mutation-surface');

export default {
  routes: [
    {
      method: 'GET',
      path: '/fabrics',
      handler: 'fabric.find',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'GET',
      path: '/fabrics/:id',
      handler: 'fabric.findOne',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'POST',
      path: '/fabrics',
      handler: 'fabric.create',
      config: mutationPolicyConfig('api::fabric.fabric'),
    },
    {
      method: 'PUT',
      path: '/fabrics/:id',
      handler: 'fabric.update',
      config: mutationPolicyConfig('api::fabric.fabric'),
    },
    {
      method: 'DELETE',
      path: '/fabrics/:id',
      handler: 'fabric.delete',
      config: mutationPolicyConfig('api::fabric.fabric'),
    },
    {
      method: 'POST',
      path: '/fabrics/import',
      handler: 'fabric.importFabrics',
      config: customMutationPolicyConfig(),
    },
  ],
};
