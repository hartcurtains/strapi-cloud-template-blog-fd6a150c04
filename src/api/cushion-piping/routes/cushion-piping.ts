/**
 * cushion-piping router
 */

import { factories } from '@strapi/strapi';
const { mutationPolicyConfig } = require('../../../catalog/catalog-mutation-surface');

export default {
  routes: [
    {
      method: 'GET',
      path: '/cushion-piping-types',
      handler: 'cushion-piping.find',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/cushion-piping-types/:id',
      handler: 'cushion-piping.findOne',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/cushion-piping-types',
      handler: 'cushion-piping.create',
      config: mutationPolicyConfig('api::cushion-piping.cushion-piping'),
    },
    {
      method: 'PUT',
      path: '/cushion-piping-types/:id',
      handler: 'cushion-piping.update',
      config: mutationPolicyConfig('api::cushion-piping.cushion-piping'),
    },
    {
      method: 'DELETE',
      path: '/cushion-piping-types/:id',
      handler: 'cushion-piping.delete',
      config: mutationPolicyConfig('api::cushion-piping.cushion-piping'),
    },
  ],
};
