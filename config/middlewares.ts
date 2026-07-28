const catalogUploadConfig = require('../src/catalog/catalog-upload-config');

export default [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  // Must remain before strapi::body: it rejects sensitive requests without parsing payloads.
  'global::catalog-write-prebody-auth',
  // Trace only Ashley Media uploads carrying the client correlation header.
  'global::ashley-upload-diagnostics',
  {
    name: 'strapi::body',
    config: {
      // The admin uploader sends files sequentially; 50MB/file and 100MB/request are sufficient.
      formLimit: '100mb',
      jsonLimit: '50mb',
      textLimit: '50mb',
      formidable: {
        maxFileSize: catalogUploadConfig.maxFileSize,
        maxFields: 20,
        maxFieldsSize: 1 * 1024 * 1024,
      },
    },
  },
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
