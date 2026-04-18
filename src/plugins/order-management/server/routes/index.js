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
      path: '/create-fabric-with-colour',
      handler: 'import-export.createFabricWithColour',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
