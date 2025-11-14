/**
 * order router
 */

import { factories } from '@strapi/strapi';

export default {
  routes: [
    {
      method: 'GET',
      path: '/orders',
      handler: 'order.find',
      config: {
        auth: false, // Allow public access - authentication handled by Next.js API
      },
    },
    {
      method: 'GET',
      path: '/orders/:id',
      handler: 'order.findOne',
      config: {
        auth: false, // Allow public access - authentication handled by Next.js API
      },
    },
    {
      method: 'POST',
      path: '/orders',
      handler: 'order.create',
      config: {
        auth: false, // Allow public access - authentication handled by Next.js API
      },
    },
    {
      method: 'PUT',
      path: '/orders/:id',
      handler: 'order.update',
      config: {
        auth: false, // Allow public access - authentication handled by Next.js API
      },
    },
    {
      method: 'DELETE',
      path: '/orders/:id',
      handler: 'order.delete',
      config: {
        auth: false, // Allow public access - authentication handled by Next.js API
      },
    },
  ],
};
