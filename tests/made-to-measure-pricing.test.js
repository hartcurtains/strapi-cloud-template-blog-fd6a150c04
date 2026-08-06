require('../../node_modules/ts-node/register')

const test = require('node:test')
const assert = require('node:assert/strict')
const { calculateMadeToMeasureQuote } = require('../src/api/storefront/services/made-to-measure')

const record = (key, data = {}) => ({ id: key, documentId: key, key, active: true, is_configurator_option: true, ...data })

test('lining price uses unformatted calculated fabric metres at 700 pence per metre', async () => {
  const fabric = record('fabric-1', { price_per_metre: 20, usable_width_cm: 140, pattern_repeat_cm: 64 })
  const records = {
    'api::fabric.fabric': [fabric],
    'api::curtain-type.curtain-type': [record('pencil', { fullness_multiplier: 2 })],
    'api::lining.lining': [record('lined', { liningType: 'Lined', price_per_metre: 7, applies_to_curtains: true, applies_to_blinds: true })],
    'api::lining-colour.lining-colour': [record('white', { display_name: 'White', applies_to_curtains: true, applies_to_blinds: true, compatible_lining_types: [record('lined')] })],
    'api::pricing-rule.pricing-rule': [record('curtain-rule', { product_type: 'curtain', formula: { workmanshipFee: 0 } })],
  }
  const strapi = { entityService: { findMany: async (uid, params = {}) => {
    const values = records[uid] || []
    const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || []
    return requested.length ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId)) : values
  } } }

  const quote = await calculateMadeToMeasureQuote(strapi, { items: [{
    madeToMeasureV2: true, productType: 'curtain', fabricId: 'fabric-1', quantity: 1,
    measurements: { width: 200, height: 200 }, curtainTypeId: 'pencil', liningTypeKey: 'lined', liningColourKey: 'white',
  }], shipping: '0.00' })

  // 200cm × 2 fullness / 140cm = 2.857 widths => 3; (200 + 30)cm
  // rounds to 256cm on a 64cm repeat; 3 × 256cm = 7.68m.
  assert.equal(quote.items[0].calculatedQuantity.materialMetres, 7.68)
  const lining = quote.breakdown.accessories.find(item => item.type === 'lining')
  assert.equal(lining.quantity, 7.68)
  assert.equal(lining.unitPricePence, 700)
  assert.equal(lining.totalPence, 5376)
  assert.equal(lining.total, '53.76')
})

test('blackout lining adds its own metre-based accessory cost while keeping the selected lining', async () => {
  const fabric = record('fabric-1', { price_per_metre: 20, usable_width_cm: 140, pattern_repeat_cm: 64 })
  const records = {
    'api::fabric.fabric': [fabric],
    'api::curtain-type.curtain-type': [record('pencil', { fullness_multiplier: 2 })],
    'api::lining.lining': [
      record('lined', { liningType: 'Lined', price_per_metre: 7, applies_to_curtains: true, applies_to_blinds: true }),
      record('blackout', { liningType: 'Blackout Lining', price_per_metre: 3.5, blackout: true, applies_to_curtains: true, applies_to_blinds: true }),
    ],
    'api::lining-colour.lining-colour': [record('white', { display_name: 'White', applies_to_curtains: true, applies_to_blinds: true, compatible_lining_types: [record('lined')] })],
    'api::pricing-rule.pricing-rule': [record('curtain-rule', { product_type: 'curtain', formula: { workmanshipFee: 0 } })],
  }
  const strapi = { entityService: { findMany: async (uid, params = {}) => {
    const values = records[uid] || []
    const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || []
    return requested.length ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId)) : values
  } } }

  const quote = await calculateMadeToMeasureQuote(strapi, { items: [{
    madeToMeasureV2: true, productType: 'curtain', fabricId: 'fabric-1', quantity: 1,
    measurements: { width: 200, height: 200 }, curtainTypeId: 'pencil', liningTypeKey: 'lined', liningColourKey: 'white', blackoutLining: true,
  }], shipping: '0.00' })

  assert.equal(quote.items[0].selectedOptions.liningType.key, 'lined')
  assert.equal(quote.items[0].selectedOptions.liningColour.key, 'white')
  const blackout = quote.breakdown.accessories.find(item => item.type === 'blackout_lining')
  assert.equal(blackout.quantity, 7.68)
  assert.equal(blackout.unitPricePence, 350)
  assert.equal(blackout.totalPence, 2688)
  assert.equal(blackout.total, '26.88')
})

test('blackout lining requires a selected lining type and colour', async () => {
  const fabric = record('fabric-1', { price_per_metre: 20, usable_width_cm: 140 })
  const records = {
    'api::fabric.fabric': [fabric],
    'api::curtain-type.curtain-type': [record('pencil', { fullness_multiplier: 2 })],
    'api::lining.lining': [record('blackout', { liningType: 'Blackout Lining', price_per_metre: 3.5, blackout: true, applies_to_curtains: true })],
    'api::lining-colour.lining-colour': [record('white', { display_name: 'White', applies_to_curtains: true })],
    'api::pricing-rule.pricing-rule': [record('curtain-rule', { product_type: 'curtain', formula: { workmanshipFee: 0 } })],
  }
  const strapi = { entityService: { findMany: async (uid, params = {}) => {
    const values = records[uid] || []
    const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || []
    return requested.length ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId)) : values
  } } }

  await assert.rejects(
    () => calculateMadeToMeasureQuote(strapi, { items: [{
      madeToMeasureV2: true, productType: 'curtain', fabricId: 'fabric-1', quantity: 1,
      measurements: { width: 200, height: 200 }, curtainTypeId: 'pencil', blackoutLining: true,
    }], shipping: '0.00' }),
    error => {
      assert.equal(error.name, 'MadeToMeasureValidationError')
      assert.ok(error.issues.some(issue => issue.field === 'blackoutLining'))
      return true
    }
  )
})

test('blackout resolves for a legacy lining record keyed blackout-lining without is_configurator_option', async () => {
  const fabric = record('fabric-1', { price_per_metre: 20, usable_width_cm: 140, pattern_repeat_cm: 64 })
  const records = {
    'api::fabric.fabric': [fabric],
    'api::curtain-type.curtain-type': [record('pencil', { fullness_multiplier: 2 })],
    'api::lining.lining': [
      record('lined', { liningType: 'Lined', price_per_metre: 7, applies_to_curtains: true, applies_to_blinds: true }),
      record('blackout-lining', { liningType: 'Blackout Lining', price_per_metre: 7, blackout: false, is_configurator_option: false, applies_to_curtains: true, applies_to_blinds: true }),
    ],
    'api::lining-colour.lining-colour': [record('white', { display_name: 'White', applies_to_curtains: true, applies_to_blinds: true, compatible_lining_types: [record('lined')] })],
    'api::pricing-rule.pricing-rule': [record('curtain-rule', { product_type: 'curtain', formula: { workmanshipFee: 0 } })],
  }
  const strapi = { entityService: { findMany: async (uid, params = {}) => {
    const values = records[uid] || []
    const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || []
    return requested.length ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId)) : values
  } } }

  const quote = await calculateMadeToMeasureQuote(strapi, { items: [{
    madeToMeasureV2: true, productType: 'curtain', fabricId: 'fabric-1', quantity: 1,
    measurements: { width: 200, height: 200 }, curtainTypeId: 'pencil', liningTypeKey: 'lined', liningColourKey: 'white', blackoutLining: true,
  }], shipping: '0.00' })

  const blackout = quote.breakdown.accessories.find(item => item.type === 'blackout_lining')
  assert.equal(quote.items[0].selectedOptions.blackoutLining.key, 'blackout-lining')
  assert.equal(blackout.unitPricePence, 700)
  assert.equal(blackout.totalPence, 5376)
})

test('fabric lookup does not filter on a key attribute the fabric schema lacks', async () => {
  const fabric = { id: 'fabric-1', documentId: 'fabric-1', price_per_metre: 20, usable_width_cm: 140, pattern_repeat_cm: 64 }
  const records = {
    'api::fabric.fabric': [fabric],
    'api::curtain-type.curtain-type': [record('pencil', { fullness_multiplier: 2 })],
    'api::lining.lining': [record('lined', { liningType: 'Lined', price_per_metre: 7, applies_to_curtains: true, applies_to_blinds: true })],
    'api::lining-colour.lining-colour': [record('white', { display_name: 'White', applies_to_curtains: true, applies_to_blinds: true, compatible_lining_types: [record('lined')] })],
    'api::pricing-rule.pricing-rule': [record('curtain-rule', { product_type: 'curtain', formula: { workmanshipFee: 0 } })],
  }
  const models = {
    'api::fabric.fabric': { attributes: { id: { type: 'integer' }, documentId: { type: 'string' }, price_per_metre: {}, usable_width_cm: {} } },
    'api::curtain-type.curtain-type': { attributes: { key: {}, id: {}, documentId: {} } },
    'api::lining.lining': { attributes: { key: {}, id: {}, documentId: {} } },
    'api::lining-colour.lining-colour': { attributes: { key: {}, id: {}, documentId: {} } },
    'api::pricing-rule.pricing-rule': { attributes: { id: {}, product_type: {} } },
  }
  const strapi = {
    getModel: uid => models[uid] || { attributes: { key: {}, id: {}, documentId: {} } },
    entityService: { findMany: async (uid, params = {}) => {
      const values = records[uid] || []
      const or = params.filters?.$and?.find(item => item.$or)?.$or || []
      // The fabric content type has no key attribute; sending a key filter
      // would make Strapi throw and 500 the whole quote request.
      if (uid === 'api::fabric.fabric' && or.some(item => Object.keys(item)[0] === 'key')) {
        throw new Error('key filter must not be applied to fabric')
      }
      const requested = or.map(item => Object.values(item)[0]) || []
      return requested.length ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId)) : values
    } },
  }

  const quote = await calculateMadeToMeasureQuote(strapi, { items: [{
    madeToMeasureV2: true, productType: 'curtain', fabricId: 'fabric-1', quantity: 1,
    measurements: { width: 200, height: 200 }, curtainTypeId: 'pencil', liningTypeKey: 'lined', liningColourKey: 'white',
  }], shipping: '0.00' })

  assert.equal(quote.items[0].fabric.documentId, 'fabric-1')
  assert.ok(quote.breakdown.accessories.some(item => item.type === 'lining'))
})
