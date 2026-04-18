export default [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  {
    name: 'strapi::body',
    config: {
      formLimit: '2gb', // Allow large file uploads for bulk image import
      jsonLimit: '50mb',
      textLimit: '50mb',
      formidable: {
        maxFileSize: 1 * 1024 * 1024 * 1024, // 1GB per file (matches controller validation)
        maxFields: 10,
        maxFieldsSize: 2 * 1024 * 1024,
      },
    },
  },
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
