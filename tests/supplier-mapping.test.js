'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const mapping = require('../src/plugins/order-management/server/services/supplier-mapping');

const brand = { documentId: 'ashley-brand', name: 'Ashley Wilde' };

function document(fabrics) {
  return { schemaVersion: 1, supplier: 'Ashley Wilde', mappingVersion: 'test-1', source: 'focused test', fabrics };
}

function colour(supplierColourCode, officialColourName, internalColourCode = supplierColourCode, extra = {}) {
  return { supplierColourCode, fabricColourCode: `${extra.supplierProductCode || ''}${supplierColourCode}`, officialColourName, internalColourCode, evidenceStatus: 'verified_manual', ...extra };
}

function harness({ fabrics = [], colourCodes = [], registry = [], active = null } = {}) {
  const writes = [];
  const strapi = {
    entityService: {
      async findMany(uid, options = {}) {
        if (uid === 'api::fabric.fabric') return fabrics;
        if (uid === 'api::color-code.color-code') return colourCodes;
        if (uid === 'api::canonical-colour-registry.canonical-colour-registry') return registry;
        if (uid === 'api::supplier-mapping-import.supplier-mapping-import') return active ? [active] : [];
        if (uid === 'api::supplier-fabric-colour-mapping.supplier-fabric-colour-mapping') return active?.mappingRows || [];
        return [];
      },
      async create(uid, options) { writes.push({ operation: 'create', uid, data: options.data }); return { id: writes.length, documentId: `created-${writes.length}`, ...options.data }; },
      async update(uid, id, options) { writes.push({ operation: 'update', uid, id, data: options.data }); return { id, documentId: active?.documentId || 'import-1', ...options.data }; },
    },
    documents(uid) {
      assert.equal(uid, 'api::supplier-mapping-import.supplier-mapping-import');
      return { async findOne() { return active; } };
    },
    db: { async transaction(callback) { return callback({ trx: {} }); } },
  };
  return { strapi, writes };
}

function fabric(documentId, name, supplierProductCode, productId = `FAB-${supplierProductCode}-1`) {
  return { documentId, name, productId, brand };
}

test('supplier colour codes stay product-scoped across fabrics, including MI → Mist and MI → Maize', async () => {
  const { strapi } = harness({
    fabrics: [fabric('fabric-mist', 'Mist Fabric', 'MISTFAB'), fabric('fabric-maize', 'Maize Fabric', 'MAIZEFAB')],
    colourCodes: [{ code: 'MI', name: 'Mist' }],
  });
  const preview = await mapping.validateDocument(strapi, document([
    { fabricName: 'Mist Fabric', supplierProductCode: 'MISTFAB', colours: [colour('MI', 'Mist', 'MI', { supplierProductCode: 'MISTFAB' })] },
    { fabricName: 'Maize Fabric', supplierProductCode: 'MAIZEFAB', colours: [colour('MI', 'Maize', 'MI', { supplierProductCode: 'MAIZEFAB' })] },
  ]));
  assert.equal(preview.validationSummary.valid, true);
  assert.deepEqual(preview.rows.map((row) => [row.fabricDocumentId, row.supplierColourCode, row.fabricColourCode]), [
    ['fabric-mist', 'MI', 'MISTFABMI'],
    ['fabric-maize', 'MI', 'MAIZEFABMI'],
  ]);
  assert.equal(preview.rows[0].internalColourCode, 'MI');
  assert.equal(preview.rows[1].internalColourCode, 'MA');
  assert.equal(preview.rows[1].reconciliationReason, 'submitted_code_belongs_to_different_canonical_colour');
  assert.equal(preview.issues.some((issue) => /already assigned/.test(issue.message)), false);
});

test('existing canonical codes are reused and provisional submitted conflicts are reconciled', async () => {
  const { strapi } = harness({
    fabrics: [fabric('fabric-sage', 'Sage Fabric', 'SAGEFAB')],
    colourCodes: [{ code: 'SA', name: 'Sage 602' }],
    registry: [{ canonicalColourName: 'Sage', normalizedColourName: 'sage', internalColourCode: 'SAG', normalizedInternalCode: 'SAG', status: 'approved' }],
  });
  const preview = await mapping.validateDocument(strapi, document([{ fabricName: 'Sage Fabric', supplierProductCode: 'SAGEFAB', colours: [colour('SA', 'Sage', 'SA', { supplierProductCode: 'SAGEFAB' })] }]));
  assert.equal(preview.validationSummary.valid, true);
  assert.equal(preview.rows[0].internalColourCode, 'SAG');
  assert.equal(preview.rows[0].reconciliationReason, 'submitted_code_belongs_to_different_canonical_colour');
  assert.equal(preview.validationSummary.approvedCodeReconciliations, 1);
});

test('new internal code allocation is deterministic and stable on rerun', async () => {
  const options = { fabrics: [fabric('fabric-quasar', 'Quasar Fabric', 'QUASARFAB')], colourCodes: [{ code: 'MI', name: 'Mist' }] };
  const input = document([{ fabricName: 'Quasar Fabric', supplierProductCode: 'QUASARFAB', colours: [colour('MI', 'Quasar', 'MI', { supplierProductCode: 'QUASARFAB' })] }]);
  const first = await mapping.validateDocument(harness(options).strapi, input);
  const second = await mapping.validateDocument(harness(options).strapi, input);
  assert.equal(first.validationSummary.valid, true);
  assert.equal(first.rows[0].internalColourCode, 'QU');
  assert.equal(first.rows[0].internalColourCode, second.rows[0].internalColourCode);
  assert.equal(first.rows[0].reconciliationReason, 'submitted_code_belongs_to_different_canonical_colour');
});

test('missing and ambiguous Fabrics block activation without blocking preview resolution of other rows', async () => {
  const { strapi } = harness({
    fabrics: [fabric('fabric-ok', 'Resolved Fabric', 'OKFAB'), fabric('amb-a', 'Ambiguous Fabric', 'OTHER'), fabric('amb-b', 'Ambiguous Fabric', 'OTHER2')],
  });
  const preview = await mapping.validateDocument(strapi, document([
    { fabricName: 'Resolved Fabric', supplierProductCode: 'OKFAB', colours: [colour('OK', 'Ocean', 'OC', { supplierProductCode: 'OKFAB' })] },
    { fabricName: 'Ambiguous Fabric', supplierProductCode: 'NOT-USED', colours: [colour('MI', 'Mist', 'MI', { supplierProductCode: 'NOT-USED' })] },
    { fabricName: 'Missing Fabric', supplierProductCode: 'MISSING', colours: [colour('MI', 'Mist', 'MI', { supplierProductCode: 'MISSING' })] },
  ]));
  assert.equal(preview.validationSummary.resolvedFabrics, 1);
  assert.equal(preview.validationSummary.ambiguousFabrics, 1);
  assert.equal(preview.validationSummary.missingFabrics, 1);
  assert.equal(preview.rows.length, 3);
  assert.equal(preview.validationSummary.valid, false);
  assert.deepEqual(preview.validationSummary.missingFabricDetails[0], { fabricIndex: 2, fabricName: 'Missing Fabric', supplierProductCode: 'MISSING' });
});

test('only an exact product-scoped contradictory identity blocks validation', async () => {
  const { strapi } = harness({ fabrics: [fabric('fabric-one', 'One Fabric', 'ONE')] });
  const preview = await mapping.validateDocument(strapi, document([{ fabricName: 'One Fabric', supplierProductCode: 'ONE', colours: [
    colour('MI', 'Mist', 'MI', { supplierProductCode: 'ONE' }),
    colour('MI', 'Maize', 'MI', { supplierProductCode: 'ONE' }),
  ] }]));
  assert.equal(preview.issues.filter((issue) => issue.type === 'mapping_identity_conflict').length, 1);
  assert.equal(preview.validationSummary.valid, false);
});

test('activation writes only mapping and registry records and never Colour, Media, Fabric relation, or staging records', async () => {
  const input = document([{ fabricName: 'Activate Fabric', supplierProductCode: 'ACTIVATE', colours: [colour('MI', 'Mist', 'MI', { supplierProductCode: 'ACTIVATE' })] }]);
  const active = { id: 7, documentId: 'import-1', supplier: 'Ashley Wilde', status: 'ready', isActive: false, sourcePayload: input };
  const { strapi, writes } = harness({ fabrics: [fabric('fabric-activate', 'Activate Fabric', 'ACTIVATE')], active });
  const result = await mapping.applyMapping(strapi, { request: { body: { importDocumentId: 'import-1', confirm: true } }, state: {} });
  assert.equal(result.activated, true);
  assert.equal(writes.some((write) => write.uid === 'api::colour.colour'), false);
  assert.equal(writes.some((write) => write.uid === 'api::fabric-colour-asset.fabric-colour-asset'), false);
  assert.equal(writes.some((write) => write.uid === 'api::fabric.fabric'), false);
  assert.equal(writes.some((write) => write.uid === 'api::fabric-colour-identity.fabric-colour-identity'), false);
  assert.ok(writes.some((write) => write.uid === 'api::supplier-fabric-colour-mapping.supplier-fabric-colour-mapping'));
  assert.ok(writes.some((write) => write.uid === 'api::canonical-colour-registry.canonical-colour-registry'));
  assert.ok(writes.some((write) => write.uid === 'api::supplier-mapping-import.supplier-mapping-import'));
});
