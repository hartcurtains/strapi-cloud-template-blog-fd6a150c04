/**
 * cushion-type router
 */

import { factories } from '@strapi/strapi';
const { mutationPolicyConfig } = require('../../../catalog/catalog-mutation-surface');

export default {
  routes: [
    {
      method: 'GET',
      path: '/cushion-types',
      handler: 'cushion-type.find',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'GET',
      path: '/cushion-types/:id',
      handler: 'cushion-type.findOne',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'POST',
      path: '/cushion-types',
      handler: 'cushion-type.create',
      config: mutationPolicyConfig('api::cushion-type.cushion-type'),
    },
    {
      method: 'PUT',
      path: '/cushion-types/:id',
      handler: 'cushion-type.update',
      config: mutationPolicyConfig('api::cushion-type.cushion-type'),
    },
    {
      method: 'DELETE',
      path: '/cushion-types/:id',
      handler: 'cushion-type.delete',
      config: mutationPolicyConfig('api::cushion-type.cushion-type'),
    },
  ],
};
