require('../../node_modules/ts-node/register')

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  calculateMadeToMeasureQuote,
  MadeToMeasureValidationError,
} = require('../src/api/storefront/services/made-to-measure')

const PRICING_RULE_UID = 'api::pricing-rule.pricing-rule'

const record = (key, data = {}) => ({
  id: key,
  documentId: key,
  key,
  active: true,
  is_configurator_option: true,
  ...data,
})

const romanBlindPricingFormula = {
  steps: [
    {
      name: 'Number of Fabric Widths',
      condition: 'width_cm <= 125',
      operation: 'if_else',
      on_true: { operation: 'set', inputs: [1], output: 'numberOfWidths' },
      on_false: { operation: 'set', inputs: [2], output: 'numberOfWidths' },
      output: 'numberOfWidths',
    },
    {
      name: 'Pattern Repeat Added Per Width',
      condition: 'numberOfWidths == 2',
      operation: 'if_else',
      on_true: { operation: 'set', inputs: ['fabric.patternRepeat_cm'], output: 'patternRepeatAddedPerWidth_cm' },
      on_false: { operation: 'set', inputs: [0], output: 'patternRepeatAddedPerWidth_cm' },
      output: 'patternRepeatAddedPerWidth_cm',
    },
    { name: 'Cut Length Per Width', inputs: ['height_cm', 20, 'patternRepeatAddedPerWidth_cm'], output: 'cutLengthPerWidth_cm', operation: 'add' },
    { name: 'Total Fabric Length', inputs: ['cutLengthPerWidth_cm', 'numberOfWidths'], output: 'totalFabric_cm', operation: 'multiply' },
    { name: 'Raw Fabric Metres', inputs: ['totalFabric_cm', 100], output: 'rawFabricMetres', operation: 'divide' },
    { name: 'Half Metre Units', inputs: ['rawFabricMetres', 2], output: 'halfMetreUnits', operation: 'multiply' },
    { name: 'Round Up Half Metre Units', inputs: ['halfMetreUnits'], output: 'roundedHalfMetreUnits', operation: 'ceil' },
    { name: 'Billable Fabric Metres', inputs: ['roundedHalfMetreUnits', 2], output: 'roundedFabricMetres', operation: 'divide' },
    { name: 'Fabric Material Cost', inputs: ['roundedFabricMetres', 'fabric.price_per_metre'], output: 'fabricMaterialCost', operation: 'multiply' },
    {
      name: 'Width Workmanship',
      condition: 'width_cm <= 125',
      operation: 'if_else',
      on_true: { operation: 'set', inputs: [100], output: 'widthWorkmanship' },
      on_false: {
        condition: 'width_cm <= 185',
        operation: 'if_else',
        on_true: { operation: 'set', inputs: [150], output: 'widthWorkmanship' },
        on_false: { operation: 'set', inputs: [200], output: 'widthWorkmanship' },
      },
      output: 'widthWorkmanship',
    },
    {
      name: 'Height Workmanship',
      condition: 'height_cm <= 125',
      operation: 'if_else',
      on_true: { operation: 'set', inputs: [100], output: 'heightWorkmanship' },
      on_false: {
        condition: 'height_cm <= 185',
        operation: 'if_else',
        on_true: { operation: 'set', inputs: [150], output: 'heightWorkmanship' },
        on_false: { operation: 'set', inputs: [200], output: 'heightWorkmanship' },
      },
      output: 'heightWorkmanship',
    },
    { name: 'Main Workmanship', inputs: ['widthWorkmanship', 'heightWorkmanship'], output: 'mainWorkmanship', operation: 'add' },
    { name: 'Main Workmanship Alias', inputs: ['mainWorkmanship'], output: 'workmanshipCost', operation: 'set' },
    {
      name: 'Track Charge',
      condition: 'width_cm <= 125',
      operation: 'if_else',
      on_true: { operation: 'set', inputs: [150], output: 'trackCharge' },
      on_false: {
        condition: 'width_cm <= 185',
        operation: 'if_else',
        on_true: { operation: 'set', inputs: [225], output: 'trackCharge' },
        on_false: { operation: 'set', inputs: [300], output: 'trackCharge' },
      },
      output: 'trackCharge',
    },
    {
      name: 'Roman Blind Interlining Workmanship',
      condition: 'interlining.price_per_metre > 0',
      operation: 'if_else',
      on_true: {
        sub_steps: [
          {
            name: 'Interlining Width Workmanship',
            condition: 'width_cm <= 125',
            operation: 'if_else',
            on_true: { operation: 'set', inputs: [50], output: 'interliningWidthWorkmanship' },
            on_false: {
              condition: 'width_cm <= 185',
              operation: 'if_else',
              on_true: { operation: 'set', inputs: [75], output: 'interliningWidthWorkmanship' },
              on_false: { operation: 'set', inputs: [100], output: 'interliningWidthWorkmanship' },
            },
            output: 'interliningWidthWorkmanship',
          },
          {
            name: 'Interlining Height Workmanship',
            condition: 'height_cm <= 125',
            operation: 'if_else',
            on_true: { operation: 'set', inputs: [50], output: 'interliningHeightWorkmanship' },
            on_false: {
              condition: 'height_cm <= 185',
              operation: 'if_else',
              on_true: { operation: 'set', inputs: [75], output: 'interliningHeightWorkmanship' },
              on_false: { operation: 'set', inputs: [100], output: 'interliningHeightWorkmanship' },
            },
            output: 'interliningHeightWorkmanship',
          },
          { name: 'Interlining Workmanship Total', inputs: ['interliningWidthWorkmanship', 'interliningHeightWorkmanship'], output: 'interliningWorkmanshipTotal', operation: 'add' },
        ],
      },
      on_false: {
        sub_steps: [
          { operation: 'set', inputs: [0], output: 'interliningWidthWorkmanship' },
          { operation: 'set', inputs: [0], output: 'interliningHeightWorkmanship' },
          { operation: 'set', inputs: [0], output: 'interliningWorkmanshipTotal' },
        ],
      },
      output: 'interliningWorkmanshipTotal',
    },
    { name: 'Roman Blind Base Price', inputs: ['fabricMaterialCost', 'mainWorkmanship', 'trackCharge', 'interliningWorkmanshipTotal'], output: 'totalPrice', operation: 'add' },
  ],
  finalOutput: 'totalPrice',
}

const oldInterliningPricingRule = {
  formula: {
    steps: [
      { inputs: ['height_cm', 30], output: 'cutLength_cm', operation: 'add' },
      { inputs: [1, 'cutLength_cm'], output: 'totalInterlining_cm', operation: 'multiply' },
      { inputs: ['totalInterlining_cm', 100], output: 'totalInterlining_m', operation: 'divide' },
      { inputs: ['totalInterlining_m', 'interlining.price_per_metre'], output: 'interliningMaterialCost', operation: 'multiply' },
      { inputs: [1, 120], output: 'interliningWorkmanshipWidth', operation: 'multiply' },
      { inputs: ['totalInterlining_m', 10], output: 'interliningWorkmanshipLength', operation: 'multiply' },
      { inputs: ['interliningWorkmanshipWidth', 'interliningWorkmanshipLength'], output: 'interliningWorkmanshipTotal', operation: 'add' },
      { inputs: ['interliningMaterialCost', 'interliningWorkmanshipTotal'], output: 'totalInterliningPrice', operation: 'add' },
    ],
    finalOutput: 'totalInterliningPrice',
  },
}

function makeStrapi({ ruleRecords = [record('roman-rule', { name: 'Roman Blind', product_type: 'blind', formula: romanBlindPricingFormula })], interlining = null, fabricOverrides = {} } = {}) {
  const fabric = record('fabric-1', { price_per_metre: 28, usable_width_cm: 140, pattern_repeat_cm: 46, ...fabricOverrides })
  const standardLining = record('lined', { liningType: 'Standard Lining', price_per_metre: 0, applies_to_blinds: true })
  const liningColour = record('white', { display_name: 'White', applies_to_blinds: true, compatible_lining_types: [record('lined')] })
  const records = {
    'api::fabric.fabric': [fabric],
    'api::blind-type.blind-type': [record('roman', { name: 'Roman Blind', applies_to_blinds: true })],
    'api::lining.lining': [standardLining, ...(interlining ? [interlining] : [])],
    'api::lining-colour.lining-colour': [liningColour],
    [PRICING_RULE_UID]: ruleRecords,
  }
  const documentQueries = []
  const strapi = {
    entityService: {
      findMany: async (uid, params = {}) => {
        let values = records[uid] || []
        if (params.filters?.product_type) values = values.filter(item => item.product_type === params.filters.product_type)
        const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || []
        return requested.length
          ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId))
          : values
      },
    },
    documents: uid => uid === PRICING_RULE_UID
      ? {
          findMany: async params => {
            documentQueries.push(params)
            return records[PRICING_RULE_UID]
          },
        }
      : null,
  }
  return { strapi, documentQueries }
}

function romanItem(overrides = {}) {
  return {
    madeToMeasureV2: true,
    productType: 'blind',
    fabricId: 'fabric-1',
    quantity: 1,
    measurements: { width: 120, height: 120 },
    blindTypeId: 'roman',
    liningTypeKey: 'lined',
    liningColourKey: 'white',
    ...overrides,
  }
}

async function quote(strapi, item) {
  return calculateMadeToMeasureQuote(strapi, { items: [item], shipping: '0.00' })
}

test('Roman Blind uses one width, half-metre ceiling, main workmanship, and mandatory track', async () => {
  const { strapi } = makeStrapi()
  const result = await quote(strapi, romanItem())
  const calculation = result.breakdown.calculationBreakdown
  const track = result.breakdown.accessories.find(item => item.type === 'track')

  assert.equal(calculation.pricingPath, 'dedicated-roman-blind')
  assert.equal(calculation.numberOfWidths, 1)
  assert.equal(calculation.cutLengthPerWidthCm, 140)
  assert.equal(calculation.patternRepeatAddedPerWidthCm, 0)
  assert.equal(calculation.rawFabricMetres, 1.4)
  assert.equal(calculation.roundedFabricMetres, 1.5)
  assert.equal(calculation.fabricMaterialCost, 42)
  assert.equal(calculation.widthWorkmanship, 100)
  assert.equal(calculation.heightWorkmanship, 100)
  assert.equal(calculation.mainWorkmanship, 200)
  assert.equal(calculation.trackCharge, 150)
  assert.equal(track.totalPence, 15000)
  assert.equal(result.breakdown.makingCharge[0].totalPence, 20000)
  assert.equal(result.breakdown.totalPence, 39200)
})

test('Roman Blind two-width patterned calculation adds one repeat per width and rounds up', async () => {
  const { strapi } = makeStrapi({ fabricOverrides: { price_per_metre: 36 } })
  const result = await quote(strapi, romanItem({ measurements: { width: 170, height: 120 } }))
  const calculation = result.breakdown.calculationBreakdown

  assert.equal(calculation.numberOfWidths, 2)
  assert.equal(calculation.cutLengthPerWidthCm, 186)
  assert.equal(calculation.patternRepeatAddedPerWidthCm, 46)
  assert.equal(calculation.rawFabricMetres, 3.72)
  assert.equal(calculation.roundedFabricMetres, 4)
  assert.equal(calculation.fabricMaterialCost, 144)
  assert.equal(calculation.mainWorkmanship, 250)
  assert.equal(calculation.trackCharge, 225)
  assert.equal(result.breakdown.totalPence, 61900)
})

test('Roman Blind uses the third money band and ignores fabric usable width', async () => {
  const { strapi } = makeStrapi()
  const result = await quote(strapi, romanItem({ measurements: { width: 220, height: 220 } }))
  const calculation = result.breakdown.calculationBreakdown

  assert.equal(calculation.numberOfWidths, 2)
  assert.equal(calculation.widthWorkmanship, 200)
  assert.equal(calculation.heightWorkmanship, 200)
  assert.equal(calculation.mainWorkmanship, 400)
  assert.equal(calculation.trackCharge, 300)
})

test('Roman Blind boundaries use inclusive 125 and 185 bands and accept 250', async () => {
  const { strapi } = makeStrapi()
  const cases = [
    [{ width: 125, height: 125 }, { widths: 1, widthWorkmanship: 100, heightWorkmanship: 100, track: 150 }],
    [{ width: 125.1, height: 125.1 }, { widths: 2, widthWorkmanship: 150, heightWorkmanship: 150, track: 225 }],
    [{ width: 185, height: 185 }, { widths: 2, widthWorkmanship: 150, heightWorkmanship: 150, track: 225 }],
    [{ width: 185.1, height: 185.1 }, { widths: 2, widthWorkmanship: 200, heightWorkmanship: 200, track: 300 }],
    [{ width: 250, height: 250 }, { widths: 2, widthWorkmanship: 200, heightWorkmanship: 200, track: 300 }],
  ]

  for (const [measurements, expected] of cases) {
    const result = await quote(strapi, romanItem({ measurements }))
    const calculation = result.breakdown.calculationBreakdown
    assert.equal(calculation.numberOfWidths, expected.widths, JSON.stringify(measurements))
    assert.equal(calculation.widthWorkmanship, expected.widthWorkmanship, JSON.stringify(measurements))
    assert.equal(calculation.heightWorkmanship, expected.heightWorkmanship, JSON.stringify(measurements))
    assert.equal(calculation.trackCharge, expected.track, JSON.stringify(measurements))
  }
})

test('Roman Blind interlining workmanship uses the same inclusive money bands', async () => {
  const interlining = record('interlined', {
    liningType: 'Interlining',
    price_per_metre: 10,
    pricing_rule: oldInterliningPricingRule,
    applies_to_blinds: true,
  })
  const { strapi } = makeStrapi({ interlining })
  const cases = [
    [{ width: 125, height: 125 }, 50, 50],
    [{ width: 125.1, height: 125.1 }, 75, 75],
    [{ width: 185, height: 185 }, 75, 75],
    [{ width: 185.1, height: 185.1 }, 100, 100],
    [{ width: 250, height: 250 }, 100, 100],
  ]

  for (const [measurements, expectedWidth, expectedHeight] of cases) {
    const result = await quote(strapi, romanItem({ measurements, interliningTypeKey: 'interlined' }))
    const calculation = result.breakdown.calculationBreakdown
    assert.equal(calculation.interliningWidthWorkmanship, expectedWidth, JSON.stringify(measurements))
    assert.equal(calculation.interliningHeightWorkmanship, expectedHeight, JSON.stringify(measurements))
  }
})

test('Roman Blind rejects width or height above 250cm before pricing', async () => {
  const { strapi } = makeStrapi()

  for (const item of [
    romanItem({ measurements: { width: 250.1, height: 120 } }),
    romanItem({ measurements: { width: 120, height: 250.1 } }),
  ]) {
    await assert.rejects(
      () => quote(strapi, item),
      error => error instanceof MadeToMeasureValidationError && error.issues.some(issue => /no more than 250/.test(issue.message))
    )
  }
})

test('Roman Blind one-width patterned fabric ignores the repeat and two-width zero-repeat fabric adds none', async () => {
  const patterned = makeStrapi()
  const oneWidth = await quote(patterned.strapi, romanItem({ measurements: { width: 125, height: 120 } }))
  assert.equal(oneWidth.breakdown.calculationBreakdown.cutLengthPerWidthCm, 140)

  const zeroRepeat = makeStrapi({ fabricOverrides: { pattern_repeat_cm: 0 } })
  const result = await quote(zeroRepeat.strapi, romanItem({ measurements: { width: 170, height: 120 } }))
  assert.equal(result.breakdown.calculationBreakdown.patternRepeatAddedPerWidthCm, 0)
  assert.equal(result.breakdown.calculationBreakdown.cutLengthPerWidthCm, 140)
})

test('Roman Blind billable fabric metres round upward at half-metre boundaries', async () => {
  const { strapi } = makeStrapi()
  const exactHalf = await quote(strapi, romanItem({ measurements: { width: 120, height: 130 } }))
  const aboveHalf = await quote(strapi, romanItem({ measurements: { width: 120, height: 131 } }))

  assert.equal(exactHalf.breakdown.calculationBreakdown.rawFabricMetres, 1.5)
  assert.equal(exactHalf.breakdown.calculationBreakdown.roundedFabricMetres, 1.5)
  assert.equal(aboveHalf.breakdown.calculationBreakdown.rawFabricMetres, 1.51)
  assert.equal(aboveHalf.breakdown.calculationBreakdown.roundedFabricMetres, 2)
})

test('Roman Blind keeps interlining material pricing but replaces old interlining workmanship', async () => {
  const interlining = record('interlined', {
    liningType: 'Interlining',
    price_per_metre: 10,
    pricing_rule: oldInterliningPricingRule,
    applies_to_blinds: true,
  })
  const { strapi } = makeStrapi({ interlining })
  const result = await quote(strapi, romanItem({ interliningTypeKey: 'interlined' }))
  const calculation = result.breakdown.calculationBreakdown
  const material = result.breakdown.accessories.find(item => item.type === 'interlining')
  const workmanship = result.breakdown.accessories.find(item => item.type === 'interlining_workmanship')

  assert.equal(material.totalPence, 1500)
  assert.equal(workmanship.totalPence, 10000)
  assert.equal(calculation.interliningMaterialCost, 15)
  assert.equal(calculation.interliningWidthWorkmanship, 50)
  assert.equal(calculation.interliningHeightWorkmanship, 50)
  assert.equal(calculation.interliningWorkmanshipTotal, 100)
  assert.notEqual(workmanship.totalPence, 13500)
})

test('Roman Blind track remains additive with mechanisation and quantity scales the finished unit once', async () => {
  const { strapi } = makeStrapi()
  strapi.entityService.findMany = async (uid, params = {}) => {
    if (uid === 'api::mechanisation.mechanisation') return [record('motor', { name: 'Motor', price: 20 })]
    const values = uid === 'api::fabric.fabric'
      ? [record('fabric-1', { price_per_metre: 28, usable_width_cm: 140, pattern_repeat_cm: 46 })]
      : uid === 'api::blind-type.blind-type'
        ? [record('roman', { name: 'Roman Blind', applies_to_blinds: true })]
        : uid === 'api::lining.lining'
          ? [record('lined', { liningType: 'Standard Lining', price_per_metre: 0, applies_to_blinds: true })]
          : uid === 'api::lining-colour.lining-colour'
            ? [record('white', { display_name: 'White', applies_to_blinds: true, compatible_lining_types: [record('lined')] })]
            : []
    const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || []
    return requested.length ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId)) : values
  }
  const one = await quote(strapi, romanItem({ mechanismKey: 'motor', quantity: 1 }))
  const two = await quote(strapi, romanItem({ mechanismKey: 'motor', quantity: 2 }))
  const oneTrack = one.breakdown.accessories.find(item => item.type === 'track')
  const oneMechanism = one.breakdown.accessories.find(item => item.type === 'mechanism')

  assert.equal(oneTrack.totalPence, 15000)
  assert.equal(oneMechanism.totalPence, 2000)
  assert.equal(two.breakdown.totalPence, one.breakdown.totalPence * 2)
})

test('Roman Blind selector uses the published exact rule and rejects a draft exact rule', async () => {
  const published = makeStrapi({
    ruleRecords: [
      record('generic-blind', { name: 'Blind', product_type: 'blind', formula: { workmanshipFee: 1 } }),
      record('draft-roman', { name: 'Roman Blind', product_type: 'blind', publishedAt: null, formula: { workmanshipFee: 2 } }),
      record('published-roman', { name: 'Roman Blind', product_type: 'blind', publishedAt: '2026-09-18T00:00:00.000Z', formula: romanBlindPricingFormula }),
    ],
  })
  const result = await quote(published.strapi, romanItem())
  assert.equal(result.breakdown.calculationBreakdown.ruleName, 'Roman Blind')
  assert.deepEqual(published.documentQueries[0], { status: 'published', filters: { product_type: 'blind' }, limit: 100 })

  const draftOnly = makeStrapi({
    ruleRecords: [record('draft-roman', { name: 'Roman Blind', product_type: 'blind', publishedAt: null, formula: romanBlindPricingFormula })],
  })
  await assert.rejects(
    () => quote(draftOnly.strapi, romanItem()),
    error => error instanceof MadeToMeasureValidationError && error.issues.some(issue => issue.field === 'pricingRule')
  )
})
