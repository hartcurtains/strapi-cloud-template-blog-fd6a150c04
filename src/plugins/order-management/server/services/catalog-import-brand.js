'use strict';

function normalizeBrandName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase();
}

function relationIdentifier(value) {
  if (Array.isArray(value)) return relationIdentifier(value[0]);
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') {
    if (Array.isArray(value.connect)) return relationIdentifier(value.connect[0]);
    if (value.documentId !== undefined && value.documentId !== null) return String(value.documentId);
    if (value.id !== undefined && value.id !== null) return String(value.id);
    return null;
  }
  return String(value);
}

function brandRelationPayload(brand) {
  const identifier = brand?.documentId ?? brand?.id;
  if (identifier === null || identifier === undefined || identifier === '') return null;
  return { connect: [identifier] };
}

function sameBrand(target, current) {
  if (!target || !current) return !target && !current;

  const targetId = relationIdentifier(target);
  const currentId = relationIdentifier(current);
  if (targetId && currentId && targetId === currentId) return true;

  const targetName = normalizeBrandName(target?.name);
  const currentName = normalizeBrandName(current?.name);
  return Boolean(targetName && currentName && targetName === currentName);
}

function buildBrandIndex(brands) {
  const byName = new Map();
  const ambiguous = new Set();

  for (const brand of brands || []) {
    const key = normalizeBrandName(brand?.name);
    if (!key) continue;
    if (ambiguous.has(key)) continue;

    const current = byName.get(key);
    if (current && relationIdentifier(current) !== relationIdentifier(brand)) {
      byName.delete(key);
      ambiguous.add(key);
      continue;
    }
    byName.set(key, brand);
  }

  return { byName, ambiguous };
}

function linkedBrandSummary(brand) {
  if (!brand) return null;
  return {
    id: brand.id ?? null,
    documentId: brand.documentId ?? null,
    name: brand.name ?? null,
  };
}

module.exports = {
  brandRelationPayload,
  buildBrandIndex,
  linkedBrandSummary,
  normalizeBrandName,
  relationIdentifier,
  sameBrand,
};
