const catalogUploadConfig = require('../src/catalog/catalog-upload-config');

const corsOrigins = [process.env.FRONTEND_URL, process.env.PUBLIC_URL]
  .filter(Boolean)
  .map((value) => {
    try { return new URL(String(value)).origin; } catch { return null; }
  })
  .filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);

export default [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  {
    name: 'strapi::cors',
    config: {
      origin: corsOrigins.length > 0 ? corsOrigins : ['http://localhost:3000'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      headers: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
      keepHeadersOnError: true,
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  // Must remain before strapi::body: it rejects sensitive requests without parsing payloads.
  'global::catalog-write-prebody-auth',
  // Quote requests are server-to-server and must be bounded before JSON parsing.
  'global::storefront-quote-prebody-limit',
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
