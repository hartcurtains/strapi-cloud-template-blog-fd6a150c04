/**
 * lining router
 */

import { factories } from '@strapi/strapi';

export default {
  routes: [
    {
      method: 'GET',
      path: '/linings',
      handler: 'lining.find',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'GET',
      path: '/linings/:id',
      handler: 'lining.findOne',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'POST',
      path: '/linings',
      handler: 'lining.create',
      config: {
        auth: false, // Allow admin access for creating
      },
    },
    {
      method: 'PUT',
      path: '/linings/:id',
      handler: 'lining.update',
      config: {
        auth: false, // Allow admin access for updating
      },
    },
    {
      method: 'DELETE',
      path: '/linings/:id',
      handler: 'lining.delete',
      config: {
        auth: false, // Allow admin access for deleting
      },
    },
  ],
};
