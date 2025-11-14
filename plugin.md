# Order Management Plugin - Complete Code Reference

## Plugin Structure
```
hcbDB/src/plugins/order-management/
├── admin/
│   └── src/
│       ├── index.js
│       ├── pluginId.js
│       ├── pages/
│       │   └── OrderPage.js
│       └── translations/
│           └── en.json
├── package.json
└── server/
    ├── controllers/
    │   └── order.js
    └── services/
        └── order.js
```

## Configuration Files

### hcbDB/config/plugins.js
```javascript
module.exports = {
  'order-management': {
    enabled: true,
    resolve: './src/plugins/order-management',
  },
};
```

### hcbDB/src/admin/vite.config.ts
```typescript
import { mergeConfig, type UserConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default (config: UserConfig) => {
  return mergeConfig(config, {
    plugins: [nodePolyfills()],
    resolve: {
      alias: {
        '@': '/src',
        // Provide browser-compatible polyfills for Node.js modules
        'path': 'path-browserify',
        'fs': 'memfs',
        'url': 'url',
        'source-map-js': 'source-map-js',
        // Replace sanitize-html with DOMPurify for browser compatibility
        'sanitize-html': 'dompurify',
      },
    },
    define: {
      global: 'globalThis',
    },
    optimizeDeps: {
      exclude: [
        'exceljs'
      ],
      include: [
        'dompurify',
        'path-browserify',
        'url',
        'source-map-js',
        'memfs'
      ]
    }
  });
};
```

## Plugin Files

### hcbDB/src/plugins/order-management/admin/src/index.js
```javascript
import pluginId from './pluginId';

export default {
  register(app) {
    console.log('🛒 Registering Order Management plugin...');

    app.addMenuLink({
      to: `/plugins/${pluginId}`,
      icon: () => <span style={{ fontSize: '18px' }}>🛒</span>,
      intlLabel: {
        id: `${pluginId}.plugin.name`,
        defaultMessage: 'Order Management',
      },
      // ✅ Must return the default export explicitly
      Component: async () => {
        const component = await import('./pages/OrderPage');
        return component.default;
      },
      permissions: [], // still optional
    });

    console.log('✅ Order Management plugin registered successfully!');
  },
};
```

### hcbDB/src/plugins/order-management/admin/src/pluginId.js
```javascript
const pluginId = 'order-management';
export default pluginId;
```

### hcbDB/src/plugins/order-management/admin/src/pages/OrderPage.js
```javascript
import React from 'react';

export default function OrderPage() {
  return (
    <div style={{ padding: 24 }}>
      <h1>🛒 Order Management</h1>
      <p>Welcome to your custom order dashboard.</p>
      <p>This is a simple test page to verify the plugin is working.</p>
      <p>If you can see this, the plugin is loading correctly!</p>
    </div>
  );
}
```

### hcbDB/src/plugins/order-management/admin/src/translations/en.json
```json
{
  "order-management.plugin.name": "Order Management"
}
```

### hcbDB/src/plugins/order-management/package.json
```json
{
  "name": "order-management",
  "version": "0.0.1",
  "private": true,
  "dependencies": {
    "@strapi/design-system": "5.23.6",
    "@strapi/helper-plugin": "5.23.6"
  },
  "strapi": {
    "name": "order-management",
    "displayName": "Order Management"
  }
}
```

## Server Files

### hcbDB/src/plugins/order-management/server/controllers/order.js
```javascript
module.exports = ({ strapi }) => ({
  async find(ctx) {
    const orders = await strapi.db.query('api::order.order').findMany();
    ctx.body = orders;
  },
});
```

### hcbDB/src/plugins/order-management/server/services/order.js
```javascript
module.exports = ({ strapi }) => ({
  getWelcomeMessage() {
    return 'Welcome to Order Management!';
  },
});
```

## Dependencies Added

### hcbDB/package.json (devDependencies added)
```json
{
  "devDependencies": {
    "path-browserify": "^1.0.1",
    "url": "^0.11.3",
    "source-map-js": "^1.2.0",
    "vite-plugin-node-polyfills": "^0.24.0",
    "memfs": "^3.5.0",
    "dompurify": "^3.0.0"
  }
}
```

## Debugging Checklist

### ✅ What Should Work:
1. **Plugin ID matches** - `'order-management'` in all files
2. **Package.json correct** - `"name": "order-management"` in strapi section
3. **Vite config** - DOMPurify polyfill for browser compatibility
4. **Strapi v5 syntax** - `Component: () => import('./pages/OrderPage')`
5. **Default export** - `export default function OrderPage()`
6. **Plugin enabled** - In `config/plugins.js`

### 🔍 What to Check:
1. **Console logs** - Look for "🛒 Registering Order Management plugin..." and "✅ Order Management plugin registered successfully!"
2. **Sidebar** - Check for "Order Management" with 🛒 icon
3. **Browser console** - No Node.js module errors
4. **Network tab** - Check if plugin files are being loaded

### 🚨 Common Issues:
1. **Plugin not in sidebar** - Check console for registration logs
2. **Node.js module errors** - Vite polyfills should handle this
3. **Component not loading** - Check default export syntax
4. **Build errors** - Run `npm run build` after changes

## Commands Used:
```bash
# Build admin panel
npm run build

# Start development server
npm run develop

# Install dependencies
npm install --save-dev path-browserify url source-map-js vite-plugin-node-polyfills memfs
npm install dompurify
```

## Current Status:
- ✅ Plugin structure created
- ✅ Vite configuration with polyfills
- ✅ Strapi v5 syntax implemented
- ✅ Browser compatibility fixed
- ❓ Plugin registration in sidebar (needs verification)
