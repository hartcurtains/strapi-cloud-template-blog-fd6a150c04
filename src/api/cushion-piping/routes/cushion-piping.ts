/**
 * cushion-piping router
 */

import { factories } from '@strapi/strapi';

export default {
  routes: [
    {
      method: 'GET',
      path: '/cushion-piping-types',
      handler: 'cushion-piping.find',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/cushion-piping-types/:id',
      handler: 'cushion-piping.findOne',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/cushion-piping-types',
      handler: 'cushion-piping.create',
      config: {
        auth: false,
      },
    },
    {
      method: 'PUT',
      path: '/cushion-piping-types/:id',
      handler: 'cushion-piping.update',
      config: {
        auth: false,
      },
    },
    {
      method: 'DELETE',
      path: '/cushion-piping-types/:id',
      handler: 'cushion-piping.delete',
      config: {
        auth: false,
      },
    },
  ],
};
