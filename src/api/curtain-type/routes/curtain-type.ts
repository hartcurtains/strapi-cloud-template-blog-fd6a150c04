/**
 * curtain-type router
 */

import { factories } from '@strapi/strapi';

export default {
  routes: [
    {
      method: 'GET',
      path: '/curtain-types',
      handler: 'curtain-type.find',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'GET',
      path: '/curtain-types/:id',
      handler: 'curtain-type.findOne',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'POST',
      path: '/curtain-types',
      handler: 'curtain-type.create',
      config: {
        auth: false, // Allow admin access for creating
      },
    },
    {
      method: 'PUT',
      path: '/curtain-types/:id',
      handler: 'curtain-type.update',
      config: {
        auth: false, // Allow admin access for updating
      },
    },
    {
      method: 'DELETE',
      path: '/curtain-types/:id',
      handler: 'curtain-type.delete',
      config: {
        auth: false, // Allow admin access for deleting
      },
    },
  ],
};
