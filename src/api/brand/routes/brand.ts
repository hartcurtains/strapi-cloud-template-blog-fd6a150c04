/**
 * brand router
 */

import { factories } from '@strapi/strapi';
const { mutationPolicyConfig } = require('../../../catalog/catalog-mutation-surface');

export default {
  routes: [
    {
      method: 'GET',
      path: '/brands',
      handler: 'brand.find',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'GET',
      path: '/brands/:id',
      handler: 'brand.findOne',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'POST',
      path: '/brands',
      handler: 'brand.create',
      config: mutationPolicyConfig('api::brand.brand'),
    },
    {
      method: 'PUT',
      path: '/brands/:id',
      handler: 'brand.update',
      config: mutationPolicyConfig('api::brand.brand'),
    },
    {
      method: 'DELETE',
      path: '/brands/:id',
      handler: 'brand.delete',
      config: mutationPolicyConfig('api::brand.brand'),
    },
  ],
};
