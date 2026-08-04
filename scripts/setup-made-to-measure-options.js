'use strict';

/*
 * Idempotent made-to-measure option setup.
 *
 * Dry-run is the default. --apply is an explicit administrative action and
 * uses Strapi entity services only; this file never opens the database.
 */
const path = require('node:path');
const { createStrapi } = require('@strapi/strapi');

const PROJECT_ROOT = path.resolve(__dirname, '..');

const records = [
  { uid: 'api::lining.lining', key: 'lined', data: { key: 'lined', liningType: 'Full lining', display_name: 'Full lining', active: true, sort_order: 10, is_configurator_option: true, applies_to_curtains: true, applies_to_blinds: true } },
  { uid: 'api::lining.lining', key: 'interlined', data: { key: 'interlined', liningType: 'Interlined', display_name: 'Interlined', active: true, sort_order: 20, is_configurator_option: true, applies_to_curtains: true, applies_to_blinds: true } },
  { uid: 'api::lining.lining', key: 'blackout', data: { key: 'blackout', liningType: 'Blackout Lining', display_name: 'Blackout Lining', blackout: true, active: true, sort_order: 30, is_configurator_option: true, applies_to_curtains: true, applies_to_blinds: true } },
  ...[
    ['white', 'White', '#ffffff', 10], ['pale-ivory', 'Pale Ivory', '#f5f0dd', 20], ['ivory', 'Ivory', '#ece4ca', 30], ['cream', 'Cream', '#e8d8ad', 40],
  ].map(([key, display_name, hex, sort_order]) => ({ uid: 'api::lining-colour.lining-colour', key, data: { key, display_name, hex, active: true, sort_order, applies_to_curtains: true, applies_to_blinds: true } })),
  { uid: 'api::blind-type.blind-type', key: 'stacked', data: { key: 'stacked', name: 'Stacked', display_name: 'Stacked', active: true, sort_order: 10, is_configurator_option: true } },
  { uid: 'api::blind-type.blind-type', key: 'waterfall', data: { key: 'waterfall', name: 'Waterfall', display_name: 'Waterfall', active: true, sort_order: 20, is_configurator_option: true } },
  { uid: 'api::mechanisation.mechanisation', key: 'corded-left', data: { key: 'corded-left', name: 'Corded Left', display_name: 'Corded Left', price: 0, active: true, sort_order: 10, is_configurator_option: true, mechanism_family: 'corded' } },
  { uid: 'api::mechanisation.mechanisation', key: 'corded-right', data: { key: 'corded-right', name: 'Corded Right', display_name: 'Corded Right', price: 0, active: true, sort_order: 20, is_configurator_option: true, mechanism_family: 'corded' } },
  { uid: 'api::mechanism-finish.mechanism-finish', key: 'chrome', data: { key: 'chrome', display_name: 'Chrome', active: true, sort_order: 10 } },
  { uid: 'api::mechanism-finish.mechanism-finish', key: 'brass', data: { key: 'brass', display_name: 'Brass', active: true, sort_order: 20 } },
  { uid: 'api::cushion-piping.cushion-piping', key: 'piped', data: { key: 'piped', name: 'Piped', type: 'piped', price: 0, active: true, sort_order: 10 } },
  { uid: 'api::cushion-piping.cushion-piping', key: 'unpiped', data: { key: 'unpiped', name: 'Unpiped', type: 'unpiped', price: 0, active: true, sort_order: 20 } },
  ...[
    ['square-38cm', 'Square 38cm', 'square', 38, 38, 10, 10],
    ['square-45cm', 'Square 45cm', 'square', 45, 45, 12, 20],
    ['square-50cm', 'Square 50cm', 'square', 50, 50, 14, 30],
    ['square-55cm', 'Square 55cm', 'square', 55, 55, 16, 40],
    ['square-60cm', 'Square 60cm', 'square', 60, 60, 18, 50],
    ['rectangle-30x45cm', 'Rectangle 30cm × 45cm', 'rectangular', 30, 45, 20, 60],
    ['rectangle-38x50cm', 'Rectangle 38cm × 50cm', 'rectangular', 38, 50, 22, 70],
  ].map(([key, name, shape, width_cm, height_cm, duck_feather_surcharge, sort_order]) => ({ uid: 'api::cushion-size.cushion-size', key, data: { key, name, shape, width_cm, height_cm, duck_feather_surcharge, active: true, sort_order } })),
  { uid: 'api::cushion-pad.cushion-pad', key: 'duck-feather-pad', data: { key: 'duck-feather-pad', name: 'Duck Feather Pad', type: 'duck_feather', price: 0, active: true, sort_order: 10 } },
  { uid: 'api::cushion-pad.cushion-pad', key: 'cover-only', data: { key: 'cover-only', name: 'Cover Only', type: 'cover_only', price: 0, active: true, sort_order: 20 } },
  { uid: 'api::made-to-measure-configuration.made-to-measure-configuration', key: 'curtain', data: { key: 'curtain', product_type: 'curtain', display_name: 'Made-to-measure curtains', active: true, delivery_lead_time: '4-6 weeks', delivery_message: 'Delivery for made to measure curtains: 4-6 weeks.', disabled_option_categories: ['trimmings', 'curtain_poles', 'curtain_tracks'], pricing_version: 'mtm-2026-08-03-v1' } },
  { uid: 'api::made-to-measure-configuration.made-to-measure-configuration', key: 'blind', data: { key: 'blind', product_type: 'blind', display_name: 'Made-to-measure blinds', active: true, delivery_lead_time: '4-6 weeks', delivery_message: 'Delivery for made to measure blinds: 4-6 weeks.', disabled_option_categories: ['trimmings'], pricing_version: 'mtm-2026-08-03-v1' } },
  { uid: 'api::made-to-measure-configuration.made-to-measure-configuration', key: 'cushion', data: { key: 'cushion', product_type: 'cushion', display_name: 'Made-to-measure cushions', active: true, delivery_lead_time: '4–6 weeks', disabled_option_categories: [], pricing_version: 'mtm-2026-08-03-v1' } },
  { uid: 'api::made-to-measure-configuration.made-to-measure-configuration', key: 'fabric-sample', data: { key: 'fabric-sample', product_type: 'fabric_sample', display_name: 'Fabric samples', active: true, delivery_message: 'UK delivery in 3–5 working days.', delivery_returns_copy: null, disabled_option_categories: [], sample_max_quantity: 5, pricing_version: 'sample-cap-2026-08-03-v1' } },
];

async function findByKey(strapi, uid, key) {
  const found = await strapi.entityService.findMany(uid, { filters: { key }, limit: 1 });
  return Array.isArray(found) ? found[0] || null : null;
}

const legacyLiningNames = {
  lined: ['full lining', 'lined'],
  interlined: ['interlining', 'interlined'],
};

function normaliseLiningName(value) {
  return String(value || '').trim().toLowerCase();
}

async function findLegacyLining(strapi, key) {
  const names = legacyLiningNames[key] || [];
  if (!names.length) return null;
  const found = await strapi.entityService.findMany('api::lining.lining', { limit: 200 });
  return Array.isArray(found)
    ? found.find(item => item.active !== false && !item.key && names.includes(normaliseLiningName(item.liningType))) || null
    : null;
}

async function findExisting(strapi, record) {
  const keyed = await findByKey(strapi, record.uid, record.key);
  if (keyed) return keyed;
  if (record.uid === 'api::lining.lining') return findLegacyLining(strapi, record.key);
  return null;
}

async function reconcileLegacyLining(strapi, record, apply) {
  if (record.uid !== 'api::lining.lining') return null;
  const keyed = await findByKey(strapi, record.uid, record.key);
  const legacy = await findLegacyLining(strapi, record.key);
  if (!legacy || !keyed || legacy.id === keyed.id) return null;

  if (!apply) return { action: 'would-migrate', key: record.key, fromId: legacy.id, disableId: keyed.id };

  // Preserve the earlier keyed record, but take it out of the live option set
  // so the manually priced legacy record becomes the single canonical option.
  await strapi.entityService.update(record.uid, keyed.id, {
    data: { key: null, active: false, is_configurator_option: false },
  });
  const migrated = await strapi.entityService.update(record.uid, legacy.id, { data: record.data });
  return { action: 'migrated', key: record.key, fromId: legacy.id, disableId: keyed.id, id: migrated.id };
}

async function retireLegacyBlackoutColour(strapi, apply) {
  const legacy = await findByKey(strapi, 'api::lining-colour.lining-colour', 'blackout-lining');
  if (!legacy || legacy.active === false) return null;
  if (!apply) return { action: 'would-retire', key: 'blackout-lining', id: legacy.id };
  await strapi.entityService.update('api::lining-colour.lining-colour', legacy.id, { data: { active: false } });
  return { action: 'retired', key: 'blackout-lining', id: legacy.id };
}

async function upsert(strapi, record, apply) {
  const existing = await findExisting(strapi, record);
  if (existing) {
    const updateData = Object.fromEntries(Object.entries(record.data).filter(([field]) => field !== 'thumbnail'));
    const hasChanges = Object.entries(updateData).some(([field, value]) => JSON.stringify(existing[field] ?? null) !== JSON.stringify(value ?? null));
    if (!hasChanges) return { ...record, action: 'exists', id: existing.id, documentId: existing.documentId || null };
    if (!apply) return { ...record, action: 'would-update', id: existing.id, documentId: existing.documentId || null };
    const updated = await strapi.entityService.update(record.uid, existing.id, { data: updateData });
    return { ...record, action: 'updated', id: updated.id, documentId: updated.documentId || null };
  }
  if (!apply) return { ...record, action: 'would-create' };
  const created = await strapi.entityService.create(record.uid, { data: { ...record.data, publishedAt: new Date().toISOString() } });
  return { ...record, action: 'created', id: created.id, documentId: created.documentId || null };
}

async function connectRelation(strapi, uid, key, relation, relatedRecords, apply) {
  if (!apply) return;
  const record = await findByKey(strapi, uid, key);
  if (!record) throw new Error(`Cannot connect ${uid}:${key}; record was not created/found.`);
  await strapi.entityService.update(uid, record.id, {
    data: { [relation]: { connect: relatedRecords.map(item => item.id).filter(Boolean) } },
  });
}

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes('--apply');
  const unsupported = argv.filter(flag => !['--apply', '--dry-run'].includes(flag));
  if (unsupported.length) throw new Error(`Unknown option(s): ${unsupported.join(', ')}`);
  const app = createStrapi({ appDir: PROJECT_ROOT, distDir: path.join(PROJECT_ROOT, 'dist') });
  await app.register();
  await app.bootstrap();
  try {
    const migrations = [];
    for (const record of records.filter(item => item.uid === 'api::lining.lining')) {
      const migration = await reconcileLegacyLining(app, record, apply);
      if (migration) migrations.push(migration);
    }
    const retiredBlackoutColour = await retireLegacyBlackoutColour(app, apply);
    if (retiredBlackoutColour) migrations.push(retiredBlackoutColour);
    const results = [];
    for (const record of records) results.push(await upsert(app, record, apply));
    const byKey = new Map(results.filter(item => item.id).map(item => [item.key, item]));
    const liningTypes = ['lined', 'interlined', 'blackout'].map(key => byKey.get(key)).filter(Boolean);
    const cordedMechanisms = ['corded-left', 'corded-right'].map(key => byKey.get(key)).filter(Boolean);
    for (const key of ['white', 'pale-ivory', 'ivory', 'cream']) await connectRelation(app, 'api::lining-colour.lining-colour', key, 'compatible_lining_types', liningTypes, apply);
    for (const key of ['chrome', 'brass']) await connectRelation(app, 'api::mechanism-finish.mechanism-finish', key, 'compatible_mechanisations', cordedMechanisms, apply);
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', migrations, created: results.filter(item => item.action === 'created').map(item => `${item.uid}:${item.key}`), updated: results.filter(item => item.action === 'updated').map(item => `${item.uid}:${item.key}`), wouldUpdate: results.filter(item => item.action === 'would-update').map(item => `${item.uid}:${item.key}`), existing: results.filter(item => item.action === 'exists').map(item => `${item.uid}:${item.key}`), records: records.length }, null, 2));
    return results;
  } finally {
    await app.destroy();
  }
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { main, records };
