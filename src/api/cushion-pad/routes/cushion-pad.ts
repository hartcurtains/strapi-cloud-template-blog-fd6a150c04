/**
 * cushion-pad router
 */

import { factories } from '@strapi/strapi';
const { mutationPolicyConfig } = require('../../../catalog/catalog-mutation-surface');

export default {
  routes: [
    {
      method: 'GET',
      path: '/cushion-pads',
      handler: 'cushion-pad.find',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/cushion-pads/:id',
      handler: 'cushion-pad.findOne',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/cushion-pads',
      handler: 'cushion-pad.create',
      config: mutationPolicyConfig('api::cushion-pad.cushion-pad'),
    },
    {
      method: 'PUT',
      path: '/cushion-pads/:id',
      handler: 'cushion-pad.update',
      config: mutationPolicyConfig('api::cushion-pad.cushion-pad'),
    },
    {
      method: 'DELETE',
      path: '/cushion-pads/:id',
      handler: 'cushion-pad.delete',
      config: mutationPolicyConfig('api::cushion-pad.cushion-pad'),
    },
  ],
};
