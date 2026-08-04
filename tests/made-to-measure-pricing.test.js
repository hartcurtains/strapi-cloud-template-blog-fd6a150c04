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
  const strapi = { entityService: { findMany: async (uid) => records[uid] || [] } }

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
