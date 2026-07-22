/**
 * lining router
 */

import { factories } from '@strapi/strapi';
const { mutationPolicyConfig } = require('../../../catalog/catalog-mutation-surface');

export default {
  routes: [
    {
      method: 'GET',
      path: '/linings',
      handler: 'lining.find',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'GET',
      path: '/linings/:id',
      handler: 'lining.findOne',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'POST',
      path: '/linings',
      handler: 'lining.create',
      config: mutationPolicyConfig('api::lining.lining'),
    },
    {
      method: 'PUT',
      path: '/linings/:id',
      handler: 'lining.update',
      config: mutationPolicyConfig('api::lining.lining'),
    },
    {
      method: 'DELETE',
      path: '/linings/:id',
      handler: 'lining.delete',
      config: mutationPolicyConfig('api::lining.lining'),
    },
  ],
};
