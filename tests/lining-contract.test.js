require('../../node_modules/ts-node/register')

const test = require('node:test')
const assert = require('node:assert/strict')
const { calculateMadeToMeasureQuote } = require('../src/api/storefront/services/made-to-measure')

const record = (key, data = {}) => ({ id: key, documentId: key, key, active: true, is_configurator_option: true, ...data })

function fakeStrapi(records) {
  return {
    entityService: {
      findMany: async (uid, params = {}) => {
        const values = records[uid] || []
        const requested = params.filters?.$and?.find(item => item.$or)?.$or?.flatMap(item => Object.values(item)) || []
        return requested.length
          ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId))
          : values
      },
    },
  }
}

function catalogue({ liningColourKey = 'white', liningColourCompatible = 'lined' } = {}) {
  return {
    'api::fabric.fabric': [record('fabric-1', { price_per_metre: 20, usable_width_cm: 140 })],
    'api::blind-type.blind-type': [record('stacked', { name: 'Stacked', applies_to_blinds: true })],
    'api::lining.lining': [
      record('lined', { display_name: 'Standard Lining', liningType: 'Standard Lining', price_per_metre: 9, applies_to_blinds: true }),
      record('interlined', { display_name: 'Interlining', liningType: 'Interlining', price_per_metre: 10, applies_to_blinds: true }),
      record('blackout', { display_name: 'Blackout Lining', liningType: 'Blackout Lining', price_per_metre: 9, blackout: true, applies_to_blinds: true }),
    ],
    'api::lining-colour.lining-colour': [
      record(liningColourKey, { display_name: liningColourKey === 'pale-ivory' ? 'Pale Ivory' : 'White', applies_to_blinds: true, compatible_lining_types: [record(liningColourCompatible)] }),
    ],
    'api::mechanisation.mechanisation': [record('corded-left', { name: 'Corded Left', price: 20 })],
    'api::mechanism-finish.mechanism-finish': [record('chrome', { display_name: 'Chrome', compatible_mechanisations: [] })],
    'api::pricing-rule.pricing-rule': [record('blind-rule', { product_type: 'blind', formula: { workmanshipFee: 85 } })],
  }
}

test('blind quote accepts standard lining, optional interlining, and mechanism finish', async () => {
  const quote = await calculateMadeToMeasureQuote(fakeStrapi(catalogue()), {
    items: [{
      madeToMeasureV2: true,
      productType: 'blind',
      fabricId: 'fabric-1',
      quantity: 1,
      measurements: { width: 100, height: 100 },
      blindTypeId: 'stacked',
      liningTypeKey: 'lined',
      liningColourKey: 'white',
      interliningTypeKey: 'interlined',
      mechanismKey: 'corded-left',
      mechanismFinishKey: 'chrome',
    }],
    shipping: '0.00',
  })

  assert.equal(quote.items[0].selectedOptions.liningType.key, 'lined')
  assert.equal(quote.items[0].selectedOptions.interliningType.key, 'interlined')
  assert.equal(quote.items[0].selectedOptions.mechanismFinish.key, 'chrome')
  assert.equal(quote.breakdown.accessories.find(item => item.type === 'lining').unitPricePence, 900)
  assert.equal(quote.breakdown.accessories.find(item => item.type === 'interlining').unitPricePence, 1000)
})

test('optional interlining applies its pricing rule on top of the normal lining and making charges', async () => {
  const records = catalogue()
  records['api::lining.lining'][1].pricing_rule = {
    formula: {
      steps: [
        { inputs: [2], output: 'totalInterlining_m', operation: 'constant' },
        { inputs: ['totalInterlining_m', 'interlining.price_per_metre'], output: 'interliningMaterialCost', operation: 'multiply' },
        { inputs: [15], output: 'interliningWorkmanshipTotal', operation: 'constant' },
        { inputs: ['interliningMaterialCost', 'interliningWorkmanshipTotal'], output: 'totalInterliningPrice', operation: 'add' },
      ],
      finalOutput: 'totalInterliningPrice',
    },
  }

  const quote = await calculateMadeToMeasureQuote(fakeStrapi(records), {
    items: [{
      madeToMeasureV2: true,
      productType: 'blind',
      fabricId: 'fabric-1',
      quantity: 1,
      measurements: { width: 100, height: 100 },
      blindTypeId: 'stacked',
      liningTypeKey: 'lined',
      liningColourKey: 'white',
      interliningTypeKey: 'interlined',
    }],
    shipping: '0.00',
  })

  assert.equal(quote.breakdown.makingCharge[0].totalPence, 8500)
  assert.equal(quote.breakdown.accessories.find(item => item.type === 'lining').totalPence, 1620)
  assert.equal(quote.breakdown.accessories.find(item => item.type === 'interlining').totalPence, 2000)
  assert.equal(quote.breakdown.accessories.find(item => item.type === 'interlining_workmanship').totalPence, 1500)
})

test('blind quote accepts active legacy mechanisms without configurator flag', async () => {
  const records = catalogue()
  records['api::mechanisation.mechanisation'] = [{
    id: 'corded-left',
    documentId: 'corded-left',
    key: 'corded-left',
    name: 'Corded Left',
    price: 20,
  }]

  const quote = await calculateMadeToMeasureQuote(fakeStrapi(records), {
    items: [{
      madeToMeasureV2: true,
      productType: 'blind',
      fabricId: 'fabric-1',
      quantity: 1,
      measurements: { width: 100, height: 100 },
      blindTypeId: 'stacked',
      liningTypeKey: 'lined',
      liningColourKey: 'white',
      mechanismKey: 'corded-left',
    }],
    shipping: '0.00',
  })

  assert.equal(quote.items[0].selectedOptions.mechanism.key, 'corded-left')

  records['api::mechanisation.mechanisation'][0].active = false
  await assert.rejects(
    () => calculateMadeToMeasureQuote(fakeStrapi(records), {
      items: [{
        madeToMeasureV2: true,
        productType: 'blind',
        fabricId: 'fabric-1',
        quantity: 1,
        measurements: { width: 100, height: 100 },
        blindTypeId: 'stacked',
        liningTypeKey: 'lined',
        liningColourKey: 'white',
        mechanismKey: 'corded-left',
      }],
      shipping: '0.00',
    }),
    error => error.name === 'MadeToMeasureValidationError' && error.issues.some(issue => issue.field === 'mechanism'),
  )
})

test('curtain and blind quotes reject missing or standalone interlining', async () => {
  const strapi = fakeStrapi(catalogue())
  const base = {
    madeToMeasureV2: true,
    productType: 'blind',
    fabricId: 'fabric-1',
    quantity: 1,
    measurements: { width: 100, height: 100 },
    blindTypeId: 'stacked',
  }

  await assert.rejects(
    () => calculateMadeToMeasureQuote(strapi, { items: [base], shipping: '0.00' }),
    error => error.name === 'MadeToMeasureValidationError' && error.issues.some(issue => issue.field === 'liningType'),
  )

  await assert.rejects(
    () => calculateMadeToMeasureQuote(strapi, { items: [{ ...base, liningTypeKey: 'interlined', liningColourKey: undefined }], shipping: '0.00' }),
    error => error.name === 'MadeToMeasureValidationError' && error.issues.some(issue => issue.field === 'liningType'),
  )
})

test('blackout colour validation follows its relation instead of the global colour list', async () => {
  const strapi = fakeStrapi(catalogue({ liningColourKey: 'pale-ivory', liningColourCompatible: 'blackout' }))
  const valid = await calculateMadeToMeasureQuote(strapi, {
    items: [{
      madeToMeasureV2: true,
      productType: 'blind',
      fabricId: 'fabric-1',
      quantity: 1,
      measurements: { width: 100, height: 100 },
      blindTypeId: 'stacked',
      liningTypeKey: 'blackout',
      liningColourKey: 'pale-ivory',
    }],
    shipping: '0.00',
  })
  assert.equal(valid.items[0].selectedOptions.liningType.key, 'blackout')

  await assert.rejects(
    () => calculateMadeToMeasureQuote(fakeStrapi(catalogue({ liningColourKey: 'ivory', liningColourCompatible: 'lined' })), {
      items: [{
        madeToMeasureV2: true,
        productType: 'blind',
        fabricId: 'fabric-1',
        quantity: 1,
        measurements: { width: 100, height: 100 },
        blindTypeId: 'stacked',
        liningTypeKey: 'blackout',
        liningColourKey: 'ivory',
      }],
      shipping: '0.00',
    }),
    error => error.name === 'MadeToMeasureValidationError' && error.issues.some(issue => issue.field === 'liningColour'),
  )
})
