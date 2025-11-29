/**
 * blind-type router
 */

import { factories } from '@strapi/strapi';

export default {
  routes: [
    {
      method: 'GET',
      path: '/blind-types',
      handler: 'blind-type.find',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'GET',
      path: '/blind-types/:id',
      handler: 'blind-type.findOne',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'POST',
      path: '/blind-types',
      handler: 'blind-type.create',
      config: {
        auth: false, // Allow admin access for creating
      },
    },
    {
      method: 'PUT',
      path: '/blind-types/:id',
      handler: 'blind-type.update',
      config: {
        auth: false, // Allow admin access for updating
      },
    },
    {
      method: 'DELETE',
      path: '/blind-types/:id',
      handler: 'blind-type.delete',
      config: {
        auth: false, // Allow admin access for deleting
      },
    },
  ],
};
