/**
 * trimming router
 */

import { factories } from '@strapi/strapi';
const { mutationPolicyConfig } = require('../../../catalog/catalog-mutation-surface');

export default {
  routes: [
    {
      method: 'GET',
      path: '/trimmings',
      handler: 'trimming.find',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'GET',
      path: '/trimmings/:id',
      handler: 'trimming.findOne',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'POST',
      path: '/trimmings',
      handler: 'trimming.create',
      config: mutationPolicyConfig('api::trimming.trimming'),
    },
    {
      method: 'PUT',
      path: '/trimmings/:id',
      handler: 'trimming.update',
      config: mutationPolicyConfig('api::trimming.trimming'),
    },
    {
      method: 'DELETE',
      path: '/trimmings/:id',
      handler: 'trimming.delete',
      config: mutationPolicyConfig('api::trimming.trimming'),
    },
  ],
};
