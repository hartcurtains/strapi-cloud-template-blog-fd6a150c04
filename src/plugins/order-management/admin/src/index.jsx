import React from 'react';
import pluginId from './pluginId';

export default {
  register(app) {
    console.log('🛒 Registering Order Management plugin...');

    app.addMenuLink({
      to: `plugins/${pluginId}`,
      icon: () => <span style={{ fontSize: '18px' }}>🛒</span>,
      intlLabel: {
        id: `${pluginId}.plugin.name`,
        defaultMessage: 'Order Management',
      },
      Component: () => import('./pages/OrderPage.jsx'),
      permissions: [],
    });

    app.addMenuLink({
      to: `plugins/${pluginId}/products`,
      icon: () => <span style={{ fontSize: '18px' }}>📦</span>,
      intlLabel: {
        id: `${pluginId}.products.name`,
        defaultMessage: 'Product Management',
      },
      Component: () => import('./pages/ProductManagementPage.jsx'),
      permissions: [],
    });

    app.registerPlugin({
      id: pluginId,
      name: 'Order Management',
    });

    console.log('✅ Order Management plugin registered successfully!');
  },
};