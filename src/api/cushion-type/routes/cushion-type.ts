/**
 * cushion-type router
 */

import { factories } from '@strapi/strapi';

export default {
  routes: [
    {
      method: 'GET',
      path: '/cushion-types',
      handler: 'cushion-type.find',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'GET',
      path: '/cushion-types/:id',
      handler: 'cushion-type.findOne',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'POST',
      path: '/cushion-types',
      handler: 'cushion-type.create',
      config: {
        auth: false, // Allow admin access for creating
      },
    },
    {
      method: 'PUT',
      path: '/cushion-types/:id',
      handler: 'cushion-type.update',
      config: {
        auth: false, // Allow admin access for updating
      },
    },
    {
      method: 'DELETE',
      path: '/cushion-types/:id',
      handler: 'cushion-type.delete',
      config: {
        auth: false, // Allow admin access for deleting
      },
    },
  ],
};
