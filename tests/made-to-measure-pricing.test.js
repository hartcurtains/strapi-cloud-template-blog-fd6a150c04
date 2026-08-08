require('../../node_modules/ts-node/register')

const test = require('node:test')
const assert = require('node:assert/strict')
const { calculateMadeToMeasureQuote, calculateOrderQuote } = require('../src/api/storefront/services/made-to-measure')

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

test('curtain quote evaluates heading-based workmanship from the database rule', async () => {
  const fabric = record('fabric-1', { price_per_metre: 29, usable_width_cm: 140 })
  const records = {
    'api::fabric.fabric': [fabric],
    'api::curtain-type.curtain-type': [record('eyelet', { name: 'Eyelet', fullness_multiplier: 2 })],
    'api::lining.lining': [record('lined', { liningType: 'Full Lining', price_per_metre: 7, applies_to_curtains: true })],
    'api::lining-colour.lining-colour': [record('white', { display_name: 'White', applies_to_curtains: true, compatible_lining_types: [record('lined')] })],
    'api::pricing-rule.pricing-rule': [record('curtain-rule', {
      product_type: 'curtain',
      formula: {
        steps: [
          { name: 'Calculate Fullness Width', inputs: ['width_cm', 'curtain_type.fullness_multiplier'], output: 'fullnessWidth_cm', operation: 'multiply' },
          { name: 'Number of Fabric Widths', inputs: ['fullnessWidth_cm', 'fabric.usableWidth_cm'], output: 'widthsNeeded', operation: 'divide' },
          { name: 'Round Fabric Widths with Threshold', inputs: ['widthsNeeded', 0.2], output: 'roundedWidths', operation: 'customRound' },
          {
            name: 'Determine Workmanship Multiplier',
            condition: "curtain_heading.name == 'Pencil Pleat'",
            operation: 'if_else',
            on_true: { input: 75, output: 'workmanshipMultiplier', operation: 'set' },
            on_false: {
              condition: "curtain_heading.name == 'Wave'",
              operation: 'if_else',
              on_true: { input: 80, output: 'workmanshipMultiplier', operation: 'set' },
              on_false: { input: 85, output: 'workmanshipMultiplier', operation: 'set' },
            },
          },
          { name: 'Workmanship Cost', inputs: ['roundedWidths', 'workmanshipMultiplier'], output: 'workmanshipCost', operation: 'multiply' },
        ],
      },
    })],
  }
  const strapi = { entityService: { findMany: async (uid, params = {}) => {
    const values = records[uid] || []
    const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || []
    return requested.length ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId)) : values
  } } }

  const quote = await calculateMadeToMeasureQuote(strapi, { items: [{
    madeToMeasureV2: true, productType: 'curtain', fabricId: 'fabric-1', quantity: 1,
    measurements: { width: 150, height: 100 }, curtainTypeId: 'eyelet', liningTypeKey: 'lined', liningColourKey: 'white',
  }], shipping: '0.00' })

  // 150cm x 2 fullness / 140cm = 2.14 widths; the 0.2 threshold rounds to 2.
  // Eyelet uses the fallback £85 multiplier, so workmanship is £170.
  assert.equal(quote.breakdown.makingCharge[0].totalPence, 17000)
  assert.equal(quote.breakdown.totalPence, quote.breakdown.fabric[0].totalPence + quote.breakdown.accessories[0].totalPence + 17000)
})

test('interlining rule workmanship replaces the standard curtain making charge', async () => {
  const fabric = record('fabric-1', { price_per_metre: 20, usable_width_cm: 140 })
  const interliningPricingRule = {
    formula: {
      steps: [
        { name: 'Calculate Fullness Width', inputs: ['width_cm', 'curtain_type.fullness_multiplier'], output: 'fullnessWidth_cm', operation: 'multiply' },
        { name: 'Number of Fabric Widths', inputs: ['fullnessWidth_cm', 'fabric.usableWidth_cm'], output: 'widthsNeeded', operation: 'divide' },
        { name: 'Round Fabric Widths with Threshold', inputs: ['widthsNeeded', 0.2], output: 'roundedWidths', operation: 'customRound' },
        { name: 'Cut Length with Allowance', inputs: ['height_cm', 30], output: 'cutLength_cm', operation: 'add' },
        { name: 'Total Interlining Needed (cm)', inputs: ['roundedWidths', 'cutLength_cm'], output: 'totalInterlining_cm', operation: 'multiply' },
        { name: 'Convert cm to metres', inputs: ['totalInterlining_cm', 100], output: 'totalInterlining_m', operation: 'divide' },
        { name: 'Interlining Material Cost', inputs: ['totalInterlining_m', 'interlining.price_per_metre'], output: 'interliningMaterialCost', operation: 'multiply' },
        { name: 'Interlining Workmanship - Width Base', inputs: ['roundedWidths', 120], output: 'interliningWorkmanshipWidth', operation: 'multiply' },
        { name: 'Interlining Workmanship - Length Base', inputs: ['totalInterlining_m', 10], output: 'interliningWorkmanshipLength', operation: 'multiply' },
        { name: 'Total Interlining Workmanship', inputs: ['interliningWorkmanshipWidth', 'interliningWorkmanshipLength'], output: 'interliningWorkmanshipTotal', operation: 'add' },
        { name: 'Total Interlining Price', inputs: ['interliningMaterialCost', 'interliningWorkmanshipTotal'], output: 'totalInterliningPrice', operation: 'add' },
      ],
      finalOutput: 'totalInterliningPrice',
    },
  }
  const records = {
    'api::fabric.fabric': [fabric],
    'api::curtain-type.curtain-type': [record('eyelet', { name: 'Eyelet', fullness_multiplier: 2 })],
    'api::lining.lining': [record('interlined', { liningType: 'Interlining', price_per_metre: null, pricing_rule: interliningPricingRule, applies_to_curtains: true })],
    'api::lining-colour.lining-colour': [record('white', { display_name: 'White', applies_to_curtains: true, compatible_lining_types: [record('interlined')] })],
    'api::pricing-rule.pricing-rule': [record('curtain-rule', { product_type: 'curtain', formula: { workmanshipFee: 170 } })],
  }
  const strapi = { entityService: { findMany: async (uid, params = {}) => {
    const values = records[uid] || []
    const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || []
    return requested.length ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId)) : values
  } } }

  const quote = await calculateMadeToMeasureQuote(strapi, { items: [{
    madeToMeasureV2: true, productType: 'curtain', fabricId: 'fabric-1', quantity: 1,
    measurements: { width: 150, height: 100 }, curtainTypeId: 'eyelet', liningTypeKey: 'interlined', liningColourKey: 'white',
  }], shipping: '0.00' })

  const lining = quote.breakdown.accessories.find(item => item.type === 'lining')
  assert.equal(lining.totalPence, 26600)
  assert.equal(quote.breakdown.makingCharge[0].totalPence, 0)
  assert.equal(quote.breakdown.totalPence, quote.breakdown.fabric[0].totalPence + lining.totalPence)
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

test('server re-quote reads visual lining options from the validated configuration snapshot', async () => {
  const fabric = record('fabric-1', { price_per_metre: 20, usable_width_cm: 140 })
  const records = {
    'api::fabric.fabric': [fabric],
    'api::curtain-type.curtain-type': [record('pencil', { fullness_multiplier: 2 })],
    'api::lining.lining': [record('lined', { liningType: 'Lined', price_per_metre: 7, applies_to_curtains: true })],
    'api::lining-colour.lining-colour': [record('white', { display_name: 'White', applies_to_curtains: true, compatible_lining_types: [record('lined')] })],
    'api::pricing-rule.pricing-rule': [record('curtain-rule', { product_type: 'curtain', formula: { workmanshipFee: 0 } })],
  }
  const strapi = { entityService: { findMany: async (uid, params = {}) => {
    const values = records[uid] || []
    const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || []
    return requested.length ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId)) : values
  } } }

  const quote = await calculateMadeToMeasureQuote(strapi, { items: [{
    productType: 'curtain', fabricId: 'fabric-1', quantity: 1,
    measurements: { width: 200, height: 200 }, curtainTypeId: 'pencil',
    configuration: { liningTypeKey: 'lined', liningColourKey: 'white' },
  }], shipping: '0.00' })

  assert.ok(quote.breakdown.accessories.some(item => item.type === 'lining'))
  assert.equal(quote.items[0].selectedOptions.liningType.key, 'lined')
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

test('blind quote accepts legacy mechanisms without mechanism_family metadata', async () => {
  const fabric = record('fabric-1', { price_per_metre: 20, usable_width_cm: 140 })
  const records = {
    'api::fabric.fabric': [fabric],
    'api::blind-type.blind-type': [record('stacked', { name: 'Stacked', applies_to_blinds: true })],
    'api::mechanisation.mechanisation': [record('corded-left', { name: 'Corded left', price: 20 })],
    'api::pricing-rule.pricing-rule': [record('blind-rule', { product_type: 'blind', formula: { workmanshipFee: 85 } })],
  }
  const strapi = { entityService: { findMany: async (uid, params = {}) => {
    const values = records[uid] || []
    const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || []
    return requested.length ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId)) : values
  } } }

  const quote = await calculateMadeToMeasureQuote(strapi, { items: [{
    madeToMeasureV2: true, productType: 'blind', fabricId: 'fabric-1', quantity: 1,
    measurements: { width: 123, height: 121 }, blindTypeId: 'stacked', mechanismKey: 'corded-left',
  }], shipping: '0.00' })

  assert.equal(quote.items[0].selectedOptions.mechanism.key, 'corded-left')
  const mechanism = quote.breakdown.accessories.find(item => item.type === 'mechanism')
  assert.equal(mechanism.unitPricePence, 2000)
  assert.equal(mechanism.totalPence, 2000)
})

test('blind quote includes workmanship emitted by the database pricing-rule steps', async () => {
  const fabric = record('fabric-1', { price_per_metre: 20, usable_width_cm: 140 })
  const records = {
    'api::fabric.fabric': [fabric],
    'api::blind-type.blind-type': [record('stacked', { name: 'Stacked', applies_to_blinds: true })],
    'api::pricing-rule.pricing-rule': [record('blind-rule', {
      product_type: 'blind',
      formula: {
        steps: [
          { name: 'Workmanship Cost', operation: 'constant', inputs: [85], output: 'workmanshipCost' },
          { name: 'Total Cost', operation: 'add', inputs: ['fabricCost', 'workmanshipCost'], output: 'totalPrice' },
        ],
        finalOutput: 'totalPrice',
      },
    })],
  }
  const strapi = { entityService: { findMany: async (uid, params = {}) => {
    const values = records[uid] || []
    const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || []
    return requested.length ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId)) : values
  } } }

  const quote = await calculateMadeToMeasureQuote(strapi, { items: [{
    madeToMeasureV2: true, productType: 'blind', fabricId: 'fabric-1', quantity: 1,
    measurements: { width: 100, height: 100 }, blindTypeId: 'stacked',
  }], shipping: '0.00' })

  assert.equal(quote.breakdown.makingCharge[0].totalPence, 8500)
  assert.equal(quote.breakdown.totalPence, quote.breakdown.fabric[0].totalPence + 8500)
})

test('no lining is a valid zero-cost option without a lining colour', async () => {
  const fabric = record('fabric-1', { price_per_metre: 20, usable_width_cm: 140 })
  const records = {
    'api::fabric.fabric': [fabric],
    'api::blind-type.blind-type': [record('stacked', { name: 'Stacked', applies_to_blinds: true })],
    'api::lining.lining': [record('no-lining', {
      liningType: 'No lining', display_name: 'No lining', price_per_metre: 0,
      applies_to_blinds: true, applies_to_curtains: true,
    })],
    'api::pricing-rule.pricing-rule': [record('blind-rule', { product_type: 'blind', formula: { workmanshipFee: 85 } })],
  }
  const strapi = { entityService: { findMany: async (uid, params = {}) => {
    const values = records[uid] || []
    const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || []
    return requested.length ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId)) : values
  } } }

  const quote = await calculateMadeToMeasureQuote(strapi, { items: [{
    madeToMeasureV2: true, productType: 'blind', fabricId: 'fabric-1', quantity: 1,
    measurements: { width: 100, height: 100 }, blindTypeId: 'stacked', liningTypeKey: 'no-lining',
  }], shipping: '0.00' })

  assert.equal(quote.items[0].selectedOptions.liningType, undefined)
  assert.equal(quote.breakdown.accessories.some(item => item.type === 'lining'), false)
  assert.equal(quote.breakdown.totalPence, quote.breakdown.fabric[0].totalPence + 8500)
})

test('blind quote scales lining pricing-rule costs per unit with quantity', async () => {
  const fabric = record('fabric-1', { price_per_metre: 20, usable_width_cm: 140 })
  const liningPricingRule = {
    formula: {
      steps: [
        { inputs: ['interlining.price_per_metre', 2], output: 'materialCost', operation: 'multiply' },
        { inputs: ['materialCost', 5], output: 'totalInterliningPrice', operation: 'add' },
      ],
      finalOutput: 'totalInterliningPrice',
    },
  }
  const records = {
    'api::fabric.fabric': [fabric],
    'api::blind-type.blind-type': [record('stacked', { name: 'Stacked', applies_to_blinds: true })],
    'api::mechanisation.mechanisation': [record('corded-left', { name: 'Corded left', price: 20 })],
    'api::lining.lining': [record('interlined', {
      liningType: 'Interlining', price_per_metre: 7, pricing_rule: liningPricingRule, applies_to_blinds: true,
    })],
    'api::lining-colour.lining-colour': [record('cream', {
      display_name: 'Cream', applies_to_blinds: true, compatible_lining_types: [record('interlined')],
    })],
    'api::pricing-rule.pricing-rule': [record('blind-rule', { product_type: 'blind', formula: { workmanshipFee: 85 } })],
  }
  const strapi = { entityService: { findMany: async (uid, params = {}) => {
    const values = records[uid] || []
    const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || []
    return requested.length ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId)) : values
  } } }
  const baseItem = {
    madeToMeasureV2: true, productType: 'blind', fabricId: 'fabric-1',
    measurements: { width: 100, height: 100 }, blindTypeId: 'stacked', mechanismKey: 'corded-left',
    liningTypeKey: 'interlined', liningColourKey: 'cream',
  }

  const quoteOne = await calculateMadeToMeasureQuote(strapi, { items: [{ ...baseItem, quantity: 1 }], shipping: '0.00' })
  const quoteTwo = await calculateMadeToMeasureQuote(strapi, { items: [{ ...baseItem, quantity: 2 }], shipping: '0.00' })
  const liningOne = quoteOne.breakdown.accessories.find(item => item.type === 'lining')
  const liningTwo = quoteTwo.breakdown.accessories.find(item => item.type === 'lining')

  assert.equal(liningOne.totalPence, 1900)
  assert.equal(liningTwo.totalPence, liningOne.totalPence * 2)
  assert.equal(quoteTwo.breakdown.totalPence, quoteOne.breakdown.totalPence * 2)
})

test('cushion quote resolves size, piping and pad from the server catalogue', async () => {
  const fabric = record('fabric-1', { price_per_metre: 20, usable_width_cm: 140 })
  const records = {
    'api::fabric.fabric': [fabric],
    'api::cushion-size.cushion-size': [record('square', { name: 'Square', width_cm: 38, height_cm: 38, shape: 'square' })],
    'api::cushion-piping.cushion-piping': [record('piped', { name: 'Piped', type: 'piped', price: 3 })],
    // A legacy generic value must not make Cover Only a paid add-on.
    'api::cushion-pad.cushion-pad': [record('cover-only', { name: 'Cover only', type: 'cover_only', price: 15 })],
    'api::pricing-rule.pricing-rule': [record('cushion-rule', { product_type: 'cushion', formula: { workmanshipFee: 0 } })],
  }
  const strapi = { entityService: { findMany: async (uid, params = {}) => {
    const values = records[uid] || []
    const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || []
    return requested.length ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId)) : values
  } } }

  const quote = await calculateMadeToMeasureQuote(strapi, { items: [{
    madeToMeasureV2: true, productType: 'cushion', fabricId: 'fabric-1', quantity: 1,
    measurements: { width: 38, height: 38 }, cushionSizeKey: 'square', cushionFinishKey: 'piped', cushionPadKey: 'cover-only',
  }], shipping: '0.00' })

  assert.equal(quote.items[0].selectedOptions.cushionSize.width_cm, 38)
  assert.equal(quote.items[0].selectedOptions.cushionFinish.unitPricePence, 300)
  assert.equal(quote.items[0].selectedOptions.cushionPad.type, 'cover_only')
  assert.ok(quote.breakdown.accessories.some(item => item.type === 'cushion_finish' && item.totalPence === 300))
  assert.equal(quote.breakdown.accessories.find(item => item.type === 'cushion_pad').totalPence, 0)
})

test('cushion quote evaluates the database rule for fabric, piping, pad and workmanship', async () => {
  const fabric = record('fabric-1', { price_per_metre: 34, usable_width_cm: 140 })
  const records = {
    'api::fabric.fabric': [fabric],
    'api::cushion-size.cushion-size': [record('square', {
      name: 'Square 38cm', width_cm: 38, height_cm: 38, shape: 'square', workmanship_cost: 25, duck_feather_surcharge: 10,
    })],
    'api::cushion-piping.cushion-piping': [record('piped', { name: 'Piped', type: 'piped', price: 3 })],
    // The generic pad price is intentionally zero; Duck Feather is priced by
    // the selected size's surcharge.
    'api::cushion-pad.cushion-pad': [record('duck', { name: 'Duck feather pad', type: 'duck_feather', price: 0 })],
    'api::pricing-rule.pricing-rule': [record('cushion-rule', {
      product_type: 'cushion',
      formula: {
        steps: [
          { inputs: ['size.fabric_metres', 'fabric.price_per_metre'], output: 'fabricCost', operation: 'multiply' },
          { inputs: ['cushion_piping_type.price'], output: 'pipingCost', operation: 'set' },
          { inputs: ['cushion_pad.price'], output: 'padCost', operation: 'set' },
          { inputs: ['size.workmanship_cost'], output: 'workmanshipCost', operation: 'set' },
          { inputs: ['fabricCost', 'pipingCost', 'padCost', 'workmanshipCost'], output: 'totalPrice', operation: 'add' },
        ],
        finalOutput: 'totalPrice',
      },
    })],
  }
  const strapi = { entityService: { findMany: async (uid, params = {}) => {
    const values = records[uid] || []
    const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || []
    return requested.length ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId)) : values
  } } }

  const quote = await calculateMadeToMeasureQuote(strapi, { items: [{
    madeToMeasureV2: true, productType: 'cushion', fabricId: 'fabric-1', quantity: 1,
    measurements: { width: 38, height: 38 }, cushionSizeKey: 'square', cushionFinishKey: 'piped', cushionPadKey: 'duck',
  }], shipping: '0.00' })

  // 0.1444m² × £34 = £4.91, + £3 piping, + £10 legacy duck surcharge,
  // + £25 workmanship = £42.91.
  assert.equal(quote.breakdown.fabric[0].totalPence, 491)
  assert.equal(quote.breakdown.accessories.find(item => item.type === 'cushion_finish').totalPence, 300)
  assert.equal(quote.breakdown.accessories.find(item => item.type === 'cushion_pad').totalPence, 1000)
  assert.equal(quote.breakdown.makingCharge[0].totalPence, 2500)
  assert.equal(quote.breakdown.totalPence, 4291)
  assert.equal(quote.breakdown.total, '42.91')
})

test('duck feather pad pricing follows the selected size surcharge', async () => {
  const records = {
    'api::fabric.fabric': [record('fabric-1', { price_per_metre: 34 })],
    'api::cushion-size.cushion-size': [
      record('square-38', { name: 'Square 38cm', width_cm: 38, height_cm: 38, shape: 'square', duck_feather_surcharge: 10, workmanship_cost: 25 }),
      record('square-45', { name: 'Square 45cm', width_cm: 45, height_cm: 45, shape: 'square', duck_feather_surcharge: 12, workmanship_cost: 25 }),
      record('square-50', { name: 'Square 50cm', width_cm: 50, height_cm: 50, shape: 'square', duck_feather_surcharge: 14, workmanship_cost: 25 }),
    ],
    'api::cushion-piping.cushion-piping': [record('unpiped', { name: 'Unpiped', type: 'unpiped', price: 0 })],
    'api::cushion-pad.cushion-pad': [record('duck', { name: 'Duck feather pad', type: 'duck_feather', price: 0 })],
    'api::pricing-rule.pricing-rule': [record('cushion-rule', {
      product_type: 'cushion',
      formula: {
        steps: [
          { inputs: ['size.fabric_metres', 'fabric.price_per_metre'], output: 'fabricCost', operation: 'multiply' },
          { inputs: ['cushion_piping_type.price'], output: 'pipingCost', operation: 'set' },
          { inputs: ['cushion_pad.price'], output: 'padCost', operation: 'set' },
          { inputs: ['size.workmanship_cost'], output: 'workmanshipCost', operation: 'set' },
          { inputs: ['fabricCost', 'pipingCost', 'padCost', 'workmanshipCost'], output: 'totalPrice', operation: 'add' },
        ],
        finalOutput: 'totalPrice',
      },
    })],
  }
  const strapi = { entityService: { findMany: async (uid, params = {}) => {
    const values = records[uid] || []
    const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || []
    return requested.length ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId)) : values
  } } }

  for (const [sizeKey, expectedPence] of [['square-38', 1000], ['square-45', 1200], ['square-50', 1400]]) {
    const quote = await calculateMadeToMeasureQuote(strapi, { items: [{
      madeToMeasureV2: true, productType: 'cushion', fabricId: 'fabric-1', quantity: 1,
      measurements: { width: 50, height: 50 }, cushionSizeKey: sizeKey, cushionFinishKey: 'unpiped', cushionPadKey: 'duck',
    }], shipping: '0.00' })
    assert.equal(quote.breakdown.accessories.find(item => item.type === 'cushion_pad').totalPence, expectedPence)
  }
})

test('mixed blind and cushion order quotes re-resolve persisted canonical selections', async () => {
  const records = {
    'api::fabric.fabric': [record('fabric-1', { price_per_metre: 20, usable_width_cm: 140 })],
    'api::blind-type.blind-type': [record('blind-1', { name: 'Stacked', applies_to_blinds: true })],
    'api::mechanisation.mechanisation': [record('mech-1', { name: 'Corded left', price: 20 })],
    'api::cushion-size.cushion-size': [record('size-1', { name: 'Square 38cm', width_cm: 38, height_cm: 38, shape: 'square', workmanship_cost: 25 })],
    'api::cushion-piping.cushion-piping': [record('piping-1', { name: 'Piped', type: 'piped', price: 3 })],
    'api::cushion-pad.cushion-pad': [record('pad-1', { name: 'Cover only', type: 'cover_only', price: 0 })],
    'api::pricing-rule.pricing-rule': [
      record('blind-rule', { product_type: 'blind', formula: { workmanshipFee: 85 } }),
      record('cushion-rule', { product_type: 'cushion', formula: { workmanshipFee: 25 } }),
    ],
  }
  const strapi = { entityService: { findMany: async (uid, params = {}) => {
    const values = records[uid] || []
    const productType = params.filters?.product_type
    if (productType) return values.filter(item => item.product_type === productType)
    const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || []
    return requested.length ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId)) : values
  } } }

  const quote = await calculateOrderQuote(strapi, {
    items: [
      {
        madeToMeasureV2: true, productType: 'blinds', fabricId: 'fabric-1', quantity: 1,
        measurements: { width: 123, height: 121 }, blindTypeId: 'blind-1', mechanismKey: 'mech-1',
        configuration: { madeToMeasureV2: true, blindTypeId: 'blind-1', mechanismKey: 'mech-1' },
      },
      {
        madeToMeasureV2: true, productType: 'cushions', fabricId: 'fabric-1', quantity: 1,
        measurements: { width: 38, height: 38 }, cushionSizeKey: 'size-1', cushionFinishKey: 'piping-1', cushionPadKey: 'pad-1',
        configuration: { madeToMeasureV2: true, cushionSizeKey: 'size-1', cushionFinishKey: 'piping-1', cushionPadKey: 'pad-1' },
      },
    ],
    shipping: '10.00',
  })

  assert.equal(quote.items.length, 2)
  assert.equal(quote.items[0].selectedOptions.mechanism.key, 'mech-1')
  assert.equal(quote.items[1].selectedOptions.cushionSize.key, 'size-1')
  assert.equal(quote.items[1].selectedOptions.cushionFinish.key, 'piping-1')
  assert.equal(quote.items[1].selectedOptions.cushionPad.key, 'pad-1')
  assert.equal(quote.breakdown.totalPence, quote.breakdown.subtotalPence + quote.breakdown.shippingPence)
  assert.equal(quote.breakdown.subtotalPence, quote.breakdown.madeToMeasure.lines.reduce((sum, line) => sum + line.totalPence, 0))
})
