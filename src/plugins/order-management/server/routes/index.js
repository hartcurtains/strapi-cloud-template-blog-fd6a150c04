module.exports = {
  routes: [
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
      path: '/import',
      handler: 'import-export.bulkImport',
      config: {
        policies: [],
        middlewares: [],
      },
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
  ],
};
