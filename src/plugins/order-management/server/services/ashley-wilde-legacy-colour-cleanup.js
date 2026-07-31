'use strict';

const crypto = require('crypto');

const SUPPLIER = 'Ashley Wilde';
const FABRIC_UID = 'api::fabric.fabric';
const COLOUR_UID = 'api::colour.colour';
const IDENTITY_UID = 'api::fabric-colour-identity.fabric-colour-identity';
const PLAN_TTL_MS = 10 * 60 * 1000;
const QUERY_LIMIT = 5000;

const key = (value) => String(value || '').trim().toLowerCase();
const entityKey = (value) => String(value?.documentId || value?.id || value || '').trim();
const mutationId = (value) => value?.id || value?.documentId || value;
const stableFingerprint = (value) => crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const sortedUnique = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));

function assertScope(options = {}) {
  if (options.supplier && key(options.supplier) !== key(SUPPLIER)) {
    throw new Error(`Legacy Colour cleanup is restricted to supplier ${SUPPLIER}.`);
  }
}

function aliases(value) {
  return sortedUnique([value?.documentId, value?.id].map((item) => String(item || '').trim()));
}

function pairKey(fabricKey, colourKey) {
  return `${fabricKey}|${colourKey}`;
}

function resolveAlias(aliasMap, value) {
  for (const alias of aliases(value)) {
    if (aliasMap.has(alias)) return aliasMap.get(alias);
  }
  return entityKey(value);
}

function fabricFilters(options = {}) {
  const filters = { brand: { name: { $eqi: SUPPLIER } } };
  if (String(options.fabricName || '').trim()) filters.name = { $eqi: String(options.fabricName).trim() };
  return filters;
}

async function loadCleanupState(strapi, options = {}) {
  assertScope(options);
  const fabrics = await strapi.entityService.findMany(FABRIC_UID, {
    filters: fabricFilters(options),
    populate: ['brand', 'colours'],
    sort: ['documentId:asc'],
    limit: QUERY_LIMIT,
  });

  const targetFabrics = (fabrics || []).filter((fabric) => key(fabric?.brand?.name) === key(SUPPLIER));
  const targetColourDocumentIds = sortedUnique(targetFabrics.flatMap((fabric) => (fabric.colours || []).map((colour) => colour.documentId)));
  const targetColourIds = sortedUnique(targetFabrics.flatMap((fabric) => (fabric.colours || []).map((colour) => colour.id)));
  const colourFilters = targetColourDocumentIds.length
    ? { documentId: { $in: targetColourDocumentIds } }
    : (targetColourIds.length ? { id: { $in: targetColourIds } } : null);

  const colours = colourFilters
    ? await strapi.entityService.findMany(COLOUR_UID, {
      filters: colourFilters,
      populate: ['fabrics'],
      sort: ['documentId:asc'],
      limit: QUERY_LIMIT,
    })
    : [];
  const identities = await strapi.entityService.findMany(IDENTITY_UID, {
    populate: ['fabric', 'promotedColour'],
    sort: ['documentId:asc'],
    limit: QUERY_LIMIT,
  });

  return { targetFabrics, colours: colours || [], identities: identities || [] };
}

function buildCleanupPlan(state, options = {}) {
  const fabricAliasMap = new Map();
  const colourAliasMap = new Map();
  const targetFabricMap = new Map();
  const colourMap = new Map();

  for (const fabric of state.targetFabrics || []) {
    const canonical = entityKey(fabric);
    targetFabricMap.set(canonical, fabric);
    for (const alias of aliases(fabric)) fabricAliasMap.set(alias, canonical);
  }
  for (const colour of state.colours || []) {
    const canonical = entityKey(colour);
    colourMap.set(canonical, colour);
    for (const alias of aliases(colour)) colourAliasMap.set(alias, canonical);
  }

  const targetPairs = new Map();
  for (const fabric of state.targetFabrics || []) {
    const fabricKey = resolveAlias(fabricAliasMap, fabric);
    for (const relation of fabric.colours || []) {
      const colourKey = resolveAlias(colourAliasMap, relation);
      if (!colourKey) continue;
      targetPairs.set(pairKey(fabricKey, colourKey), { fabricKey, colourKey });
    }
  }

  const protectedPairs = new Set();
  const protectedColours = new Set();
  for (const identity of state.identities || []) {
    if (!identity?.promotedColour || !identity?.fabric) continue;
    const colourKey = resolveAlias(colourAliasMap, identity.promotedColour);
    const fabricKey = resolveAlias(fabricAliasMap, identity.fabric);
    if (!colourKey || !fabricKey) continue;
    protectedColours.add(colourKey);
    protectedPairs.add(pairKey(fabricKey, colourKey));
  }

  const candidateByColour = new Map();
  let protectedAssociations = 0;
  for (const target of targetPairs.values()) {
    if (protectedPairs.has(pairKey(target.fabricKey, target.colourKey))) {
      protectedAssociations += 1;
      continue;
    }
    if (!candidateByColour.has(target.colourKey)) candidateByColour.set(target.colourKey, []);
    candidateByColour.get(target.colourKey).push(target.fabricKey);
  }

  const results = [];
  for (const [colourKey, candidateFabricKeys] of candidateByColour.entries()) {
    const colour = colourMap.get(colourKey);
    if (!colour) continue;
    const allFabricKeys = sortedUnique((colour.fabrics || []).map((fabric) => resolveAlias(fabricAliasMap, fabric)));
    const candidateKeys = sortedUnique(candidateFabricKeys);
    const remainingFabricKeys = allFabricKeys.filter((fabricKey) => !candidateKeys.includes(fabricKey));
    const mayDeleteRecord = remainingFabricKeys.length === 0 && !protectedColours.has(colourKey);
    const targetFabrics = candidateKeys.map((fabricKey) => targetFabricMap.get(fabricKey)).filter(Boolean);
    results.push({
      operationKey: `${mayDeleteRecord ? 'delete_colour' : 'disconnect_fabrics'}|${colourKey}|${candidateKeys.join(',')}`,
      action: mayDeleteRecord ? 'delete_colour' : 'disconnect_fabrics',
      colourId: colour.id,
      colourDocumentId: colour.documentId || null,
      colourName: colour.name || null,
      colourUpdatedAt: colour.updatedAt || null,
      targetFabrics: targetFabrics.map((fabric) => ({
        id: fabric.id,
        documentId: fabric.documentId || null,
        name: fabric.name || null,
      })).sort((a, b) => entityKey(a).localeCompare(entityKey(b))),
      remainingFabricCount: remainingFabricKeys.length,
      identityLinkedElsewhere: protectedColours.has(colourKey),
      mediaPreserved: true,
    });
  }
  results.sort((a, b) => a.operationKey.localeCompare(b.operationKey));

  const candidateAssociations = results.reduce((sum, result) => sum + result.targetFabrics.length, 0);
  const scope = {
    supplier: SUPPLIER,
    fabricName: String(options.fabricName || '').trim() || null,
  };
  const summary = {
    fabricsScanned: (state.targetFabrics || []).length,
    colourAssociationsFound: targetPairs.size,
    identityLinkedAssociationsPreserved: protectedAssociations,
    unlinkedAssociationsToRemove: candidateAssociations,
    colourRecordsToDelete: results.filter((result) => result.action === 'delete_colour').length,
    sharedColourRecordsToDisconnect: results.filter((result) => result.action === 'disconnect_fabrics').length,
    mediaRecordsToDelete: 0,
  };
  const snapshot = {
    scope,
    summary,
    results: results.map((result) => ({
      operationKey: result.operationKey,
      action: result.action,
      colourId: result.colourId,
      colourDocumentId: result.colourDocumentId,
      colourUpdatedAt: result.colourUpdatedAt,
      targetFabrics: result.targetFabrics,
      remainingFabricCount: result.remainingFabricCount,
      identityLinkedElsewhere: result.identityLinkedElsewhere,
    })),
  };
  return {
    scope,
    summary,
    results,
    operationKeys: results.map((result) => result.operationKey),
    planFingerprint: stableFingerprint(snapshot),
    planExpiresAt: new Date(Date.now() + PLAN_TTL_MS).toISOString(),
    committed: false,
  };
}

async function previewCleanup(strapi, options = {}) {
  return buildCleanupPlan(await loadCleanupState(strapi, options), options);
}

async function applyCleanup(strapi, options = {}) {
  assertScope(options);
  if (options.confirm !== true) throw new Error('Explicit confirmation is required to remove unlinked legacy Colours.');
  if (!options.planFingerprint) throw new Error('Preview the legacy Colour cleanup before applying it.');
  if (options.planExpiresAt && Date.parse(options.planExpiresAt) <= Date.now()) {
    throw new Error('The legacy Colour cleanup preview has expired. Run the preview again.');
  }

  const current = await previewCleanup(strapi, options);
  if (current.planFingerprint !== options.planFingerprint) {
    throw new Error('The legacy Colour cleanup preview is stale because Colour, Fabric, or identity relations changed. Run the preview again.');
  }
  const approvedKeys = sortedUnique(options.operationKeys || []);
  if (approvedKeys.join('|') !== sortedUnique(current.operationKeys).join('|')) {
    throw new Error('The legacy Colour cleanup scope no longer matches the approved preview. Run the preview again.');
  }
  if (!strapi.db?.transaction) throw new Error('Legacy Colour cleanup requires the Strapi database transaction service.');

  const committedResults = await strapi.db.transaction(async ({ trx }) => {
    const output = [];
    for (const operation of current.results) {
      if (operation.action === 'delete_colour') {
        await strapi.entityService.delete(COLOUR_UID, operation.colourId || operation.colourDocumentId, { transacting: trx });
      } else {
        await strapi.entityService.update(COLOUR_UID, operation.colourId || operation.colourDocumentId, {
          data: {
            fabrics: {
              disconnect: operation.targetFabrics.map((fabric) => mutationId(fabric)),
            },
          },
          transacting: trx,
        });
      }
      output.push({ ...operation, committed: true });
    }
    return output;
  });

  return {
    committed: true,
    scope: current.scope,
    summary: {
      ...current.summary,
      operationsCommitted: committedResults.length,
    },
    results: committedResults,
  };
}

module.exports = {
  applyCleanup,
  buildCleanupPlan,
  previewCleanup,
};
