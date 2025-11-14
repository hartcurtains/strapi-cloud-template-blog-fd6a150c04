import React from 'react';
import pluginId from './pluginId';

export default {
  register(app) {
    app.addMenuLink({
      to: `/plugins/${pluginId}`,
      icon: 'Dashboard',
      intlLabel: {
        id: `${pluginId}.plugin.name`,
        defaultMessage: 'Order Management',
      },
      Component: () => import('./pages/App'),
      permissions: [],
    });
    app.registerPlugin({
      id: pluginId,
      name: 'Order Management',
    });
  },
};