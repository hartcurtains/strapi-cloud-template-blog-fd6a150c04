'use strict';

require('../../node_modules/ts-node/register');

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMadeToMeasureQuote } = require('../src/api/storefront/services/made-to-measure');

const record = (key, data = {}) => ({
  id: key,
  documentId: key,
  key,
  active: true,
  is_configurator_option: true,
  ...data,
});

const interliningRule = {
  formula: {
    steps: [
      { inputs: ['width_cm', 'curtain_type.fullness_multiplier'], output: 'fullnessWidth_cm', operation: 'multiply' },
      { inputs: ['fullnessWidth_cm', 'fabric.usableWidth_cm'], output: 'widthsNeeded', operation: 'divide' },
      { inputs: ['widthsNeeded', 0.2], output: 'roundedWidths', operation: 'customRound' },
      { inputs: ['height_cm', 30], output: 'cutLength_cm', operation: 'add' },
      { inputs: ['roundedWidths', 'cutLength_cm'], output: 'totalInterlining_cm', operation: 'multiply' },
      { inputs: ['totalInterlining_cm', 100], output: 'totalInterlining_m', operation: 'divide' },
      { inputs: ['totalInterlining_m', 'interlining.price_per_metre'], output: 'interliningMaterialCost', operation: 'multiply' },
      { inputs: ['roundedWidths', 120], output: 'interliningWorkmanshipWidth', operation: 'multiply' },
      { inputs: ['totalInterlining_m', 10], output: 'interliningWorkmanshipLength', operation: 'multiply' },
      { inputs: ['interliningWorkmanshipWidth', 'interliningWorkmanshipLength'], output: 'interliningWorkmanshipTotal', operation: 'add' },
      { inputs: ['interliningMaterialCost', 'interliningWorkmanshipTotal'], output: 'totalInterliningPrice', operation: 'add' },
    ],
    finalOutput: 'totalInterliningPrice',
  },
};

test('optional interlining is priced alongside the selected standard lining', async () => {
  const fabric = record('fabric-1', { price_per_metre: 36, usable_width_cm: 140, pattern_repeat_cm: 46 });
  const standard = record('lined', { liningType: 'Full Lining', price_per_metre: 9, applies_to_curtains: true });
  const interlining = record('interlined', { liningType: 'Interlining', price_per_metre: 10, pricing_rule: interliningRule, applies_to_curtains: true });
  const colour = record('white', {
    display_name: 'White',
    applies_to_curtains: true,
    compatible_lining_types: [standard],
  });
  const curtainType = record('eyelet', { name: 'Eyelet', fullness_multiplier: 2, applies_to_curtains: true });
  const curtainRule = record('curtain-rule', { product_type: 'curtain', formula: { workmanshipFee: 170 } });
  const records = {
    'api::fabric.fabric': [fabric],
    'api::curtain-type.curtain-type': [curtainType],
    'api::lining.lining': [standard, interlining],
    'api::lining-colour.lining-colour': [colour],
    'api::pricing-rule.pricing-rule': [curtainRule],
  };
  const strapi = {
    entityService: {
      findMany: async (uid, params = {}) => {
        const values = records[uid] || [];
        const requested = params.filters?.$and?.find(item => item.$or)?.$or?.map(item => Object.values(item)[0]) || [];
        return requested.length
          ? values.filter(item => requested.includes(item.key) || requested.includes(item.id) || requested.includes(item.documentId))
          : values;
      },
    },
  };

  const quote = await calculateMadeToMeasureQuote(strapi, {
    items: [{
      madeToMeasureV2: true,
      productType: 'curtain',
      fabricId: 'fabric-1',
      quantity: 1,
      measurements: { width: 100, height: 153 },
      curtainTypeId: 'eyelet',
      liningTypeKey: 'lined',
      liningColourKey: 'white',
      interliningTypeKey: 'interlined',
    }],
    shipping: '0.00',
  });

  const accessories = quote.breakdown.accessories;
  const material = accessories.find(item => item.type === 'interlining');
  const workmanship = accessories.find(item => item.type === 'interlining_workmanship');

  assert.equal(quote.items[0].selectedOptions.liningType.key, 'lined');
  assert.equal(quote.items[0].selectedOptions.interliningType.key, 'interlined');
  assert.ok(material && material.totalPence > 0);
  assert.ok(workmanship && workmanship.totalPence > 0);
  assert.equal(
    quote.breakdown.totalPence,
    quote.breakdown.fabric[0].totalPence +
      quote.breakdown.makingCharge[0].totalPence +
      accessories.reduce((sum, item) => sum + item.totalPence, 0),
  );
});
