export const PRICING_VERSION = 'mtm-2026-08-03-v1'
export const SAMPLE_CONFIGURATION_ERROR = 'Fabric sample ordering is not configured.'

const PRODUCT_ALIASES: Record<string, string> = {
  curtains: 'curtain',
  curtain: 'curtain',
  blinds: 'blind',
  blind: 'blind',
  cushions: 'cushion',
  cushion: 'cushion',
}

const OPTION_UIDS: Record<string, string> = {
  liningType: 'api::lining.lining',
  liningColour: 'api::lining-colour.lining-colour',
  blindType: 'api::blind-type.blind-type',
  mechanism: 'api::mechanisation.mechanisation',
  mechanismFinish: 'api::mechanism-finish.mechanism-finish',
  cushionFinish: 'api::cushion-piping.cushion-piping',
  cushionSize: 'api::cushion-size.cushion-size',
  cushionPad: 'api::cushion-pad.cushion-pad',
  curtainType: 'api::curtain-type.curtain-type',
}

type ValidationIssue = { field: string; message: string }

export class MadeToMeasureValidationError extends Error {
  issues: ValidationIssue[]

  constructor(issues: ValidationIssue[]) {
    super('Made-to-measure configuration is invalid')
    this.name = 'MadeToMeasureValidationError'
    this.issues = issues
  }
}

const numberValue = (value: any, fallback = 0): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const integerValue = (value: any, fallback = 0): number => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : fallback
}

const identity = (record: any) => ({
  id: record?.documentId || record?.id || null,
  documentId: record?.documentId || null,
  numericId: record?.id || null,
  key: record?.key || null,
  label: record?.display_name || record?.name || record?.liningType || record?.colour || '',
})

const toPence = (amount: any): number => {
  const numeric = numberValue(amount)
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0
}

const fromPence = (pence: number): string => (Math.max(0, Math.round(pence)) / 100).toFixed(2)

export const penceFromDecimal = (value: any): number | null => {
  const text = String(value ?? '').trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  const pounds = Number(whole)
  if (!Number.isSafeInteger(pounds)) return null
  return pounds * 100 + Number((fraction + '00').slice(0, 2))
}

const multiplyPence = (pence: number, quantity: number): number => {
  // Quantities used by the configurator are represented at millimetre/centimetre
  // precision. Scaling before multiplication keeps money arithmetic in pence.
  const scaledQuantity = Math.round(numberValue(quantity) * 10000)
  return Math.round((pence * scaledQuantity) / 10000)
}

const optionIdentifier = (value: any): any => {
  if (value && typeof value === 'object') return value.key || value.documentId || value.id || null
  return value
}

const optionMatches = (record: any, identifier: any): boolean => {
  const value = String(optionIdentifier(identifier) ?? '')
  return Boolean(value) && [record?.key, record?.documentId, record?.id].some(candidate => String(candidate ?? '') === value)
}

const selected = (line: any, names: string[]): any => {
  for (const name of names) {
    if (line?.options?.[name] !== undefined) return line.options[name]
    if (line?.[name] !== undefined) return line[name]
  }
  return null
}

const hasSelection = (value: any): boolean => value !== null && value !== undefined && value !== ''

const issue = (issues: ValidationIssue[], field: string, message: string) => issues.push({ field, message })

async function findByIdentifier(strapi: any, uid: string, identifier: any, populate: any = undefined, filters: any = {}) {
  const value = optionIdentifier(identifier)
  if (!hasSelection(value)) return null
  const results = await strapi.entityService.findMany(uid, {
    publicationState: 'live',
    filters: {
      $and: [
        filters,
        { $or: [{ key: value }, { documentId: value }, { id: value }] },
      ],
    },
    populate,
    limit: 1,
  })
  return Array.isArray(results) ? results[0] || null : null
}

async function activeOption(strapi: any, name: keyof typeof OPTION_UIDS, identifier: any, populate: any = undefined) {
  const uid = OPTION_UIDS[name]
  const extra = ['cushionFinish', 'cushionSize', 'cushionPad', 'liningColour', 'mechanismFinish'].includes(name)
    ? { active: true }
    : { active: true, is_configurator_option: true }
  return findByIdentifier(strapi, uid, identifier, populate, extra)
}

async function activeConfiguration(strapi: any, key: string) {
  try {
    const records = await strapi.entityService.findMany('api::made-to-measure-configuration.made-to-measure-configuration', {
      publicationState: 'live',
      filters: { key, active: true },
      limit: 1,
    })
    return Array.isArray(records) ? records[0] || null : null
  } catch {
    return null
  }
}

export async function getSampleMaxQuantity(strapi: any): Promise<number> {
  const configuration = await getSampleConfiguration(strapi)
  return configuration?.maximumQuantity ?? 0
}

export async function getSampleConfiguration(strapi: any) {
  const configuration = await activeConfiguration(strapi, 'fabric-sample')
  const unitPricePence = integerValue(configuration?.sample_unit_price_pence, -1)
  const maximumQuantity = integerValue(configuration?.sample_max_quantity, -1)
  if (!configuration || unitPricePence < 0 || maximumQuantity < 1) return null
  return {
    unitPricePence,
    unitPrice: fromPence(unitPricePence),
    maximumQuantity,
    currency: 'GBP',
    pricingVersion: configuration.pricing_version || PRICING_VERSION,
    deliveryMessage: configuration.delivery_message || null,
  }
}

export async function requireSampleConfiguration(strapi: any) {
  const configuration = await getSampleConfiguration(strapi)
  if (!configuration) throw new MadeToMeasureValidationError([{ field: 'samples', message: SAMPLE_CONFIGURATION_ERROR }])
  return configuration
}

export async function getDeliveryMetadata(strapi: any) {
  const keys = ['curtain', 'blind', 'cushion', 'fabric-sample']
  const values = await Promise.all(keys.map(key => activeConfiguration(strapi, key)))
  return Object.fromEntries(keys.map((key, index) => [key, values[index] ? {
    key,
    productType: values[index].product_type,
    displayName: values[index].display_name,
    leadTime: values[index].delivery_lead_time || null,
    message: values[index].delivery_message || null,
    deliveryReturnsCopy: values[index].delivery_returns_copy || null,
    disabledOptionCategories: Array.isArray(values[index].disabled_option_categories)
      ? values[index].disabled_option_categories
      : [],
  } : null]))
}

function optionSnapshot(record: any, extra: Record<string, any> = {}) {
  return {
    ...identity(record),
    unitPrice: extra.unitPrice ?? null,
    unitPricePence: extra.unitPricePence ?? (extra.unitPrice != null ? toPence(extra.unitPrice) : null),
    ...extra,
  }
}

async function validateLining(strapi: any, line: any, productType: string, issues: ValidationIssue[]) {
  const typeSelection = selected(line, ['liningTypeKey', 'liningTypeId', 'selectedLiningType', 'liningType'])
  const colourSelection = selected(line, ['liningColourKey', 'liningColourId', 'selectedLiningColour', 'liningColour', 'liningFinish'])
  if (!hasSelection(typeSelection) && !hasSelection(colourSelection)) return { type: null, colour: null }
  if (!hasSelection(typeSelection)) {
    issue(issues, 'liningType', 'A lining type is required when a lining colour/finish is selected.')
    return { type: null, colour: null }
  }
  if (!hasSelection(colourSelection)) {
    issue(issues, 'liningColour', 'A lining colour/finish is required when a lining type is selected.')
    return { type: null, colour: null }
  }

  const type = await activeOption(strapi, 'liningType', typeSelection, undefined)
  const colour = await activeOption(strapi, 'liningColour', colourSelection, { compatible_lining_types: true })
  if (!type) issue(issues, 'liningType', 'The selected lining type is unavailable or inactive.')
  if (!colour) issue(issues, 'liningColour', 'The selected lining colour/finish is unavailable or inactive.')
  if (type && productType === 'curtain' && type.applies_to_curtains !== true) issue(issues, 'liningType', 'This lining type is not available for curtains.')
  if (type && productType === 'blind' && type.applies_to_blinds !== true) issue(issues, 'liningType', 'This lining type is not available for blinds.')
  if (colour && productType === 'curtain' && colour.applies_to_curtains !== true) issue(issues, 'liningColour', 'This lining colour/finish is not available for curtains.')
  if (colour && productType === 'blind' && colour.applies_to_blinds !== true) issue(issues, 'liningColour', 'This lining colour/finish is not available for blinds.')
  if (type && colour) {
    const compatible = Array.isArray(colour.compatible_lining_types) && colour.compatible_lining_types.some((candidate: any) => optionMatches(candidate, type))
    if (!compatible) issue(issues, 'liningColour', 'The selected lining colour/finish is not compatible with the selected lining type.')
  }
  return { type, colour }
}

export async function validateLineOptions(strapi: any, line: any, productTypeInput: string, issues: ValidationIssue[] = []): Promise<{ productType: string, issues: ValidationIssue[], selectedOptions: Record<string, any>, lining?: any }> {
  const productType = PRODUCT_ALIASES[productTypeInput] || productTypeInput
  if (!['curtain', 'blind', 'cushion'].includes(productType)) {
    issue(issues, 'productType', 'Product type must be curtain, blind, or cushion.')
    return { productType, issues, selectedOptions: {} }
  }

  const forbiddenTrimmings = line?.trimmings || line?.selectedTrimmings || line?.options?.trimmings
  if ((productType === 'curtain' || productType === 'blind') && ((Array.isArray(forbiddenTrimmings) && forbiddenTrimmings.length) || hasSelection(line?.trimmingId))) {
    issue(issues, 'trimmings', 'Trimmings are disabled for new made-to-measure curtains and blinds.')
  }
  if (productType === 'curtain' && (hasSelection(line?.curtainPoleId) || hasSelection(line?.curtainTrackId))) {
    issue(issues, 'accessories', 'Curtain poles and tracks are disabled for this made-to-measure flow.')
  }

  const selectedOptions: Record<string, any> = {}
  const lining = await validateLining(strapi, line, productType, issues)
  if (lining.type) selectedOptions.liningType = optionSnapshot(lining.type)
  if (lining.colour) selectedOptions.liningColour = optionSnapshot(lining.colour, {
    unitPrice: numberValue(lining.colour.surcharge_per_metre),
    unitPricePence: toPence(lining.colour.surcharge_per_metre),
    blackout: lining.colour.blackout === true,
  })

  if (productType === 'curtain') {
    const curtainTypeSelection = selected(line, ['curtainTypeKey', 'curtainTypeId', 'selectedCurtainType', 'curtainType'])
    if (hasSelection(curtainTypeSelection)) {
      const curtainType = await activeOption(strapi, 'curtainType', curtainTypeSelection)
      if (!curtainType) issue(issues, 'curtainType', 'The selected curtain type is unavailable or inactive.')
      else selectedOptions.curtainType = optionSnapshot(curtainType, { fullnessMultiplier: numberValue(curtainType.fullness_multiplier, 1) })
    }
  }

  if (productType === 'blind') {
    const blindTypeSelection = selected(line, ['blindTypeKey', 'blindTypeId', 'selectedBlindType', 'blindType'])
    if (hasSelection(blindTypeSelection)) {
      const blindType = await activeOption(strapi, 'blindType', blindTypeSelection)
      if (!blindType) issue(issues, 'blindType', 'The selected blind type is unavailable or inactive.')
      else selectedOptions.blindType = optionSnapshot(blindType)
    }
    const mechanismSelection = selected(line, ['mechanismKey', 'mechanismId', 'selectedMechanism', 'mechanisation'])
    const finishSelection = selected(line, ['mechanismFinishKey', 'mechanismFinishId', 'selectedMechanismFinish', 'mechanismFinish'])
    if (hasSelection(finishSelection) && !hasSelection(mechanismSelection)) issue(issues, 'mechanism', 'A compatible corded mechanism is required when a mechanism finish is selected.')
    const mechanism = hasSelection(mechanismSelection) ? await activeOption(strapi, 'mechanism', mechanismSelection) : null
    const finish = hasSelection(finishSelection) ? await activeOption(strapi, 'mechanismFinish', finishSelection, { compatible_mechanisations: true }) : null
    if (hasSelection(mechanismSelection) && !mechanism) issue(issues, 'mechanism', 'The selected mechanism is unavailable or inactive.')
    if (hasSelection(finishSelection) && !finish) issue(issues, 'mechanismFinish', 'The selected mechanism finish is unavailable or inactive.')
    if (mechanism && mechanism.mechanism_family !== 'corded') issue(issues, 'mechanism', 'Mechanism finishes are only valid for corded mechanisms.')
    if (mechanism && finish && !(Array.isArray(finish.compatible_mechanisations) && finish.compatible_mechanisations.some((candidate: any) => optionMatches(candidate, mechanism)))) issue(issues, 'mechanismFinish', 'The selected mechanism finish is not compatible with the selected mechanism.')
    if (mechanism) selectedOptions.mechanism = optionSnapshot(mechanism, { unitPrice: numberValue(mechanism.price), unitPricePence: toPence(mechanism.price) })
    if (finish) selectedOptions.mechanismFinish = optionSnapshot(finish)
  }

  if (productType === 'cushion') {
    const finishSelection = selected(line, ['cushionFinishKey', 'cushionFinishId', 'selectedPipingId', 'cushionFinish', 'piping'])
    const sizeSelection = selected(line, ['cushionSizeKey', 'cushionSizeId', 'selectedCushionSize', 'size'])
    const padSelection = selected(line, ['cushionPadKey', 'cushionPadId', 'selectedCushionPadId', 'cushionPad', 'pad'])
    const finish = hasSelection(finishSelection) ? await activeOption(strapi, 'cushionFinish', finishSelection) : null
    const size = hasSelection(sizeSelection) ? await activeOption(strapi, 'cushionSize', sizeSelection) : null
    const pad = hasSelection(padSelection) ? await activeOption(strapi, 'cushionPad', padSelection) : null
    if (hasSelection(finishSelection) && (!finish || !['piped', 'unpiped'].includes(finish.type))) issue(issues, 'cushionFinish', 'Only Piped and Unpiped cushion finishes are available for new configurations.')
    if (hasSelection(sizeSelection) && !size) issue(issues, 'cushionSize', 'The selected cushion size is unavailable or inactive.')
    if (hasSelection(padSelection) && !pad) issue(issues, 'cushionPad', 'The selected cushion pad is unavailable or inactive.')
    if (pad?.type === 'duck_feather' && !size) issue(issues, 'cushionSize', 'A valid cushion size is required for Duck Feather Pad.')
    if (finish) selectedOptions.cushionFinish = optionSnapshot(finish, { unitPrice: numberValue(finish.price), unitPricePence: toPence(finish.price) })
    if (size) selectedOptions.cushionSize = optionSnapshot(size, { width_cm: numberValue(size.width_cm), height_cm: numberValue(size.height_cm), shape: size.shape || '', duckFeatherSurcharge: numberValue(size.duck_feather_surcharge), duckFeatherSurchargePence: toPence(size.duck_feather_surcharge) })
    if (pad) selectedOptions.cushionPad = optionSnapshot(pad, { unitPrice: pad.type === 'cover_only' ? 0 : null, unitPricePence: pad.type === 'cover_only' ? 0 : null })
  }

  if (issues.length) throw new MadeToMeasureValidationError(issues)
  return { productType, issues, selectedOptions, lining }
}

const fabricMetres = (fabric: any, productType: string, widthCm: number, heightCm: number, fullnessMultiplier: number) => {
  const usableWidthCm = Math.max(1, numberValue(fabric?.usableWidth_cm || fabric?.usable_width_cm, 137))
  const fullness = productType === 'curtain' ? Math.max(1, fullnessMultiplier) : 1
  const widths = Math.max(1, Math.ceil((widthCm * fullness) / usableWidthCm))
  const hemAllowanceCm = 30
  let cutLengthCm = heightCm + hemAllowanceCm
  const patternRepeatCm = numberValue(fabric?.patternRepeat_cm || fabric?.pattern_repeat_cm)
  if (patternRepeatCm > 0) cutLengthCm = Math.ceil(cutLengthCm / patternRepeatCm) * patternRepeatCm
  return (widths * cutLengthCm) / 100
}

async function findFabric(strapi: any, identifier: any) {
  return findByIdentifier(strapi, 'api::fabric.fabric', identifier, undefined, {})
}

async function pricingRule(strapi: any, productType: string) {
  const rules = await strapi.entityService.findMany('api::pricing-rule.pricing-rule', {
    publicationState: 'live',
    filters: { product_type: productType },
    sort: ['id:desc'],
    limit: 1,
  })
  return Array.isArray(rules) ? rules[0] || null : null
}

export const isSampleLine = (line: any): boolean => {
  const productType = String(line?.productType || line?.category || line?.settings?.productType || line?.settings?.category || '').toLowerCase()
  // isSample is only a UI hint. A sample line must explicitly use the sample
  // product type and its Fabric is resolved below before it is priced.
  return productType === 'sample' || productType === 'samples' || productType === 'fabric_sample'
}

const lineSampleQuantity = (line: any): number => isSampleLine(line) ? Math.max(0, integerValue(line?.quantity, 0)) : 0

export const sampleQuantityForItems = (items: any[]): number => items.reduce((sum, item) => sum + lineSampleQuantity(item), 0)

export async function calculateSampleQuote(strapi: any, input: any) {
  const items = Array.isArray(input?.items) ? input.items : [input]
  const configuration = await requireSampleConfiguration(strapi)
  const sampleItems = items.filter(isSampleLine)
  const issues: ValidationIssue[] = []
  const lines: any[] = []
  for (let index = 0; index < sampleItems.length; index += 1) {
    const item = sampleItems[index]
    const quantity = integerValue(item?.quantity, 0)
    const fabricId = item?.fabricId || item?.fabricDocumentId || item?.fabric?.id || item?.fabric?.documentId
    if (quantity < 1) issue(issues, `items[${index}].quantity`, 'Sample quantity must be a whole number of at least 1.')
    const fabric = hasSelection(fabricId) ? await findFabric(strapi, fabricId) : null
    if (!fabric) issue(issues, `items[${index}].fabricId`, 'The selected fabric is unavailable for sampling.')
    if (fabric && quantity > 0) {
      const subtotalPence = configuration.unitPricePence * quantity
      lines.push({
        ...item,
        productType: 'fabric_sample',
        category: 'fabric_sample',
        isSample: true,
        quantity,
        fabricId: fabric.documentId || fabric.id,
        fabric: optionSnapshot(fabric),
        pricePerUnit: fromPence(configuration.unitPricePence),
        price: fromPence(subtotalPence),
        lineTotal: fromPence(subtotalPence),
        samplePricing: { unitPricePence: configuration.unitPricePence, quantity, subtotalPence, currency: configuration.currency, pricingVersion: configuration.pricingVersion },
      })
    }
  }
  const quantity = lines.reduce((sum, line) => sum + line.quantity, 0)
  if (quantity > configuration.maximumQuantity) issue(issues, 'samples', `A maximum of ${configuration.maximumQuantity} fabric samples may be ordered at one time.`)
  if (issues.length) throw new MadeToMeasureValidationError(issues)
  const subtotalPence = lines.reduce((sum, line) => sum + line.samplePricing.subtotalPence, 0)
  return { configuration, quantity, remainingQuantity: configuration.maximumQuantity - quantity, subtotalPence, subtotal: fromPence(subtotalPence), lines }
}

export const isAuthoritativeMadeToMeasureLine = (item: any): boolean => Boolean(
  item?.madeToMeasureV2 === true || item?.authoritativeQuote === true || item?.selectedOptions ||
  item?.liningTypeKey || item?.cushionPadKey || item?.mechanismFinishKey
)

async function calculateStandardFabricQuote(strapi: any, items: any[]) {
  const issues: ValidationIssue[] = []
  const lines: any[] = []
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const productType = String(item?.productType || item?.category || item?.settings?.productType || '').toLowerCase()
    const fabricId = item?.fabricId || item?.fabricDocumentId || item?.fabric?.id || item?.fabric?.documentId
    const quantity = numberValue(item?.quantity, 0)
    if (!['fabric', 'fabrics'].includes(productType)) issue(issues, `items[${index}].productType`, 'This non-sample line cannot be authoritatively priced.')
    if (quantity <= 0) issue(issues, `items[${index}].quantity`, 'Quantity must be greater than zero.')
    const fabric = hasSelection(fabricId) ? await findFabric(strapi, fabricId) : null
    if (!fabric) issue(issues, `items[${index}].fabricId`, 'The selected fabric is unavailable.')
    if (fabric && quantity > 0 && ['fabric', 'fabrics'].includes(productType)) {
      const unitPricePence = toPence(fabric.price_per_metre)
      const totalPence = multiplyPence(unitPricePence, quantity)
      lines.push({
        ...item,
        productType: 'fabric',
        category: 'fabric',
        quantity,
        fabricId: fabric.documentId || fabric.id,
        fabric: optionSnapshot(fabric),
        pricePerUnit: fromPence(unitPricePence),
        price: fromPence(totalPence),
        lineTotal: fromPence(totalPence),
        pricingSnapshot: { unitPricePence, quantity, subtotalPence: totalPence, currency: 'GBP', pricingVersion: PRICING_VERSION },
      })
    }
  }
  if (issues.length) throw new MadeToMeasureValidationError(issues)
  const subtotalPence = lines.reduce((sum, line) => sum + line.pricingSnapshot.subtotalPence, 0)
  return { lines, subtotalPence, breakdown: { standardFabric: lines.map(line => line.pricingSnapshot) } }
}

export async function calculateOrderQuote(strapi: any, input: any) {
  const items = Array.isArray(input?.items) ? input.items : [input]
  if (!items.length) throw new MadeToMeasureValidationError([{ field: 'items', message: 'At least one item is required.' }])
  const shippingPence = penceFromDecimal(input?.shipping)
  if (shippingPence === null || shippingPence < 0) throw new MadeToMeasureValidationError([{ field: 'shipping', message: 'A valid shipping amount is required.' }])
  const sampleItems = items.filter(isSampleLine)
  const nonSampleItems = items.filter(item => !isSampleLine(item))
  const sampleQuote = sampleItems.length ? await calculateSampleQuote(strapi, { items: sampleItems }) : null
  const madeToMeasureItems = nonSampleItems.filter(isAuthoritativeMadeToMeasureLine)
  const standardFabricItems = nonSampleItems.filter(item => !isAuthoritativeMadeToMeasureLine(item))
  const madeToMeasureQuote = madeToMeasureItems.length
    ? await calculateMadeToMeasureQuote(strapi, { items: madeToMeasureItems, shipping: '0.00' })
    : null
  const standardFabricQuote = standardFabricItems.length
    ? await calculateStandardFabricQuote(strapi, standardFabricItems)
    : { lines: [], subtotalPence: 0, breakdown: { standardFabric: [] } }
  const madeToMeasurePence = madeToMeasureQuote?.breakdown?.subtotalPence || 0
  const samplePence = sampleQuote?.subtotalPence || 0
  const subtotalPence = madeToMeasurePence + standardFabricQuote.subtotalPence + samplePence
  const totalPence = subtotalPence + shippingPence
  return {
    items: [...(madeToMeasureQuote?.items || []), ...standardFabricQuote.lines, ...(sampleQuote?.lines || [])],
    selectedOptions: madeToMeasureQuote?.items?.map((item: any) => item.selectedOptions) || [],
    pricingVersion: sampleQuote?.configuration.pricingVersion || madeToMeasureQuote?.pricingVersion || PRICING_VERSION,
    samplePricingSnapshot: sampleQuote ? {
      unitPricePence: sampleQuote.configuration.unitPricePence,
      currency: sampleQuote.configuration.currency,
      maximumQuantity: sampleQuote.configuration.maximumQuantity,
      sampleQuantity: sampleQuote.quantity,
      sampleSubtotalPence: sampleQuote.subtotalPence,
      pricingVersion: sampleQuote.configuration.pricingVersion,
    } : null,
    breakdown: {
      madeToMeasure: madeToMeasureQuote?.breakdown || null,
      ...standardFabricQuote.breakdown,
      sample: sampleQuote ? { quantity: sampleQuote.quantity, unitPricePence: sampleQuote.configuration.unitPricePence, subtotalPence: sampleQuote.subtotalPence, currency: sampleQuote.configuration.currency } : null,
      discounts: [],
      subtotalPence,
      subtotal: fromPence(subtotalPence),
      shippingPence,
      shipping: fromPence(shippingPence),
      totalPence,
      total: fromPence(totalPence),
    },
  }
}

const lineMeasurements = (line: any) => line?.measurements || line?.settings?.measurements || line

async function calculateLine(strapi: any, line: any, index: number) {
  const productTypeInput = String(line?.productType || line?.category || '')
  const productType = PRODUCT_ALIASES[productTypeInput] || productTypeInput
  const issues: ValidationIssue[] = []
  const validated = await validateLineOptions(strapi, line, productType, issues)
  if (!hasSelection(line?.fabricId)) issue(issues, `items[${index}].fabricId`, 'A fabric is required.')
  const quantity = integerValue(line?.quantity, 1)
  if (quantity < 1 || quantity > 1000) issue(issues, `items[${index}].quantity`, 'Quantity must be a whole number between 1 and 1000.')
  const fabric = hasSelection(line?.fabricId) ? await findFabric(strapi, line.fabricId) : null
  if (hasSelection(line?.fabricId) && !fabric) issue(issues, `items[${index}].fabricId`, 'The selected fabric is unavailable.')

  const measurements = lineMeasurements(line)
  let widthCm = numberValue(measurements?.width_cm ?? measurements?.width)
  let heightCm = numberValue(measurements?.height_cm ?? measurements?.height ?? measurements?.length)
  if (productType === 'cushion' && validated.selectedOptions.cushionSize) {
    widthCm = numberValue(validated.selectedOptions.cushionSize.width_cm, widthCm)
    heightCm = numberValue(validated.selectedOptions.cushionSize.height_cm, heightCm)
  }
  if (widthCm <= 0) issue(issues, `items[${index}].width`, 'A positive width is required.')
  if (heightCm <= 0) issue(issues, `items[${index}].height`, 'A positive height/drop is required.')
  if (issues.length) throw new MadeToMeasureValidationError(issues)

  const rule = await pricingRule(strapi, productType)
  const workmanshipPence = toPence(rule?.formula?.workmanshipFee ?? rule?.formula?.config?.workmanshipFee ?? 0)
  const fullnessMultiplier = numberValue(validated.selectedOptions.curtainType?.fullnessMultiplier, 1)
  const materialMetres = productType === 'cushion'
    ? (widthCm * heightCm) / 10000
    : fabricMetres(fabric, productType, widthCm, heightCm, fullnessMultiplier)
  const fabricUnitPence = toPence(fabric?.price_per_metre)
  const fabricPence = multiplyPence(fabricUnitPence, materialMetres)
  const baseProductPence = fabricPence + workmanshipPence
  const accessories: any[] = []

  if (validated.selectedOptions.mechanism) {
    const unit = validated.selectedOptions.mechanism.unitPricePence || 0
    accessories.push({ type: 'mechanism', label: validated.selectedOptions.mechanism.label, quantity: 1, unit: 'item', unitPrice: fromPence(unit), unitPricePence: unit, total: fromPence(multiplyPence(unit, quantity)), totalPence: multiplyPence(unit, quantity) })
  }
  if (validated.selectedOptions.cushionFinish) {
    const unit = validated.selectedOptions.cushionFinish.unitPricePence || 0
    accessories.push({ type: 'cushion_finish', label: validated.selectedOptions.cushionFinish.label, quantity, unit: 'item', unitPrice: fromPence(unit), unitPricePence: unit, total: fromPence(multiplyPence(unit, quantity)), totalPence: multiplyPence(unit, quantity) })
  }
  if (validated.selectedOptions.cushionPad?.type === 'duck_feather') {
    const unit = validated.selectedOptions.cushionSize?.duckFeatherSurchargePence || 0
    accessories.push({ type: 'cushion_pad', label: validated.selectedOptions.cushionPad.label, quantity, unit: 'item', unitPrice: fromPence(unit), unitPricePence: unit, total: fromPence(multiplyPence(unit, quantity)), totalPence: multiplyPence(unit, quantity) })
  }
  const liningMetres = productType === 'cushion' ? 0 : materialMetres
  if (validated.selectedOptions.liningColour) {
    const unit = validated.selectedOptions.liningColour.unitPricePence || 0
    const total = multiplyPence(unit, liningMetres * quantity)
    accessories.push({
      type: 'lining',
      label: `${validated.selectedOptions.liningType.label} — ${validated.selectedOptions.liningColour.label}`,
      quantity: liningMetres * quantity,
      unit: 'metre',
      unitPrice: fromPence(unit),
      unitPricePence: unit,
      total: fromPence(total),
      totalPence: total,
    })
  }

  const accessoriesPence = accessories.reduce((sum, item) => sum + item.totalPence, 0)
  const baseTotalPence = multiplyPence(baseProductPence, quantity)
  const lineTotalPence = baseTotalPence + accessoriesPence
  return {
    productType,
    quantity,
    fabric: fabric ? optionSnapshot(fabric, { unitPrice: numberValue(fabric.price_per_metre), unitPricePence: fabricUnitPence }) : null,
    selectedOptions: validated.selectedOptions,
    calculatedQuantity: { materialMetres, billableLiningMetres: liningMetres },
    breakdown: {
      baseProduct: { label: 'Base product', total: fromPence(baseTotalPence), totalPence: baseTotalPence },
      fabric: { label: 'Fabric', quantity: materialMetres * quantity, unit: 'metre', unitPrice: fromPence(fabricUnitPence), unitPricePence: fabricUnitPence, total: fromPence(multiplyPence(fabricUnitPence, materialMetres * quantity)), totalPence: multiplyPence(fabricUnitPence, materialMetres * quantity) },
      makingCharge: { label: 'Making charge', quantity, unit: 'item', unitPrice: fromPence(workmanshipPence), unitPricePence: workmanshipPence, total: fromPence(multiplyPence(workmanshipPence, quantity)), totalPence: multiplyPence(workmanshipPence, quantity) },
      accessories,
      discounts: [],
      delivery: { total: '0.00', totalPence: 0 },
      total: fromPence(lineTotalPence),
      totalPence: lineTotalPence,
    },
    snapshot: {
      productType,
      quantity,
      fabric: fabric ? optionSnapshot(fabric) : null,
      selectedOptions: validated.selectedOptions,
      calculatedQuantity: { materialMetres, billableLiningMetres: liningMetres },
      pricingVersion: PRICING_VERSION,
    },
  }
}

export async function calculateMadeToMeasureQuote(strapi: any, input: any) {
  const items = Array.isArray(input?.items) ? input.items : [input]
  if (!items.length) throw new MadeToMeasureValidationError([{ field: 'items', message: 'At least one item is required.' }])
  const sampleQuantity = sampleQuantityForItems(items)
  if (sampleQuantity) {
    const sampleConfiguration = await requireSampleConfiguration(strapi)
    if (sampleQuantity > sampleConfiguration.maximumQuantity) throw new MadeToMeasureValidationError([{ field: 'samples', message: `A maximum of ${sampleConfiguration.maximumQuantity} fabric samples may be ordered at one time.` }])
  }
  const lines = []
  for (let index = 0; index < items.length; index += 1) lines.push(await calculateLine(strapi, items[index], index))
  const lineBreakdowns = lines.map(line => line.breakdown)
  const subtotalPence = lines.reduce((sum, line) => sum + line.breakdown.totalPence, 0)
  const shippingPence = toPence(input?.shipping ?? 0)
  const totalPence = subtotalPence + shippingPence
  return {
    pricingVersion: PRICING_VERSION,
    items: lines.map(line => line.snapshot),
    breakdown: {
      baseProduct: lineBreakdowns.map(item => item.baseProduct),
      fabric: lineBreakdowns.map(item => item.fabric),
      makingCharge: lineBreakdowns.map(item => item.makingCharge),
      accessories: lineBreakdowns.flatMap(item => item.accessories),
      discounts: [],
      delivery: { label: 'Delivery', total: fromPence(shippingPence), totalPence: shippingPence },
      lines: lineBreakdowns,
      subtotal: fromPence(subtotalPence),
      subtotalPence,
      total: fromPence(totalPence),
      totalPence,
      sampleQuantity,
      sampleMaxQuantity: sampleQuantity ? (await requireSampleConfiguration(strapi)).maximumQuantity : null,
    },
  }
}

export { fromPence, toPence }
