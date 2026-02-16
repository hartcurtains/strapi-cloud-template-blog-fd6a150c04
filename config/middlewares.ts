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
      formLimit: '1024mb', // Increase JSON/form body limit
      jsonLimit: '1024mb',
      textLimit: '1024mb',
      formidable: {
        maxFileSize: 1024 * 1024 * 1024, // 1GB
      },
    },
  },
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
