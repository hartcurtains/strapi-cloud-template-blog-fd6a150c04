/**
 * mechanisation router
 */

import { factories } from '@strapi/strapi';
const { mutationPolicyConfig } = require('../../../catalog/catalog-mutation-surface');

export default {
  routes: [
    {
      method: 'GET',
      path: '/mechanisations',
      handler: 'mechanisation.find',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'GET',
      path: '/mechanisations/:id',
      handler: 'mechanisation.findOne',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'POST',
      path: '/mechanisations',
      handler: 'mechanisation.create',
      config: mutationPolicyConfig('api::mechanisation.mechanisation'),
    },
    {
      method: 'PUT',
      path: '/mechanisations/:id',
      handler: 'mechanisation.update',
      config: mutationPolicyConfig('api::mechanisation.mechanisation'),
    },
    {
      method: 'DELETE',
      path: '/mechanisations/:id',
      handler: 'mechanisation.delete',
      config: mutationPolicyConfig('api::mechanisation.mechanisation'),
    },
  ],
};
