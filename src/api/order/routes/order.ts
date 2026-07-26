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
      config: {},
    },
    {
      method: 'GET',
      path: '/orders/:id',
      handler: 'order.findOne',
      config: {},
    },
    {
      method: 'POST',
      path: '/orders',
      handler: 'order.create',
      config: {},
    },
    {
      method: 'PUT',
      path: '/orders/:id',
      handler: 'order.update',
      config: {},
    },
  ],
};
