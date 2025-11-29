/**
 * care-instruction router
 */

import { factories } from '@strapi/strapi';

export default {
  routes: [
    {
      method: 'GET',
      path: '/care-instructions',
      handler: 'care-instruction.find',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'GET',
      path: '/care-instructions/:id',
      handler: 'care-instruction.findOne',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'POST',
      path: '/care-instructions',
      handler: 'care-instruction.create',
      config: {
        auth: false, // Allow admin access for creating
      },
    },
    {
      method: 'PUT',
      path: '/care-instructions/:id',
      handler: 'care-instruction.update',
      config: {
        auth: false, // Allow admin access for updating
      },
    },
    {
      method: 'DELETE',
      path: '/care-instructions/:id',
      handler: 'care-instruction.delete',
      config: {
        auth: false, // Allow admin access for deleting
      },
    },
  ],
};
