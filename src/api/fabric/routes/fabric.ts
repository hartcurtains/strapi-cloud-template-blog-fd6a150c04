/**
 * fabric router
 */

import { factories } from '@strapi/strapi';

export default {
  routes: [
    {
      method: 'GET',
      path: '/fabrics',
      handler: 'fabric.find',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'GET',
      path: '/fabrics/:id',
      handler: 'fabric.findOne',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'POST',
      path: '/fabrics',
      handler: 'fabric.create',
      config: {
        auth: false, // Allow admin access for creating
      },
    },
    {
      method: 'PUT',
      path: '/fabrics/:id',
      handler: 'fabric.update',
      config: {
        auth: false, // Allow admin access for updating
      },
    },
    {
      method: 'DELETE',
      path: '/fabrics/:id',
      handler: 'fabric.delete',
      config: {
        auth: false, // Allow admin access for deleting
      },
    },
    {
      method: 'POST',
      path: '/fabrics/import',
      handler: 'fabric.importFabrics',
      config: {
        auth: false, // Allow admin access for importing
      },
    },
  ],
};
