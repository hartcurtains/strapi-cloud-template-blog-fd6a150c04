/**
 * trimming router
 */

import { factories } from '@strapi/strapi';

export default {
  routes: [
    {
      method: 'GET',
      path: '/trimmings',
      handler: 'trimming.find',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'GET',
      path: '/trimmings/:id',
      handler: 'trimming.findOne',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'POST',
      path: '/trimmings',
      handler: 'trimming.create',
      config: {
        auth: false, // Allow admin access for creating
      },
    },
    {
      method: 'PUT',
      path: '/trimmings/:id',
      handler: 'trimming.update',
      config: {
        auth: false, // Allow admin access for updating
      },
    },
    {
      method: 'DELETE',
      path: '/trimmings/:id',
      handler: 'trimming.delete',
      config: {
        auth: false, // Allow admin access for deleting
      },
    },
  ],
};
