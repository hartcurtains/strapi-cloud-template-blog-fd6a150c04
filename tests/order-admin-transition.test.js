'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('admin order page uses the authenticated transition route, not generic protected-field mutation', () => {
  const page = fs.readFileSync(path.join(root, 'src/plugins/order-management/admin/src/pages/OrderPage.jsx'), 'utf8');
  const routes = JSON.parse(fs.readFileSync(path.join(root, 'src/plugins/order-management/shared/routes.json'), 'utf8'));
  const pluginRoutes = fs.readFileSync(path.join(root, 'src/plugins/order-management/server/routes/index.js'), 'utf8');

  assert.equal(routes.adminOrderTransition, '/order-management/order-admin/transition');
  assert.match(page, /useFetchClient/);
  assert.match(page, /adminCatalogRoutes\.adminOrderTransition/);
  assert.doesNotMatch(page, /fetch\(`\/api\/orders\/\$\{orderId\}`/);
  assert.match(pluginRoutes, /path: '\/order-admin\/transition'/);
  assert.match(pluginRoutes, /admin::isAuthenticatedAdmin/);
});

test('server-to-server transition remains protected by the internal-secret policy', () => {
  const routes = fs.readFileSync(path.join(root, 'src/api/order/routes/order-admin.ts'), 'utf8');
  assert.match(routes, /global::security-internal-auth/);
  assert.match(routes, /path: '\/order-admin\/transition'/);
});
