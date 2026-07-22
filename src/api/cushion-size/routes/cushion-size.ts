/**
 * cushion-size router
 */

import { factories } from '@strapi/strapi';
const { mutationPolicyConfig } = require('../../../catalog/catalog-mutation-surface');

export default {
  routes: [
    {
      method: 'GET',
      path: '/cushion-sizes',
      handler: 'cushion-size.find',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/cushion-sizes/:id',
      handler: 'cushion-size.findOne',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/cushion-sizes',
      handler: 'cushion-size.create',
      config: mutationPolicyConfig('api::cushion-size.cushion-size'),
    },
    {
      method: 'PUT',
      path: '/cushion-sizes/:id',
      handler: 'cushion-size.update',
      config: mutationPolicyConfig('api::cushion-size.cushion-size'),
    },
    {
      method: 'DELETE',
      path: '/cushion-sizes/:id',
      handler: 'cushion-size.delete',
      config: mutationPolicyConfig('api::cushion-size.cushion-size'),
    },
  ],
};
