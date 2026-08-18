'use strict';

const { CATALOG_ENTITIES } = require('../../../../catalog/catalog-mutation-surface');

const entitiesByCollection = new Map(CATALOG_ENTITIES.map((entity) => [entity.collection, entity]));

function asIdentifier(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (value && typeof value === 'object') return String(value.documentId || value.id || '').trim();
  return '';
}

async function resolveRecord(strapi, uid, identifier) {
  const value = asIdentifier(identifier);
  if (!value) return null;
  const where = /^\d+$/.test(value) ? { id: Number(value) } : { documentId: value };
  return strapi.db.query(uid).findOne({ where, select: ['id', 'documentId'] });
}

module.exports = {
  async update(ctx) {
    const submitted = ctx.request.body?.data || ctx.request.body;
    const sourceCollection = String(submitted?.sourceCollection || '').trim();
    const sourceId = asIdentifier(submitted?.sourceId);
    const field = String(submitted?.field || '').trim();
    const targetIds = Array.isArray(submitted?.targetIds)
      ? submitted.targetIds.map(asIdentifier).filter(Boolean)
      : null;

    if (!sourceCollection || !sourceId || !field || !targetIds) {
      return ctx.badRequest('sourceCollection, sourceId, field and targetIds are required');
    }

    const sourceEntity = entitiesByCollection.get(sourceCollection);
    if (!sourceEntity || !sourceEntity.fields.includes(field)) {
      return ctx.badRequest('That catalog relation is not writable');
    }

    const sourceModel = strapi.contentType(sourceEntity.uid);
    const relation = sourceModel?.attributes?.[field];
    if (!relation || relation.type !== 'relation' || !relation.target) {
      return ctx.badRequest('That field is not a catalog relation');
    }

    const source = await resolveRecord(strapi, sourceEntity.uid, sourceId);
    if (!source) return ctx.notFound('Source record not found');

    const targetEntity = CATALOG_ENTITIES.find((entity) => entity.uid === relation.target);
    if (!targetEntity) return ctx.badRequest('The relation target is not part of the catalog edit surface');

    const targetRecords = [];
    for (const targetId of targetIds) {
      const target = await resolveRecord(strapi, targetEntity.uid, targetId);
      if (!target) return ctx.badRequest(`Related ${targetEntity.collection} record not found: ${targetId}`);
      targetRecords.push(target);
    }

    const uniqueTargetIds = [...new Set(targetRecords.map((record) => record.id))];
    const relationData = { [field]: { set: uniqueTargetIds } };
    const updated = await strapi.entityService.update(sourceEntity.uid, source.id, { data: relationData });

    return ctx.send({
      data: {
        sourceCollection,
        sourceId: updated?.documentId || source.documentId || source.id,
        field,
        targetIds: targetRecords.map((record) => record.documentId || record.id),
      },
    });
  },
};
