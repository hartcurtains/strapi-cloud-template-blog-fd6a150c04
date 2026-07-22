/**
 * blind-type router
 */

import { factories } from '@strapi/strapi';
const { mutationPolicyConfig } = require('../../../catalog/catalog-mutation-surface');

export default {
  routes: [
    {
      method: 'GET',
      path: '/blind-types',
      handler: 'blind-type.find',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'GET',
      path: '/blind-types/:id',
      handler: 'blind-type.findOne',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'POST',
      path: '/blind-types',
      handler: 'blind-type.create',
      config: mutationPolicyConfig('api::blind-type.blind-type'),
    },
    {
      method: 'PUT',
      path: '/blind-types/:id',
      handler: 'blind-type.update',
      config: mutationPolicyConfig('api::blind-type.blind-type'),
    },
    {
      method: 'DELETE',
      path: '/blind-types/:id',
      handler: 'blind-type.delete',
      config: mutationPolicyConfig('api::blind-type.blind-type'),
    },
  ],
};
