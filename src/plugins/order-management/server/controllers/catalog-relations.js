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

function recordKey(record) {
  return record?.documentId || record?.id || null;
}

function relationRecords(record, field) {
  const value = record?.[field];
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function uniqueRecords(records) {
  const seen = new Set();
  return records.filter((record) => {
    const key = recordKey(record);
    if (!key || seen.has(String(key))) return false;
    seen.add(String(key));
    return true;
  });
}

async function loadWithRelation(strapi, uid, id, field) {
  return strapi.entityService.findOne(uid, id, { populate: [field] });
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

    const uniqueTargetRecords = uniqueRecords(targetRecords);
    let updated = source;

    if (relation.mappedBy) {
      // Strapi stores a mappedBy relation on the opposite (inversedBy) side.
      // Updating the inverse field directly can return 200 without changing
      // the join table, so apply connect/disconnect operations to the owner.
      const targetModel = strapi.contentType(relation.target);
      const ownerField = relation.mappedBy;
      const ownerRelation = targetModel?.attributes?.[ownerField];
      if (!ownerRelation || ownerRelation.type !== 'relation') {
        return ctx.badRequest('The catalog relation owner is not configured');
      }

      const currentSource = await loadWithRelation(strapi, sourceEntity.uid, source.id, field);
      const currentTargetRecords = relationRecords(currentSource, field);
      const desiredKeys = new Set(uniqueTargetRecords.map((record) => String(recordKey(record))));
      const sourceKey = recordKey(source);

      for (const currentTarget of currentTargetRecords) {
        if (!desiredKeys.has(String(recordKey(currentTarget)))) {
          await strapi.entityService.update(relation.target, currentTarget.id, {
            data: { [ownerField]: { disconnect: [sourceKey] } },
          });
        }
      }

      const currentKeys = new Set(currentTargetRecords.map((record) => String(recordKey(record))));
      for (const target of uniqueTargetRecords) {
        if (!currentKeys.has(String(recordKey(target)))) {
          await strapi.entityService.update(relation.target, target.id, {
            data: { [ownerField]: { connect: [sourceKey] } },
          });
        }
      }
    } else {
      // The source owns this relation. Strapi v5 relation mutations expect
      // document IDs (not the numeric database IDs returned by db.query).
      const relationIds = uniqueTargetRecords.map((record) => recordKey(record));
      updated = await strapi.entityService.update(sourceEntity.uid, source.id, {
        data: { [field]: { set: relationIds } },
      });
    }

    const verified = await loadWithRelation(strapi, sourceEntity.uid, source.id, field);
    const actualKeys = new Set(relationRecords(verified, field).map((record) => String(recordKey(record))));
    const expectedKeys = new Set(uniqueTargetRecords.map((record) => String(recordKey(record))));
    if (actualKeys.size !== expectedKeys.size || [...expectedKeys].some((key) => !actualKeys.has(key))) {
      throw new Error(`Catalog relation verification failed for ${sourceCollection}.${field}`);
    }

    return ctx.send({
      data: {
        sourceCollection,
        sourceId: updated?.documentId || source.documentId || source.id,
        field,
        targetIds: uniqueTargetRecords.map((record) => recordKey(record)),
      },
    });
  },
};
