require('../../node_modules/ts-node/register')

const test = require('node:test')
const assert = require('node:assert/strict')
const { calculateMadeToMeasureQuote, calculateOrderQuote, calculatePinchPleatPricing } = require('../src/api/storefront/services/made-to-measure')

const record = (key, data = {}) => ({ id: key, documentId: key, key, active: true, is_configurator_option: true, ...data })

const cushionPricingFormula = {
  steps: [
    { inputs: ['width_cm', 3], output: 'faceCutWidth_cm', operation: 'add' },
    { inputs: ['height_cm', 3], output: 'faceCutLength_cm', operation: 'add' },
    { inputs: ['faceCutWidth_cm', 2], output: 'twoFacePanelsWidth_cm', operation: 'multiply' },
    {
      condition: 'fabric.usableWidth_cm >= twoFacePanelsWidth_cm',
      operation: 'if_else',
      on_true: { operation: 'set', inputs: [1], output: 'facePanelRows' },
      on_false: { operation: 'set', inputs: [2], output: 'facePanelRows' },
      output: 'facePanelRows',
    },
    {
      condition: 'fabric.patternRepeat_cm > 0',
      operation: 'if_else',
      on_true: {
        sub_steps: [
          { inputs: ['faceCutLength_cm', 'fabric.patternRepeat_cm'], output: 'patternRepeatCount', operation: 'ceilDivide' },
          { inputs: ['patternRepeatCount', 'fabric.patternRepeat_cm'], output: 'cushionCutLength_cm', operation: 'multiply' },
        ],
      },
      on_false: { operation: 'set', inputs: ['faceCutLength_cm'], output: 'cushionCutLength_cm' },
      output: 'cushionCutLength_cm',
    },
    { inputs: ['facePanelRows', 'cushionCutLength_cm'], output: 'cushionFabricCutLength_cm', operation: 'multiply' },
    { inputs: ['cushionFabricCutLength_cm', 100], output: 'cushionFabricMetres', operation: 'divide' },
    { inputs: ['cushionFabricMetres', 'fabric.price_per_metre'], output: 'fabricCost', operation: 'multiply' },
    { inputs: ['cushion_piping_type.price'], output: 'pipingCost', operation: 'set' },
    { inputs: ['cushion_pad.price'], output: 'padCost', operation: 'set' },
    { inputs: ['size.workmanship_cost'], output: 'workmanshipCost', operation: 'set' },
    { inputs: ['fabricCost', 'pipingCost', 'padCost', 'workmanshipCost'], output: 'totalPrice', operation: 'add' },
  ],
  finalOutput: 'totalPrice',
}

const pinchPleatPricingFormula = {
  steps: [
    { inputs: ['width_cm', 55], output: 'numberOfWidths', operation: 'ceilDivide' },
    { inputs: ['height_cm', 30], output: 'dropWithAllowance_cm', operation: 'add' },
    { inputs: ['dropWithAllowance_cm', 'fabric.patternRepeat_cm'], output: 'cutLengthCm', operation: 'add' },
    { inputs: ['cutLengthCm', 100], output: 'cutLengthMetres', operation: 'divide' },
    { inputs: ['cutLengthMetres', 'numberOfWidths'], output: 'rawFabricMetres', operation: 'multiply' },
    { inputs: ['rawFabricMetres', 2], output: 'halfMetreUnits', operation: 'multiply' },
    { inputs: ['halfMetreUnits'], output: 'roundedHalfMetreUnits', operation: 'ceil' },
    { inputs: ['roundedHalfMetreUnits', 2], output: 'roundedFabricMetres', operation: 'divide' },
    { inputs: ['roundedFabricMetres', 'fabric.price_per_metre'], output: 'fabricCost', operation: 'multiply' },
    { inputs: ['numberOfWidths', 95], output: 'baseWorkmanship', operation: 'multiply' },
    {
      condition: 'interlining.price_per_metre > 0',
      operation: 'if_else',
      on_true: {
        sub_steps: [
          { inputs: ['roundedFabricMetres', 'interlining.price_per_metre'], output: 'interliningMaterialCost', operation: 'multiply' },
          { inputs: ['numberOfWidths', 25], output: 'interliningWorkmanship', operation: 'multiply' },
          { inputs: ['numberOfWidths', 120], output: 'totalWorkmanship', operation: 'multiply' },
        ],
      },
      on_false: {
        sub_steps: [
          { inputs: [0], output: 'interliningMaterialCost', operation: 'set' },
          { inputs: [0], output: 'interliningWorkmanship', operation: 'set' },
          { inputs: ['baseWorkmanship'], output: 'totalWorkmanship', operation: 'set' },
        ],
      },
      output: 'workmanshipBranch',
    },
    { inputs: ['totalWorkmanship'], output: 'workmanshipCost', operation: 'set' },
    { inputs: ['fabricCost', 'interliningMaterialCost', 'totalWorkmanship'], output: 'totalPrice', operation: 'add' },
  ],
  finalOutput: 'totalPrice',
}

const pinchPleatFixtures = ({ dedicatedRule = null, draftDedicated = false } = {}) => {
  const fabric = record('fabric-1', { price_per_metre: 20, usable_width_cm: 140, pattern_repeat_cm: 17.5 })
  const sharedRule = record('curtain-rule', { name: 'Curtain', product_type: 'curtain', formula: { workmanshipFee: 17 } })
  const standardLining = record('lined', {
    liningType: 'Standard Lining', price_per_metre: 7, applies_to_curtains: true,
  })
  const interlining = record('interlined', {
    liningType: 'Interlining', price_per_metre: 10, applies_to_curtains: true,
  })
  const records = {
    'api::fabric.fabric': [fabric],
    'api::curtain-type.curtain-type': [
      record('pinch', { id: 16, documentId: 'mr45lu0oze75bk8xxxpzf6ck', name: 'Pinch Pleat', fullness_multiplier: 2.5 }),
      record('numeric-nine-trap', { id: 9, name: 'Wave', fullness_multiplier: 2 }),
      record('pencil', { id: 15, documentId: 'tka3oaa0l1zubhy8q6wae8xn', name: 'Pencil Pleat', fullness_multiplier: 2 }),
      record('wave', { id: 14, documentId: 'rtraw2pd1pj1hfvs4kk67l1t', name: 'Wave', fullness_multiplier: 2 }),
      record('eyelet', { id: 17, documentId: 'b8984zfsjjrljywhrpjfo2uw', name: 'Eyelet', fullness_multiplier: 2 }),
    ],
    'api::lining.lining': [standardLining, interlining],
    'api::lining-colour.lining-colour': [record('white', {
      display_name: 'White', applies_to_curtains: true, compatible_lining_types: [record('lined')],
    })],
    'api::pricing-rule.pricing-rule': [
      ...(dedicatedRule ? [record('pinch-rule', {
        name: 'Pinch Pleat', product_type: 'curtain', publishedAt: draftDedicated ? null : '2026-09-17T00:00:00.000Z', formula: pinchPleatPricingFormula,
      })] : []),
      sharedRule,
    ],
  }
  return { fabric, standardLining, interlining, records }
}

const strapiForPinchPleat = records => ({ entityService: { findMany: async (uid, params = {}) => {
  let values = records[uid] || []
  if (params.filters?.product_type) values = values.filter(item => item.product_type === params.filters.product_type)
  const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || []
  return requested.length
    ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId))
    : values
} } })

const pinchPleatItem = (curtainTypeId = 'pinch', quantity = 1, interliningTypeKey = null) => ({
  madeToMeasureV2: true,
  productType: 'curtain',
  fabricId: 'fabric-1',
  quantity,
  measurements: { width: 220, height: 220 },
  curtainTypeId,
  liningTypeKey: 'lined',
  liningColourKey: 'white',
  ...(interliningTypeKey ? { interliningTypeKey } : {}),
})

const liveShapedPinchPleatItem = (quantity = 1, interliningTypeKey = null) => ({
  madeToMeasureV2: true,
  productType: 'curtain',
  fabricId: 'fabric-1',
  quantity,
  measurements: { width: 220, height: 220 },
  curtainTypeId: 9,
  curtainType: {
    id: 'mr45lu0oze75bk8xxxpzf6ck',
    documentId: 'mr45lu0oze75bk8xxxpzf6ck',
    numericId: 9,
    key: null,
    label: 'Pinch Pleat',
    fullnessMultiplier: 2.5,
  },
  liningTypeKey: 'lined',
  liningColourKey: 'white',
  ...(interliningTypeKey ? { interliningTypeKey } : {}),
})

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

  const lining = quote.breakdown.accessories.find(item => item.type === 'lining_material')
  assert.equal(lining.totalPence, 0)
  assert.equal(quote.breakdown.makingCharge[0].label, 'Interlining workmanship')
  assert.equal(quote.breakdown.makingCharge[0].totalPence, 26600)
  assert.equal(quote.breakdown.totalPence, quote.breakdown.fabric[0].totalPence + lining.totalPence + 26600)
})

test('blind interlining shows its workmanship separately without adding blind making twice', async () => {
  const fabric = record('fabric-1', { price_per_metre: 29, usable_width_cm: 140 })
  const interliningPricingRule = {
    formula: {
      steps: [
        { name: 'Cut Length with Allowance', inputs: ['height_cm', 30], output: 'cutLength_cm', operation: 'add' },
        { name: 'Total Interlining Needed (cm)', inputs: [1, 'cutLength_cm'], output: 'totalInterlining_cm', operation: 'multiply' },
        { name: 'Convert cm to metres', inputs: ['totalInterlining_cm', 100], output: 'totalInterlining_m', operation: 'divide' },
        { name: 'Interlining Material Cost', inputs: ['totalInterlining_m', 'interlining.price_per_metre'], output: 'interliningMaterialCost', operation: 'multiply' },
        { name: 'Interlining Workmanship - Width Base', inputs: [1, 120], output: 'interliningWorkmanshipWidth', operation: 'multiply' },
        { name: 'Interlining Workmanship - Length Base', inputs: ['totalInterlining_m', 10], output: 'interliningWorkmanshipLength', operation: 'multiply' },
        { name: 'Total Interlining Workmanship', inputs: ['interliningWorkmanshipWidth', 'interliningWorkmanshipLength'], output: 'interliningWorkmanshipTotal', operation: 'add' },
        { name: 'Total Interlining Price', inputs: ['interliningMaterialCost', 'interliningWorkmanshipTotal'], output: 'totalInterliningPrice', operation: 'add' },
      ],
      finalOutput: 'totalInterliningPrice',
    },
  }
  const records = {
    'api::fabric.fabric': [fabric],
    'api::blind-type.blind-type': [record('stacked', { name: 'Stacked', applies_to_blinds: true })],
    'api::lining.lining': [record('interlined', { liningType: 'Interlining', price_per_metre: null, pricing_rule: interliningPricingRule, applies_to_blinds: true })],
    'api::lining-colour.lining-colour': [record('white', { display_name: 'White', applies_to_blinds: true, compatible_lining_types: [record('interlined')] })],
    'api::pricing-rule.pricing-rule': [record('blind-rule', { name: 'Roman Blind', product_type: 'blind', formula: { workmanshipFee: 85 } })],
  }
  const strapi = { entityService: { findMany: async (uid, params = {}) => {
    const values = records[uid] || []
    const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || []
    return requested.length ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId)) : values
  } } }

  const quote = await calculateMadeToMeasureQuote(strapi, { items: [{
    madeToMeasureV2: true, productType: 'blind', fabricId: 'fabric-1', quantity: 1,
    measurements: { width: 100, height: 123 }, blindTypeId: 'stacked', liningTypeKey: 'interlined', liningColourKey: 'white',
  }], shipping: '0.00' })

  const material = quote.breakdown.accessories.find(item => item.type === 'lining_material')
  assert.equal(material.totalPence, 0)
  assert.equal(quote.breakdown.makingCharge[0].label, 'Interlining workmanship')
  assert.equal(quote.breakdown.makingCharge[0].totalPence, 13530)
  assert.equal(quote.breakdown.totalPence, 17967)
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
    'api::pricing-rule.pricing-rule': [record('blind-rule', { name: 'Roman Blind', product_type: 'blind', formula: { workmanshipFee: 85 } })],
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
      name: 'Roman Blind',
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
    'api::pricing-rule.pricing-rule': [record('blind-rule', { name: 'Roman Blind', product_type: 'blind', formula: { workmanshipFee: 85 } })],
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
    'api::pricing-rule.pricing-rule': [record('blind-rule', { name: 'Roman Blind', product_type: 'blind', formula: { workmanshipFee: 85 } })],
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

  // Two 41cm face panels fit across 140cm fabric after 1.5cm seam
  // allowances: 0.41m × £34 = £13.94, + £3 piping, + £10 legacy duck
  // surcharge, + £25 workmanship = £51.94.
  assert.equal(quote.breakdown.fabric[0].quantity, 0.41)
  assert.equal(quote.breakdown.fabric[0].totalPence, 1394)
  assert.equal(quote.breakdown.accessories.find(item => item.type === 'cushion_finish').totalPence, 300)
  assert.equal(quote.breakdown.accessories.find(item => item.type === 'cushion_pad').totalPence, 1000)
  assert.equal(quote.breakdown.makingCharge[0].totalPence, 2500)
  assert.equal(quote.breakdown.totalPence, 5194)
  assert.equal(quote.breakdown.total, '51.94')
})

test('cushion pricing rule rounds fabric to the pattern repeat without changing pad or piping prices', async () => {
  const records = {
    'api::fabric.fabric': [record('fabric-1', { price_per_metre: 34, usable_width_cm: 140, pattern_repeat_cm: 32 })],
    'api::cushion-size.cushion-size': [record('square', {
      name: 'Square 38cm', width_cm: 38, height_cm: 38, shape: 'square', workmanship_cost: 25, duck_feather_surcharge: 10,
    })],
    'api::cushion-piping.cushion-piping': [record('piped', { name: 'Piped', type: 'piped', price: 3 })],
    'api::cushion-pad.cushion-pad': [record('duck', { name: 'Duck feather pad', type: 'duck_feather', price: 0 })],
    'api::pricing-rule.pricing-rule': [record('cushion-rule', { product_type: 'cushion', formula: cushionPricingFormula })],
  }
  const strapi = { entityService: { findMany: async (uid, params = {}) => {
    const values = records[uid] || []
    const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || []
    return requested.length ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId)) : values
  } } }

  const quote = await calculateMadeToMeasureQuote(strapi, { items: [{
    madeToMeasureV2: true, productType: 'cushion', fabricId: 'fabric-1', quantity: 2,
    measurements: { width: 38, height: 38 }, cushionSizeKey: 'square', cushionFinishKey: 'piped', cushionPadKey: 'duck',
  }], shipping: '0.00' })

  // 41cm face cut rounded to the 32cm repeat = 64cm; two faces fit across
  // 140cm fabric, so 0.64m per cushion. The existing catalogue prices are
  // then applied unchanged per cushion.
  assert.equal(quote.breakdown.fabric[0].quantity, 1.28)
  assert.equal(quote.breakdown.fabric[0].totalPence, 4352)
  assert.equal(quote.breakdown.accessories.find(item => item.type === 'cushion_finish').totalPence, 600)
  assert.equal(quote.breakdown.accessories.find(item => item.type === 'cushion_pad').totalPence, 2000)
  assert.equal(quote.breakdown.makingCharge[0].totalPence, 5000)
  assert.equal(quote.breakdown.totalPence, 11952)
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
      record('blind-rule', { name: 'Roman Blind', product_type: 'blind', formula: { workmanshipFee: 85 } }),
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

test('Pinch Pleat uses the dedicated live rule and the required width and metre calculations', async () => {
  const pricing = calculatePinchPleatPricing({
    widthCm: 220,
    heightCm: 220,
    patternRepeatCm: 17.5,
    fabricPricePerMetre: 20,
    interliningPricePerMetre: 10,
    hasInterlining: true,
  })
  assert.deepEqual(pricing, {
    numberOfWidths: 4,
    cutLengthCm: 267.5,
    rawFabricMetres: 10.7,
    roundedFabricMetres: 11,
    fabricCost: 220,
    baseWorkmanship: 380,
    interliningMaterialCost: 110,
    interliningWorkmanship: 100,
    totalWorkmanship: 480,
  })

  for (const [widthCm, expected] of [[220, 4], [221, 5], [275, 5], [276, 6]]) {
    assert.equal(calculatePinchPleatPricing({ widthCm, heightCm: 220, fabricPricePerMetre: 20 }).numberOfWidths, expected)
  }
  assert.equal(calculatePinchPleatPricing({ widthCm: 220, heightCm: 220, patternRepeatCm: 0, fabricPricePerMetre: 20 }).cutLengthCm, 250)
  assert.equal(calculatePinchPleatPricing({ widthCm: 220, heightCm: 220, patternRepeatCm: 0, fabricPricePerMetre: 20 }).rawFabricMetres, 10)
  assert.deepEqual(
    [10, 10.1, 10.5, 10.6].map(rawFabricMetres => {
      const result = calculatePinchPleatPricing({ widthCm: 55, heightCm: rawFabricMetres * 100 - 30, fabricPricePerMetre: 20 })
      return result.roundedFabricMetres
    }),
    [10, 10.5, 10.5, 11]
  )
})

test('Pinch Pleat consumes dedicated outputs, DB interlining rate, and quantity exactly once', async () => {
  const { records } = pinchPleatFixtures({ dedicatedRule: true })
  const strapi = strapiForPinchPleat(records)
  const quote = await calculateMadeToMeasureQuote(strapi, {
    items: [pinchPleatItem('pinch', 1, 'interlined')],
    shipping: '0.00',
  })
  const line = quote.items[0]
  const interlining = quote.breakdown.accessories.find(item => item.type === 'interlining')
  const interliningWorkmanship = quote.breakdown.accessories.find(item => item.type === 'interlining_workmanship')

  assert.equal(line.calculatedQuantity.materialMetres, 11)
  assert.equal(quote.breakdown.fabric[0].quantity, 11)
  assert.equal(quote.breakdown.fabric[0].totalPence, 22000)
  assert.equal(quote.breakdown.makingCharge[0].totalPence, 38000)
  assert.equal(interlining.quantity, 11)
  assert.equal(interlining.totalPence, 11000)
  assert.equal(interliningWorkmanship.quantity, 1)
  assert.equal(interliningWorkmanship.totalPence, 10000)
  assert.equal(quote.breakdown.totalPence, 88700)

  const doubled = await calculateMadeToMeasureQuote(strapi, {
    items: [pinchPleatItem('pinch', 2, 'interlined')],
    shipping: '0.00',
  })
  assert.equal(doubled.breakdown.totalPence, quote.breakdown.totalPence * 2)
  assert.equal(doubled.breakdown.makingCharge[0].totalPence, 76000)
})

test('Pinch Pleat exposes the authoritative calculation breakdown without changing the quote total', async () => {
  const { records } = pinchPleatFixtures({ dedicatedRule: true })
  const quote = await calculateMadeToMeasureQuote(strapiForPinchPleat(records), {
    items: [pinchPleatItem('pinch', 1, 'interlined')],
    shipping: '0.00',
  })
  const calculation = quote.breakdown.calculationBreakdown
  const lineCalculation = quote.breakdown.lines[0].calculationBreakdown

  assert.deepEqual(calculation, lineCalculation)
  assert.equal(calculation.ruleName, 'Pinch Pleat')
  assert.equal(calculation.productType, 'curtain')
  assert.equal(calculation.heading, 'Pinch Pleat')
  assert.equal(calculation.widthCm, 220)
  assert.equal(calculation.numberOfWidths, 4)
  assert.equal(calculation.finishedDropCm, 220)
  assert.equal(calculation.allowanceCm, 30)
  assert.equal(calculation.cutLengthBeforeRepeatCm, 250)
  assert.equal(calculation.patternRepeatCm, 17.5)
  assert.equal(calculation.cutLengthCm, 267.5)
  assert.equal(calculation.cutLengthM, 2.675)
  assert.equal(calculation.rawFabricMetres, 10.7)
  assert.equal(calculation.halfMetreUnits, 21.4)
  assert.equal(calculation.roundedHalfMetreUnits, 22)
  assert.equal(calculation.roundedFabricMetres, 11)
  assert.equal(calculation.fabric.pricePerMetre, 20)
  assert.equal(calculation.fabric.metres, 11)
  assert.equal(calculation.fabric.costPence, 22000)
  assert.equal(calculation.lining.pricePerMetre, 7)
  assert.equal(calculation.lining.metres, 11)
  assert.equal(calculation.lining.costPence, 7700)
  assert.equal(calculation.baseWorkmanshipPence, 38000)
  assert.equal(calculation.interlining.selected, true)
  assert.equal(calculation.interlining.metres, 11)
  assert.equal(calculation.interlining.pricePerMetre, 10)
  assert.equal(calculation.interlining.materialCostPence, 11000)
  assert.equal(calculation.interlining.workmanshipPence, 10000)
  assert.equal(calculation.totalWorkmanshipPence, 48000)
  assert.equal(calculation.totalPence, 88700)
  assert.equal(calculation.steps.find(step => step.key === 'numberOfWidths').value, 4)
  assert.equal(calculation.steps.find(step => step.key === 'totalPrice').value, 810)
})

test('live-shaped Pinch Pleat selects the dedicated rule and returns the authoritative 69.5cm calculation', async () => {
  const { records, fabric, standardLining } = pinchPleatFixtures({ dedicatedRule: true })
  fabric.price_per_metre = 28
  fabric.pattern_repeat_cm = 69.5
  standardLining.price_per_metre = 9

  const quote = await calculateMadeToMeasureQuote(strapiForPinchPleat(records), {
    items: [liveShapedPinchPleatItem()],
    shipping: '0.00',
  })
  const calculation = quote.breakdown.calculationBreakdown
  const lineCalculation = quote.breakdown.lines[0].calculationBreakdown

  assert.equal(quote.items[0].selectedOptions.curtainType.numericId, 16)
  assert.equal(quote.items[0].selectedOptions.curtainType.documentId, 'mr45lu0oze75bk8xxxpzf6ck')
  assert.equal(quote.items[0].selectedOptions.curtainType.label, 'Pinch Pleat')
  assert.equal(quote.items[0].calculatedQuantity.materialMetres, 13)
  assert.notEqual(quote.items[0].calculatedQuantity.materialMetres, 11.12)
  assert.equal(quote.breakdown.makingCharge[0].totalPence, 38000)
  assert.deepEqual(calculation, lineCalculation)
  assert.equal(calculation.ruleName, 'Pinch Pleat')
  assert.equal(calculation.heading, 'Pinch Pleat')
  assert.equal(calculation.widthCm, 220)
  assert.equal(calculation.numberOfWidths, 4)
  assert.equal(calculation.finishedDropCm, 220)
  assert.equal(calculation.allowanceCm, 30)
  assert.equal(calculation.cutLengthBeforeRepeatCm, 250)
  assert.equal(calculation.patternRepeatCm, 69.5)
  assert.equal(calculation.cutLengthCm, 319.5)
  assert.equal(calculation.cutLengthM, 3.195)
  assert.equal(calculation.rawFabricMetres, 12.78)
  assert.equal(calculation.halfMetreUnits, 25.56)
  assert.equal(calculation.roundedHalfMetreUnits, 26)
  assert.equal(calculation.roundedFabricMetres, 13)
  assert.equal(calculation.fabric.metres, 13)
  assert.equal(calculation.fabric.costPence, 36400)
  assert.equal(calculation.lining.metres, 13)
  assert.equal(calculation.lining.costPence, 11700)
  assert.equal(calculation.baseWorkmanshipPence, 38000)
  assert.equal(calculation.interlining.selected, false)
  assert.equal(calculation.interlining.materialCostPence, null)
  assert.equal(calculation.interlining.workmanshipPence, 0)
  assert.equal(calculation.totalWorkmanshipPence, 38000)
  assert.equal(calculation.totalPence, 86100)
  assert.equal(quote.breakdown.totalPence, 86100)
})

test('published Document Service pricing rule wins over a draft same-document variant', async () => {
  const { records, fabric, standardLining } = pinchPleatFixtures({ dedicatedRule: false })
  fabric.price_per_metre = 28
  fabric.pattern_repeat_cm = 69.5
  standardLining.price_per_metre = 9
  const pricingRuleUid = 'api::pricing-rule.pricing-rule'
  const draftRules = [
    record('draft-pinch-rule', {
      id: 21,
      documentId: 'zsxtdr6jbe85u6qcy2x4jpcg',
      name: 'Pinch Pleat',
      product_type: 'curtain',
      publishedAt: null,
      formula: { workmanshipFee: 0 },
    }),
    record('draft-shared-rule', {
      id: 3,
      documentId: 'lopyfsvzyo8z5tfwqeoqyckm',
      name: 'Curtain',
      product_type: 'curtain',
      publishedAt: null,
      formula: { workmanshipFee: 0 },
    }),
  ]
  const publishedRules = [
    record('published-pinch-rule', {
      id: 23,
      documentId: 'zsxtdr6jbe85u6qcy2x4jpcg',
      name: 'Pinch Pleat',
      product_type: 'curtain',
      publishedAt: '2026-09-17T00:00:00.000Z',
      formula: pinchPleatPricingFormula,
    }),
    record('published-shared-rule', {
      id: 7,
      documentId: 'lopyfsvzyo8z5tfwqeoqyckm',
      name: 'Curtain',
      product_type: 'curtain',
      publishedAt: '2026-09-17T00:00:00.000Z',
      formula: { workmanshipFee: 17 },
    }),
  ]
  records[pricingRuleUid] = draftRules
  const baseStrapi = strapiForPinchPleat(records)
  const entityServicePricingRuleCalls = []
  const documentQueries = []
  const strapi = {
    ...baseStrapi,
    entityService: {
      findMany: async (uid, params) => {
        if (uid === pricingRuleUid) entityServicePricingRuleCalls.push(params)
        return baseStrapi.entityService.findMany(uid, params)
      },
    },
    documents: uid => uid === pricingRuleUid
      ? {
        findMany: async params => {
          documentQueries.push(params)
          return publishedRules
        },
      }
      : null,
  }

  const quote = await calculateMadeToMeasureQuote(strapi, {
    items: [liveShapedPinchPleatItem()],
    shipping: '0.00',
  })

  assert.deepEqual(documentQueries, [{
    status: 'published',
    filters: { product_type: 'curtain' },
    limit: 100,
  }])
  assert.deepEqual(entityServicePricingRuleCalls, [])
  assert.equal(quote.breakdown.calculationBreakdown.ruleName, 'Pinch Pleat')
  assert.equal(quote.breakdown.makingCharge[0].totalPence, 38000)
  assert.equal(quote.breakdown.totalPence, 86100)
})

test('live-shaped Pencil Pleat, Wave, and Eyelet remain on shared Curtain pricing', async () => {
  const { records } = pinchPleatFixtures({ dedicatedRule: true })
  const options = [
    { id: 'tka3oaa0l1zubhy8q6wae8xn', label: 'Pencil Pleat', fullnessMultiplier: 2 },
    { id: 'rtraw2pd1pj1hfvs4kk67l1t', label: 'Wave', fullnessMultiplier: 2 },
    { id: 'b8984zfsjjrljywhrpjfo2uw', label: 'Eyelet', fullnessMultiplier: 2 },
  ]

  for (const option of options) {
    const quote = await calculateMadeToMeasureQuote(strapiForPinchPleat(records), {
      items: [{
        ...pinchPleatItem('pinch'),
        curtainTypeId: 9,
        curtainType: {
          id: option.id,
          documentId: option.id,
          numericId: option.id === 'tka3oaa0l1zubhy8q6wae8xn' ? 15 : option.id === 'rtraw2pd1pj1hfvs4kk67l1t' ? 14 : 17,
          key: null,
          label: option.label,
          fullnessMultiplier: option.fullnessMultiplier,
        },
      }],
      shipping: '0.00',
    })

    assert.equal(quote.items[0].selectedOptions.curtainType.label, option.label)
    assert.equal(quote.breakdown.makingCharge[0].totalPence, 1700, option.label)
    assert.equal(quote.breakdown.calculationBreakdown, undefined, option.label)
  }
})

test('live-shaped Pinch Pleat keeps the DB interlining rate and workmanship path', async () => {
  const { records } = pinchPleatFixtures({ dedicatedRule: true })

  const quote = await calculateMadeToMeasureQuote(strapiForPinchPleat(records), {
    items: [liveShapedPinchPleatItem(1, 'interlined')],
    shipping: '0.00',
  })
  const calculation = quote.breakdown.calculationBreakdown
  const interlining = quote.breakdown.accessories.find(item => item.type === 'interlining')
  const interliningWorkmanship = quote.breakdown.accessories.find(item => item.type === 'interlining_workmanship')

  assert.equal(calculation.numberOfWidths, 4)
  assert.equal(calculation.roundedFabricMetres, 11)
  assert.equal(calculation.baseWorkmanshipPence, 38000)
  assert.equal(calculation.interlining.selected, true)
  assert.equal(calculation.interlining.metres, 11)
  assert.equal(calculation.interlining.pricePerMetre, 10)
  assert.equal(calculation.interlining.materialCostPence, 11000)
  assert.equal(calculation.interlining.workmanshipPence, 10000)
  assert.equal(calculation.totalWorkmanshipPence, 48000)
  assert.equal(interlining.totalPence, 11000)
  assert.equal(interliningWorkmanship.totalPence, 10000)
  assert.equal(quote.breakdown.totalPence, 88700)
})

test('Pinch Pleat falls back safely and never becomes the generic curtain rule', async () => {
  for (const fixture of [
    { label: 'absent', options: {} },
    { label: 'draft', options: { dedicatedRule: true, draftDedicated: true } },
  ]) {
    const { records } = pinchPleatFixtures(fixture.options)
    const strapi = strapiForPinchPleat(records)
    const quote = await calculateMadeToMeasureQuote(strapi, {
      items: [pinchPleatItem('pinch')],
      shipping: '0.00',
    })
    assert.equal(quote.breakdown.makingCharge[0].totalPence, 1700, fixture.label)
  }

  const { records } = pinchPleatFixtures({ dedicatedRule: true })
  const strapi = strapiForPinchPleat(records)
  for (const heading of ['pencil', 'wave', 'eyelet']) {
    const quote = await calculateMadeToMeasureQuote(strapi, {
      items: [pinchPleatItem(heading)],
      shipping: '0.00',
    })
    assert.equal(quote.breakdown.makingCharge[0].totalPence, 1700, heading)
    assert.equal(quote.breakdown.calculationBreakdown, undefined, heading)
  }
})

test('Pinch Pleat without interlining keeps the base workmanship and omits interlining charges', async () => {
  const { records } = pinchPleatFixtures({ dedicatedRule: true })
  const quote = await calculateMadeToMeasureQuote(strapiForPinchPleat(records), {
    items: [pinchPleatItem('pinch')],
    shipping: '0.00',
  })

  assert.equal(quote.breakdown.makingCharge[0].totalPence, 38000)
  assert.equal(quote.breakdown.accessories.some(item => item.type === 'interlining'), false)
  assert.equal(quote.breakdown.accessories.some(item => item.type === 'interlining_workmanship'), false)
  assert.equal(quote.breakdown.totalPence, 67700)

  assert.equal(quote.breakdown.calculationBreakdown.interlining.selected, false)
  assert.equal(quote.breakdown.calculationBreakdown.interlining.metres, null)
  assert.equal(quote.breakdown.calculationBreakdown.interlining.materialCostPence, null)
  assert.equal(quote.breakdown.calculationBreakdown.interlining.workmanshipPence, 0)
  assert.equal(quote.breakdown.calculationBreakdown.totalWorkmanshipPence, 38000)
  assert.equal(quote.breakdown.calculationBreakdown.totalPence, 67700)
})
