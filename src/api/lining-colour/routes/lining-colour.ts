/**
 * lining-colour router
 */

import { factories } from '@strapi/strapi'
const { mutationPolicyConfig } = require('../../../catalog/catalog-mutation-surface')

export default {
  routes: [
    {
      method: 'GET',
      path: '/lining-colours',
      handler: 'lining-colour.find',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/lining-colours/:id',
      handler: 'lining-colour.findOne',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/lining-colours',
      handler: 'lining-colour.create',
      config: mutationPolicyConfig('api::lining-colour.lining-colour'),
    },
    {
      method: 'PUT',
      path: '/lining-colours/:id',
      handler: 'lining-colour.update',
      config: mutationPolicyConfig('api::lining-colour.lining-colour'),
    },
    {
      method: 'DELETE',
      path: '/lining-colours/:id',
      handler: 'lining-colour.delete',
      config: mutationPolicyConfig('api::lining-colour.lining-colour'),
    },
  ],
}
