/**
 * curtain-type router
 */

import { factories } from '@strapi/strapi';
const { mutationPolicyConfig } = require('../../../catalog/catalog-mutation-surface');

export default {
  routes: [
    {
      method: 'GET',
      path: '/curtain-types',
      handler: 'curtain-type.find',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'GET',
      path: '/curtain-types/:id',
      handler: 'curtain-type.findOne',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'POST',
      path: '/curtain-types',
      handler: 'curtain-type.create',
      config: mutationPolicyConfig('api::curtain-type.curtain-type'),
    },
    {
      method: 'PUT',
      path: '/curtain-types/:id',
      handler: 'curtain-type.update',
      config: mutationPolicyConfig('api::curtain-type.curtain-type'),
    },
    {
      method: 'DELETE',
      path: '/curtain-types/:id',
      handler: 'curtain-type.delete',
      config: mutationPolicyConfig('api::curtain-type.curtain-type'),
    },
  ],
};
