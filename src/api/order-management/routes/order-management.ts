/**
 * order-management router
 */

import { factories } from '@strapi/strapi';

export default {
  routes: [
    {
      method: 'GET',
      path: '/order-management/test',
      handler: 'order-management.test',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/order-management/import',
      handler: 'order-management.bulkImport',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/order-management/export',
      handler: 'order-management.bulkExport',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/order-management/relation-data',
      handler: 'order-management.getRelationData',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/order-management/bulk-image-upload',
      handler: 'order-management.bulkImageUpload',
      config: {
        auth: false,
      },
    },
  ],
};

