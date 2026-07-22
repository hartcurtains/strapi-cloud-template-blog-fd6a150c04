'use strict';

const { errors } = require('@strapi/utils');
const { CATALOG_ENTITIES } = require('../catalog/catalog-mutation-surface');

const { ValidationError } = errors;
const allowedByUid = new Map(CATALOG_ENTITIES.map((entity: any) => [entity.uid, new Set(entity.fields)]));

module.exports = async (policyContext: any, config: { uid?: string } = {}) => {
  if (!['POST', 'PUT', 'PATCH'].includes(policyContext.method)) return true;
  const data = policyContext.request?.body?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return true;

  const allowed = allowedByUid.get(config.uid) as Set<string> | undefined;
  if (!allowed) throw new ValidationError('Catalog mutation field allowlist is not configured');
  const rejected = Object.keys(data).filter(field => !allowed.has(field));
  if (rejected.length) throw new ValidationError(`Catalog fields are not writable: ${rejected.join(', ')}`);
  return true;
};
