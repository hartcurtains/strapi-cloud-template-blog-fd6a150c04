/**
 * brand router
 */

import { factories } from '@strapi/strapi';

export default {
  routes: [
    {
      method: 'GET',
      path: '/brands',
      handler: 'brand.find',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'GET',
      path: '/brands/:id',
      handler: 'brand.findOne',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'POST',
      path: '/brands',
      handler: 'brand.create',
      config: {
        auth: false, // Allow admin access for creating
      },
    },
    {
      method: 'PUT',
      path: '/brands/:id',
      handler: 'brand.update',
      config: {
        auth: false, // Allow admin access for updating
      },
    },
    {
      method: 'DELETE',
      path: '/brands/:id',
      handler: 'brand.delete',
      config: {
        auth: false, // Allow admin access for deleting
      },
    },
  ],
};
