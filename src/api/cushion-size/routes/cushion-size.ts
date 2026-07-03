/**
 * cushion-size router
 */

import { factories } from '@strapi/strapi';

export default {
  routes: [
    {
      method: 'GET',
      path: '/cushion-sizes',
      handler: 'cushion-size.find',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/cushion-sizes/:id',
      handler: 'cushion-size.findOne',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/cushion-sizes',
      handler: 'cushion-size.create',
      config: {
        auth: false,
      },
    },
    {
      method: 'PUT',
      path: '/cushion-sizes/:id',
      handler: 'cushion-size.update',
      config: {
        auth: false,
      },
    },
    {
      method: 'DELETE',
      path: '/cushion-sizes/:id',
      handler: 'cushion-size.delete',
      config: {
        auth: false,
      },
    },
  ],
};
