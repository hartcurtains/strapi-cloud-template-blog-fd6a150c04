'use strict';

const MUTATION_METHODS = Object.freeze(['POST', 'PUT', 'PATCH', 'DELETE']);

const CATALOG_ENTITIES = Object.freeze([
  { uid: 'api::fabric.fabric', collection: 'fabrics', fields: ['name', 'collection', 'images', 'patternRepeat_cm', 'usableWidth_cm', 'martindale', 'composition', 'availability', 'price_per_metre', 'is_featured', 'featured_until', 'productId', 'slug', 'pattern', 'cushions', 'care_instructions', 'brand', 'colours', 'is_curtain', 'pricing_rules', 'description', 'is_blind', 'is_cushion'] },
  { uid: 'api::colour.colour', collection: 'colours', fields: ['name', 'normalizedColour', 'thumbnail', 'fabrics'] },
  { uid: 'api::cushion.cushion', collection: 'cushions', fields: ['name', 'fabrics', 'cushion_type', 'available_sizes', 'available_pads', 'available_piping_types'] },
  { uid: 'api::pricing-rule.pricing-rule', collection: 'pricing-rules', fields: ['name', 'formula', 'product_type', 'fabrics'] },
  { uid: 'api::lining.lining', collection: 'linings', fields: ['liningType', 'price_per_metre', 'colour', 'thumbnail', 'pricing_rule', 'key', 'display_name', 'blackout', 'active', 'sort_order', 'is_configurator_option', 'applies_to_curtains', 'applies_to_blinds', 'lining_colour_options'] },
  { uid: 'api::lining-colour.lining-colour', collection: 'lining-colours', fields: ['key', 'display_name', 'hex', 'active', 'sort_order', 'applies_to_curtains', 'applies_to_blinds', 'thumbnail', 'compatible_lining_types'] },
  { uid: 'api::trimming.trimming', collection: 'trimmings', fields: ['type', 'price'] },
  { uid: 'api::mechanisation.mechanisation', collection: 'mechanisations', fields: ['name', 'price', 'thumbnail', 'key', 'display_name', 'active', 'sort_order', 'is_configurator_option', 'mechanism_family', 'mechanism_finishes'] },
  { uid: 'api::mechanism-finish.mechanism-finish', collection: 'mechanism-finishes', fields: ['key', 'display_name', 'active', 'sort_order', 'compatible_mechanisations'] },
  { uid: 'api::curtain-type.curtain-type', collection: 'curtain-types', fields: ['name', 'price', 'thumbnail', 'fullness_multiplier', 'key', 'display_name', 'active', 'sort_order', 'is_configurator_option'] },
  { uid: 'api::blind-type.blind-type', collection: 'blind-types', fields: ['name', 'thumbnail', 'key', 'display_name', 'active', 'sort_order', 'is_configurator_option'] },
  { uid: 'api::cushion-type.cushion-type', collection: 'cushion-types', fields: ['name', 'types', 'width_cm', 'height_cm'] },
  { uid: 'api::cushion-size.cushion-size', collection: 'cushion-sizes', fields: ['name', 'width_cm', 'height_cm', 'shape', 'thumbnail', 'duck_feather_surcharge', 'workmanship_cost'] },
  { uid: 'api::cushion-piping.cushion-piping', collection: 'cushion-piping-types', fields: ['name', 'type', 'price', 'thumbnail', 'key', 'active', 'sort_order'] },
  { uid: 'api::cushion-pad.cushion-pad', collection: 'cushion-pads', fields: ['name', 'type', 'price', 'thumbnail', 'key', 'active', 'sort_order'] },
  { uid: 'api::curtain-pole.curtain-pole', collection: 'curtain-poles', fields: ['name', 'thumbnail', 'price', 'allowed_lengths', 'allowed_brackets', 'bracket_requirement'] },
  { uid: 'api::made-to-measure-configuration.made-to-measure-configuration', collection: 'made-to-measure-configurations', fields: ['key', 'product_type', 'display_name', 'active', 'delivery_lead_time', 'delivery_message', 'delivery_returns_copy', 'disabled_option_categories', 'sample_max_quantity', 'sample_unit_price_pence', 'pricing_version'] },
  { uid: 'api::brand.brand', collection: 'brands', fields: ['name', 'thumbnail', 'description', 'fabrics'] },
]);

const CUSTOM_MUTATIONS = Object.freeze([
  { method: 'POST', path: '/api/fabrics/import', operation: 'fabric-import' },
  { method: 'POST', path: '/api/order-management/import', operation: 'catalog-import' },
  { method: 'POST', path: '/api/order-management/bulk-image-upload', operation: 'bulk-image-upload' },
  { method: 'POST', path: '/order-management/import', operation: 'catalog-import' },
  { method: 'POST', path: '/order-management/bulk-image-upload', operation: 'bulk-image-upload' },
  { method: 'POST', path: '/order-management/create-fabric-with-colour', operation: 'fabric-colour-create' },
  { method: 'POST', path: '/api/order-management/admin/catalog/relations', operation: 'catalog-relation-update' },
  { method: 'POST', path: '/order-management/admin/catalog/relations', operation: 'catalog-relation-update' },
  { method: 'POST', path: '/order-management/ashley-wilde/analyse', operation: 'image-folder-analyse' },
  { method: 'POST', path: '/order-management/ashley-wilde/presign-upload', operation: 'image-direct-upload-presign' },
  { method: 'POST', path: '/order-management/ashley-wilde/complete-upload', operation: 'image-direct-upload-complete' },
  { method: 'POST', path: '/order-management/ashley-wilde/finalise', operation: 'image-finalisation' },
  { method: 'POST', path: '/order-management/ashley-wilde/media-status', operation: 'image-media-status' },
  { method: 'POST', path: '/order-management/ashley-wilde/progress', operation: 'image-progress' },
  { method: 'POST', path: '/order-management/ashley-wilde/promote', operation: 'image-folder-promote' },
  { method: 'POST', path: '/order-management/ashley-wilde/promote/preview', operation: 'image-promotion-preview' },
  { method: 'POST', path: '/order-management/ashley-wilde/promote/apply', operation: 'image-promotion-apply' },
  { method: 'POST', path: '/order-management/supplier-colour-mappings/upload', operation: 'supplier-mapping-upload' },
  { method: 'POST', path: '/order-management/supplier-colour-mappings/apply', operation: 'supplier-mapping-apply' },
  { method: 'POST', path: '/order-management/supplier-colour-mappings/reenrich', operation: 'supplier-mapping-reenrich' },
]);

// Upload routes can attach media to, or remove media from, catalog records. The
// pre-body middleware cannot inspect multipart fields to determine the target,
// so the complete mutation boundary must be expressed using method and path.
const UPLOAD_MUTATIONS = Object.freeze([
  { method: 'POST', path: '/api/upload', operation: 'media-upload' },
  { method: 'DELETE', path: '/api/upload/files/:id', operation: 'media-delete' },
  { method: 'POST', path: '/upload', operation: 'media-upload' },
  { method: 'DELETE', path: '/upload/files/:id', operation: 'media-delete' },
  { method: 'POST', path: '/upload/actions/bulk-delete', operation: 'media-bulk-delete' },
  { method: 'POST', path: '/upload/actions/bulk-move', operation: 'media-bulk-move' },
]);

const entitiesByUid = new Map(CATALOG_ENTITIES.map(entity => [entity.uid, entity]));
const entitiesByCollection = new Map(CATALOG_ENTITIES.map(entity => [entity.collection, entity]));
const customByKey = new Map(CUSTOM_MUTATIONS.map(route => [`${route.method} ${route.path}`, route]));

function normalizePath(value) {
  const withoutQuery = String(value || '/').split('?')[0].replace(/\\/g, '/');
  const normalized = `/${withoutQuery}`.replace(/\/{2,}/g, '/').replace(/\/$/, '');
  return normalized || '/';
}

function mutationPolicyConfig(uid) {
  return {
    auth: false,
    policies: [
      'global::catalog-mutation-auth',
      { name: 'global::catalog-mutation-fields', config: { uid } },
    ],
  };
}

function customMutationPolicyConfig() {
  return { auth: false, policies: ['global::catalog-mutation-auth'] };
}

function matchCatalogMutation(methodValue, pathValue) {
  const method = String(methodValue || '').toUpperCase();
  if (!MUTATION_METHODS.includes(method)) return null;
  const path = normalizePath(pathValue);

  const custom = customByKey.get(`${method} ${path}`);
  if (custom) return { kind: 'custom', ...custom };

  const upload = UPLOAD_MUTATIONS.find(route => {
    if (route.method !== method) return false;
    if (!route.path.includes(':id')) return route.path === path;
    const prefix = route.path.slice(0, route.path.indexOf(':id'));
    return path.startsWith(prefix) && path.length > prefix.length;
  });
  if (upload) return { kind: 'upload', ...upload, path };

  const contentApiMatch = /^\/api\/([^/]+)(?:\/[^/]+)?$/.exec(path);
  if (contentApiMatch) {
    const entity = entitiesByCollection.get(contentApiMatch[1]);
    if (entity) return { kind: 'content-api', method, path, entity };
  }

  const contentManagerMatch = /^\/content-manager\/collection-types\/([^/]+)(?:\/.*)?$/.exec(path);
  if (contentManagerMatch) {
    let uid = contentManagerMatch[1];
    try { uid = decodeURIComponent(uid); } catch { return null; }
    const entity = entitiesByUid.get(uid);
    if (entity) return { kind: 'content-manager', method, path, entity };
  }

  return null;
}

function expectedContentApiMutations() {
  return CATALOG_ENTITIES.flatMap(entity => [
    { uid: entity.uid, method: 'POST', path: `/api/${entity.collection}` },
    { uid: entity.uid, method: 'PUT', path: `/api/${entity.collection}/:id` },
    { uid: entity.uid, method: 'DELETE', path: `/api/${entity.collection}/:id` },
  ]);
}

module.exports = {
  CATALOG_ENTITIES,
  CUSTOM_MUTATIONS,
  UPLOAD_MUTATIONS,
  MUTATION_METHODS,
  customMutationPolicyConfig,
  expectedContentApiMutations,
  matchCatalogMutation,
  mutationPolicyConfig,
  normalizePath,
};
