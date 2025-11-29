/**
 * mechanisation router
 */

import { factories } from '@strapi/strapi';

export default {
  routes: [
    {
      method: 'GET',
      path: '/mechanisations',
      handler: 'mechanisation.find',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'GET',
      path: '/mechanisations/:id',
      handler: 'mechanisation.findOne',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'POST',
      path: '/mechanisations',
      handler: 'mechanisation.create',
      config: {
        auth: false, // Allow admin access for creating
      },
    },
    {
      method: 'PUT',
      path: '/mechanisations/:id',
      handler: 'mechanisation.update',
      config: {
        auth: false, // Allow admin access for updating
      },
    },
    {
      method: 'DELETE',
      path: '/mechanisations/:id',
      handler: 'mechanisation.delete',
      config: {
        auth: false, // Allow admin access for deleting
      },
    },
  ],
};
