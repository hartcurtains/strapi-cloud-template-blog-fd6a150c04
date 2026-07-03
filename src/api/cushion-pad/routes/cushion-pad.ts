/**
 * cushion-pad router
 */

import { factories } from '@strapi/strapi';

export default {
  routes: [
    {
      method: 'GET',
      path: '/cushion-pads',
      handler: 'cushion-pad.find',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/cushion-pads/:id',
      handler: 'cushion-pad.findOne',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/cushion-pads',
      handler: 'cushion-pad.create',
      config: {
        auth: false,
      },
    },
    {
      method: 'PUT',
      path: '/cushion-pads/:id',
      handler: 'cushion-pad.update',
      config: {
        auth: false,
      },
    },
    {
      method: 'DELETE',
      path: '/cushion-pads/:id',
      handler: 'cushion-pad.delete',
      config: {
        auth: false,
      },
    },
  ],
};
