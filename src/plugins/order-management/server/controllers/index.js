'use strict';

const importExport = require('./import-export');
const catalogRelations = require('./catalog-relations');

const orderAdmin = {
  async transition(ctx) {
    // The route itself is admin-authenticated. Reuse the same protected
    // transition controller so status/payment invariants and email intent
    // creation cannot diverge between server callers and the admin panel.
    return strapi.controller('api::order.order-admin').transition(ctx);
  },
};

module.exports = {
  'import-export': importExport,
  'catalog-relations': catalogRelations,
  'order-admin': orderAdmin,
};
