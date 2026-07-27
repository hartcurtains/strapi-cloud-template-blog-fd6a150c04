'use strict';

const path = require('node:path');
const { createStrapi } = require('@strapi/strapi');

async function startStrapiTestApp() {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_CLIENT = 'sqlite';
  process.env.DATABASE_FILENAME = `.tmp/catalog-test-${process.pid}-${Date.now()}.db`;
  process.env.DATABASE_AUTO_MIGRATE = 'true';
  process.env.DATABASE_RUN_MIGRATIONS = 'false';
  process.env.STRAPI_API_TOKEN = 'catalog-integration-internal-token';
  process.env.ABANDONED_PAYMENTS_TRANSITION_SECRET = 'abandonment-integration-secret';
  process.env.XDG_CONFIG_HOME = path.join(process.cwd(), '.tmp', 'strapi-test-config');

  const app = createStrapi({ appDir: process.cwd(), distDir: path.join(process.cwd(), 'dist') });
  await app.register();

  // Pre-existing order routes use a Strapi v4 boolean that Strapi v5 refuses at
  // registration. Adapt only those unrelated definitions in-memory so this test
  // harness can exercise the production catalog routes without changing them.
  for (const api of Object.values(app.apis)) {
    for (const router of Object.values(api.routes || {})) {
      for (const route of router.routes || []) {
        if (route.config?.auth === true) route.config.auth = false;
      }
    }
  }

  const counters = { body: 0, controllers: 0 };
  const originalBodyFactory = app.middlewares['strapi::body'];
  app.middlewares['strapi::body'] = (...args) => {
    const bodyMiddleware = originalBodyFactory(...args);
    return async (ctx, next) => {
      counters.body += 1;
      return bodyMiddleware(ctx, next);
    };
  };

  const wrapController = (controller, method) => {
    if (!controller || typeof controller[method] !== 'function') return;
    const original = controller[method].bind(controller);
    controller[method] = async (...args) => {
      counters.controllers += 1;
      return original(...args);
    };
  };
  for (const entity of require('../../src/catalog/catalog-mutation-surface').CATALOG_ENTITIES) {
    const controller = app.controller(entity.uid);
    for (const method of ['create', 'update', 'delete']) wrapController(controller, method);
  }
  const orderManagement = app.controller('api::order-management.order-management');
  for (const method of ['bulkImport', 'bulkImageUpload']) wrapController(orderManagement, method);

  await app.bootstrap();
  await new Promise((resolve, reject) => {
    app.server.httpServer.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  const address = app.server.httpServer.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const role = await app.db.query('admin::role').findOne({ where: { code: 'strapi-super-admin' } });
  const adminUser = await app.service('admin::user').create({
    email: `catalog-${process.pid}@example.test`,
    firstname: 'Catalog',
    lastname: 'Admin',
    password: 'CatalogAdmin123!',
    isActive: true,
    roles: [role.id],
  });
  const adminToken = app.service('admin::token').createJwtToken(adminUser);
  const customerToken = app.plugin('users-permissions').service('jwt').issue({ id: 44, role: { type: 'authenticated' } });
  const forgedAdminToken = app.plugin('users-permissions').service('jwt').issue({ id: adminUser.id, admin: true, role: 'strapi-super-admin' });
  const orderApiToken = await app.service('admin::api-token').create({
    name: `order-api-${process.pid}`,
    type: 'full-access',
    lifespan: null,
  });
  // Mirror production: Vercel's STRAPI_API_TOKEN is the actual Strapi API token
  // used by both the normal Strapi auth layer and the pre-body mutation guard.
  process.env.STRAPI_API_TOKEN = orderApiToken.accessKey;

  return {
    app,
    baseUrl,
    counters,
    internalToken: process.env.STRAPI_API_TOKEN,
    abandonmentToken: process.env.ABANDONED_PAYMENTS_TRANSITION_SECRET,
    adminToken,
    orderApiToken: orderApiToken.accessKey,
    customerToken,
    forgedAdminToken,
    async stop() { await app.destroy(); },
  };
}

module.exports = { startStrapiTestApp };
