const { customMutationPolicyConfig } = require('../../../../catalog/catalog-mutation-surface');
const adminCatalogRoutes = require('../../shared/routes');
const relativePath = (path) => path.slice(adminCatalogRoutes.base.length);

module.exports = [
    {
      method: 'GET',
      path: '/test',
      handler: 'import-export.test',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: relativePath(adminCatalogRoutes.import),
      handler: 'import-export.bulkImport',
      config: { ...customMutationPolicyConfig(), middlewares: [] },
    },
    {
      method: 'POST',
      path: '/export',
      handler: 'import-export.bulkExport',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/relation-data',
      handler: 'import-export.getRelationData',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/parse-pdf',
      handler: 'import-export.parsePDF',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'GET',
      path: '/color-codes/lookup',
      handler: 'import-export.lookupColorCode',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: relativePath(adminCatalogRoutes.createFabricWithColour),
      handler: 'import-export.createFabricWithColour',
      config: { ...customMutationPolicyConfig(), middlewares: [] },
    },
    {
      method: 'POST',
      path: relativePath(adminCatalogRoutes.bulkImageUpload),
      handler: 'import-export.bulkImageUpload',
      config: { ...customMutationPolicyConfig(), middlewares: [] },
    },
    {
      method: 'POST',
      path: relativePath(adminCatalogRoutes.ashleyWildeAnalyse),
      handler: 'import-export.analyseAshleyWildeFolder',
      config: { policies: ['admin::isAuthenticatedAdmin'], middlewares: [] },
    },
    {
      method: 'POST',
      path: relativePath(adminCatalogRoutes.ashleyWildeFinalise),
      handler: 'import-export.finaliseAshleyWilde',
      config: { policies: ['admin::isAuthenticatedAdmin'], middlewares: [] },
    },
    {
      method: 'POST',
      path: relativePath(adminCatalogRoutes.ashleyWildeMediaStatus),
      handler: 'import-export.getAshleyWildeMediaStatus',
      config: { policies: ['admin::isAuthenticatedAdmin'], middlewares: [] },
    },
    {
      method: 'POST',
      path: relativePath(adminCatalogRoutes.ashleyWildeProgress),
      handler: 'import-export.recordAshleyWildeProgress',
      config: { policies: ['admin::isAuthenticatedAdmin'], middlewares: [] },
    },
    {
      method: 'GET',
      path: relativePath(adminCatalogRoutes.ashleyWildeHistory),
      handler: 'import-export.getAshleyWildeHistory',
      config: { policies: ['admin::isAuthenticatedAdmin'], middlewares: [] },
    },
    {
      method: 'GET',
      path: relativePath(adminCatalogRoutes.ashleyWildeMode),
      handler: 'import-export.getAshleyWildeMode',
      config: { policies: ['admin::isAuthenticatedAdmin'], middlewares: [] },
    },
    {
      method: 'POST',
      path: relativePath(adminCatalogRoutes.ashleyWildePromote),
      handler: 'import-export.promoteAshleyWilde',
      config: { auth: false, policies: ['global::ashley-wilde-admin'], middlewares: [] },
    },
    {
      method: 'POST',
      path: relativePath(adminCatalogRoutes.ashleyWildePromotionPreview),
      handler: 'import-export.previewAshleyWildePromotion',
      config: { auth: false, policies: ['global::ashley-wilde-admin'], middlewares: [] },
    },
    {
      method: 'POST',
      path: relativePath(adminCatalogRoutes.ashleyWildePromotionApply),
      handler: 'import-export.applyAshleyWildePromotion',
      config: { auth: false, policies: ['global::ashley-wilde-admin'], middlewares: [] },
    },
    {
      method: 'POST',
      path: relativePath(adminCatalogRoutes.ashleyWildeLegacyColourCleanupPreview),
      handler: 'import-export.previewAshleyWildeLegacyColourCleanup',
      config: { auth: false, policies: ['global::ashley-wilde-admin'], middlewares: [] },
    },
    {
      method: 'POST',
      path: relativePath(adminCatalogRoutes.ashleyWildeLegacyColourCleanupApply),
      handler: 'import-export.applyAshleyWildeLegacyColourCleanup',
      config: { auth: false, policies: ['global::ashley-wilde-admin'], middlewares: [] },
    },
    {
      method: 'POST',
      path: relativePath(adminCatalogRoutes.supplierMappingsUpload),
      handler: 'import-export.uploadSupplierMapping',
      config: { auth: false, policies: ['global::supplier-mapping-admin'], middlewares: [] },
    },
    {
      method: 'POST',
      path: relativePath(adminCatalogRoutes.supplierMappingsApply),
      handler: 'import-export.applySupplierMapping',
      config: { auth: false, policies: ['global::supplier-mapping-admin'], middlewares: [] },
    },
    {
      method: 'GET',
      path: relativePath(adminCatalogRoutes.supplierMappingsActive),
      handler: 'import-export.getActiveSupplierMappings',
      config: { auth: false, policies: ['global::supplier-mapping-admin'], middlewares: [] },
    },
    {
      method: 'GET',
      path: relativePath(adminCatalogRoutes.supplierMappingsExport),
      handler: 'import-export.exportSupplierMapping',
      config: { auth: false, policies: ['global::supplier-mapping-admin'], middlewares: [] },
    },
    {
      method: 'GET',
      path: relativePath(adminCatalogRoutes.supplierMappingsFallbackExport),
      handler: 'import-export.exportSupplierMappingFallback',
      config: { auth: false, policies: ['global::supplier-mapping-admin'], middlewares: [] },
    },
    {
      method: 'POST',
      path: relativePath(adminCatalogRoutes.supplierMappingsReenrich),
      handler: 'import-export.reenrichSupplierMappings',
      config: { auth: false, policies: ['global::supplier-mapping-admin'], middlewares: [] },
    },
];
