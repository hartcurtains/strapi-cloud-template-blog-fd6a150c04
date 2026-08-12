export const PRICING_VERSION = 'mtm-2026-08-03-v1'
export const SAMPLE_CONFIGURATION_ERROR = 'Fabric sample ordering is not configured.'

import { calculateCushionFabricMetres } from './cushion-pricing'

const PRODUCT_ALIASES: Record<string, string> = {
  curtains: 'curtain',
  curtain: 'curtain',
  blinds: 'blind',
  blind: 'blind',
  cushions: 'cushion',
  cushion: 'cushion',
}

const NO_LINING_KEYS = new Set(['no-lining', 'no_lining', 'none', 'unlined'])

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

// Older cushion-size rows were created before the workmanship field was added
// to the catalogue. Keep the historical £25 per-cushion charge while those
// rows are repaired by bootstrap; new/edited rows always win.
const LEGACY_CUSHION_WORKMANSHIP = 25

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
    if (line?.configuration?.[name] !== undefined) return line.configuration[name]
  }
  return null
}

const hasSelection = (value: any): boolean => value !== null && value !== undefined && value !== ''

const issue = (issues: ValidationIssue[], field: string, message: string) => issues.push({ field, message })

async function findByIdentifier(strapi: any, uid: string, identifier: any, populate: any = undefined, filters: any = {}) {
  const value = optionIdentifier(identifier)
  if (!hasSelection(value)) return null
  const model = typeof strapi.getModel === 'function' ? (strapi.getModel(uid) || null) : null
  const attributes = (model && model.attributes) || null
  // Numeric ids must be queried on `id`; string keys/documentIds must be
  // queried on those fields. Mixing both in one $or makes Strapi throw, so
  // only build filters matching the identifier type. Some content types
  // (e.g. fabric) have no `key` attribute, so only query attributes the
  // content type actually defines. Fall back to the legacy behaviour (include
  // key) when the schema cannot be inspected (e.g. in unit tests).
  const numeric = typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))
  // Every Strapi v5 content type has a `documentId` (it is not always exposed
  // by getModel().attributes), so string identifiers always query it. `key` is
  // only queried when the schema actually defines it (e.g. fabric does not).
  const ors: any[] = numeric ? [{ id: Number(value) }] : [{ documentId: value }]
  if (!numeric && attributes && attributes.key) ors.push({ key: value })
  // Extra filters (e.g. active / is_configurator_option) are validated on the
  // returned record below instead of in the query: combining them with $or in
  // a $and crashes on the deployed Postgres instance, and deployed schemas may
  // not even define them (e.g. curtain-type).
  const safeFilters = attributes
    ? Object.fromEntries(Object.entries(filters || {}).filter(([field]) => Boolean(attributes[field])))
    : (filters || {})
  let record: any = null

  // Strapi 5's document service is more reliable for documentId lookups than
  // the legacy entity service on the deployed Postgres schema. In particular,
  // the latter can throw a null-reference error for the legacy fabric model.
  // Keep the entity-service path as a fallback for numeric IDs and tests.
  if (!numeric && typeof strapi.documents === 'function') {
    try {
      const documentService = strapi.documents(uid)
      if (documentService && typeof documentService.findOne === 'function') {
        record = await documentService.findOne({ documentId: String(value), populate })
      }
      if (!record && attributes?.key && documentService && typeof documentService.findMany === 'function') {
        const keyed = await documentService.findMany({ filters: { key: String(value) }, populate, limit: 1 })
        record = Array.isArray(keyed) ? keyed[0] || null : null
      }
    } catch {
      // Fall through to entityService for older Strapi runtimes.
    }
  }

  if (!record) {
    const results = await strapi.entityService.findMany(uid, {
      publicationState: 'live',
      filters: {
        $and: [
          {},
          { $or: ors },
        ],
      },
      populate,
      limit: 1,
    })
    record = Array.isArray(results) ? results[0] || null : null
  }
  if (!record) return null
  return Object.entries(safeFilters).every(([field, expected]) => record[field] === expected) ? record : null
}

async function activeOption(strapi: any, name: keyof typeof OPTION_UIDS, identifier: any, populate: any = undefined) {
  const uid = OPTION_UIDS[name]
  // Mechanisation records pre-date the configurator flag, so an active
  // mechanism must remain selectable even when that legacy field is absent.
  const extra = ['cushionFinish', 'cushionSize', 'cushionPad', 'liningColour', 'mechanism', 'mechanismFinish'].includes(name)
    ? { active: true }
    : { active: true, is_configurator_option: true }
  return findByIdentifier(strapi, uid, identifier, populate, extra)
}

async function activeBlackoutOption(strapi: any) {
  const results = await strapi.entityService.findMany('api::lining.lining', {
    publicationState: 'live',
    filters: {
      $and: [
        {},
        { $or: [{ key: 'blackout' }, { key: 'blackout-lining' }, { blackout: true }] },
      ],
    },
    limit: 1,
  })
  const record = Array.isArray(results) ? results[0] || null : null
  if (!record || record.active === false) return null
  return record
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
  if (productType === 'cushion') return { type: null, colour: null, interlining: null }
  const typeSelection = selected(line, ['liningTypeKey', 'liningTypeId', 'selectedLiningType', 'liningType'])
  const colourSelection = selected(line, ['liningColourKey', 'liningColourId', 'selectedLiningColour', 'liningColour', 'liningFinish'])
  const interliningSelection = selected(line, ['interliningTypeKey', 'interliningId', 'selectedInterlining', 'interlining'])
  const typeKey = String(optionIdentifier(typeSelection) ?? '').trim().toLowerCase()
  const type = hasSelection(typeSelection) && !NO_LINING_KEYS.has(typeKey)
    ? await activeOption(strapi, 'liningType', typeSelection, { pricing_rule: true })
    : null
  const typeIdentity = String(type?.key ?? type?.display_name ?? type?.name ?? type?.liningType ?? typeSelection?.name ?? typeSelection?.label ?? typeKey)
  const typeIsInterlining = /interlin/i.test(typeIdentity)
  const typeIsBlackout = type?.blackout === true || /blackout/i.test(typeIdentity)
  const typeIsStandard = type?.key === 'lined' || /standard\s+lining/i.test(typeIdentity)
  const colour = hasSelection(colourSelection)
    ? await activeOption(strapi, 'liningColour', colourSelection, { compatible_lining_types: true })
    : null

  // Standard or Blackout is the required base layer for curtains and blinds.
  // Interlining is an optional second layer and cannot be used as the base.
  if (!hasSelection(typeSelection) || NO_LINING_KEYS.has(typeKey) || typeIsInterlining || (!typeIsStandard && !typeIsBlackout)) {
    issue(issues, 'liningType', 'Standard Lining or Blackout Lining is required.')
  } else if (!type) {
    issue(issues, 'liningType', 'The selected lining type is unavailable or inactive.')
  }
  if (!hasSelection(colourSelection)) {
    issue(issues, 'liningColour', 'A lining colour/finish is required when a lining type is selected.')
  } else if (!colour) {
    issue(issues, 'liningColour', 'The selected lining colour/finish is unavailable or inactive.')
  }

  const interlining = hasSelection(interliningSelection)
    ? await activeOption(strapi, 'liningType', interliningSelection, { pricing_rule: true })
    : null
  if (hasSelection(interliningSelection) && (!interlining || !/interlin/i.test(String(interlining.key ?? interlining.display_name ?? interlining.name ?? interlining.liningType ?? '')))) {
    issue(issues, 'interliningType', 'The selected interlining is unavailable or inactive.')
  }
  const interliningColourSelection = selected(line, ['interliningColourKey', 'interliningColourId', 'selectedInterliningColour'])
  if (hasSelection(interliningColourSelection)) issue(issues, 'interliningColour', 'Interlining does not accept a colour selection.')
  if (type && productType === 'curtain' && type.applies_to_curtains !== true) issue(issues, 'liningType', 'This lining type is not available for curtains.')
  if (type && productType === 'blind' && type.applies_to_blinds !== true) issue(issues, 'liningType', 'This lining type is not available for blinds.')
  if (colour && productType === 'curtain' && colour.applies_to_curtains !== true) issue(issues, 'liningColour', 'This lining colour/finish is not available for curtains.')
  if (colour && productType === 'blind' && colour.applies_to_blinds !== true) issue(issues, 'liningColour', 'This lining colour/finish is not available for blinds.')
  if (type && colour) {
    const compatible = Array.isArray(colour.compatible_lining_types) && colour.compatible_lining_types.some((candidate: any) => optionMatches(candidate, type))
    if (!compatible) issue(issues, 'liningColour', 'The selected lining colour/finish is not compatible with the selected lining type.')
  }
  return { type, colour, interlining }
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
  if (lining.type) selectedOptions.liningType = optionSnapshot(lining.type, {
    unitPrice: numberValue(lining.type.price_per_metre),
    unitPricePence: toPence(lining.type.price_per_metre),
    blackout: lining.type.blackout === true,
  })
  if (lining.colour) selectedOptions.liningColour = optionSnapshot(lining.colour, {
  })
  if (lining.interlining) selectedOptions.interliningType = optionSnapshot(lining.interlining, {
    unitPrice: numberValue(lining.interlining.price_per_metre),
    unitPricePence: toPence(lining.interlining.price_per_metre),
  })

  const blackoutRequested = line?.blackoutLining === true || line?.selectedBlackoutLining === true ||
    line?.configuration?.blackoutLining === true || line?.configuration?.selectedBlackoutLining === true
  if (blackoutRequested && productType !== 'cushion' && lining.type?.blackout !== true) {
    issue(issues, 'blackoutLining', 'Blackout and standard lining are mutually exclusive. Select Blackout Lining as the lining type.')
  }

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
    // The deployed legacy mechanisation schema does not define
    // `mechanism_family`. A mechanism with no family metadata is still a
    // valid selectable mechanism; only reject an explicitly non-corded one
    // when a finish is being validated.
    if (mechanism && mechanism.mechanism_family && mechanism.mechanism_family !== 'corded') issue(issues, 'mechanism', 'Mechanism finishes are only valid for corded mechanisms.')
    const compatibleMechanisms = Array.isArray(finish?.compatible_mechanisations) ? finish.compatible_mechanisations : []
    // Empty compatibility relations are the legacy catalogue's universal
    // relation. Only a populated relation can make a finish incompatible.
    if (mechanism && finish && compatibleMechanisms.length > 0 && !compatibleMechanisms.some((candidate: any) => optionMatches(candidate, mechanism))) issue(issues, 'mechanismFinish', 'The selected mechanism finish is not compatible with the selected mechanism.')
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
    if (pad?.type === 'duck_feather' && size && (size.duck_feather_surcharge === null || size.duck_feather_surcharge === undefined)) {
      issue(issues, 'cushionPad', 'Duck Feather pricing is not configured for the selected cushion size.')
    }
    if (finish) selectedOptions.cushionFinish = optionSnapshot(finish, { type: finish.type || null, unitPrice: numberValue(finish.price), unitPricePence: toPence(finish.price) })
    if (size) {
      const workmanshipCost = size.workmanship_cost == null ? null : numberValue(size.workmanship_cost)
      selectedOptions.cushionSize = optionSnapshot(size, {
        width_cm: numberValue(size.width_cm),
        height_cm: numberValue(size.height_cm),
        shape: size.shape || '',
        workmanshipCost,
        workmanshipCostPence: workmanshipCost == null ? null : toPence(workmanshipCost),
        duckFeatherSurcharge: size.duck_feather_surcharge == null ? null : numberValue(size.duck_feather_surcharge),
        duckFeatherSurchargePence: size.duck_feather_surcharge == null ? null : toPence(size.duck_feather_surcharge),
      })
    }
    if (pad) {
      // Duck Feather is size-priced: its catalogue record intentionally has
      // a generic £0 price, while each cushion size stores the £10/£12/£14…
      // surcharge consumed by the Cushion Pricing Rule. Cover Only continues
      // Cover Only is the zero-cost base option; other future pad types may
      // continue to use their own fixed catalogue price.
      const configuredPrice = pad.type === 'duck_feather'
        ? numberValue(size?.duck_feather_surcharge)
        : pad.type === 'cover_only'
          ? 0
        : numberValue(pad.price)
      selectedOptions.cushionPad = optionSnapshot(pad, {
        type: pad.type || null,
        unitPrice: configuredPrice,
        unitPricePence: toPence(configuredPrice),
      })
    }
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

// Existing cushion-size records describe flat two-dimensional cushion sizes.
// Price the two cover faces as a real cut layout in linear metres. The
// cushion-size, piping and pad catalogues remain the source of their own
// prices; this only fixes the fabric quantity fed into the cushion rule.
async function findFabric(strapi: any, identifier: any) {
  return findByIdentifier(strapi, 'api::fabric.fabric', identifier, undefined, {})
}

function evaluateLiningPricingRule(rule: any, data: Record<string, any>, outputStore?: Record<string, any>): number {
  if (!rule?.formula?.steps || !Array.isArray(rule.formula.steps)) return 0
  const store: Record<string, any> = { ...data }
  const resolve = (input: any): any => {
    if (typeof input === 'number') return input
    if (typeof input !== 'string') return input ?? 0
    const trimmed = input.trim()
    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"')))
      return trimmed.slice(1, -1)
    return input.split('.').reduce((obj: any, k) => (obj != null ? obj[k] : undefined), store) ?? 0
  }
  const customRound = (v: number, t: number) => { const d = v % 1; return d > t ? Math.ceil(v) : Math.floor(v) }
  const evalStep = (step: any): number => {
    if (step.operation === 'if_else') {
      const cond = step.condition || ''
      const ops = ['>=', '<=', '!=', '===', '!==', '==', '>', '<']
      let op = '', left = '', right = ''
      for (const o of ops) { if (cond.includes(o)) { op = o; const p = cond.split(o); left = p[0].trim(); right = p.slice(1).join(o).trim(); break } }
      const lv = resolve(left), rv = resolve(right)
      let result = 0
      const check = op === '>' ? lv > rv : op === '<' ? lv < rv : op === '>=' ? lv >= rv : op === '<=' ? lv <= rv : op === '!=' || op === '!==' ? lv != rv : lv == rv
      if (check) {
        if (step.on_true?.sub_steps && Array.isArray(step.on_true.sub_steps)) { for (const s of step.on_true.sub_steps) result = evalStep(s) }
        else if (step.on_true?.operation) result = evalStep(step.on_true)
      } else {
        if (step.on_false?.operation === 'set') {
          result = step.on_false.input !== undefined ? resolve(step.on_false.input) : (step.on_false.inputs?.[0] !== undefined ? resolve(step.on_false.inputs[0]) : 0)
          if (step.on_false.output) store[step.on_false.output] = result
        } else if (step.on_false?.operation) result = evalStep(step.on_false)
      }
      if (step.output) store[step.output] = result
      return result
    }
    const inputs = (step.inputs && step.inputs.length > 0)
      ? step.inputs.map((i: any) => resolve(i))
      : (step.input !== undefined ? [resolve(step.input)] : [])
    let result = 0
    switch (step.operation) {
      case 'multiply': result = (inputs[0] || 0) * (inputs[1] || 0); break
      case 'divide': result = inputs[1] ? (inputs[0] || 0) / inputs[1] : (inputs[0] || 0); break
      case 'add': result = inputs.reduce((s: number, v: any) => s + (v || 0), 0); break
      case 'subtract': result = (inputs[0] || 0) - (inputs[1] || 0); break
      case 'customRound': result = customRound(Number(inputs[0]) || 0, Number(inputs[1]) || 0.5); break
      case 'set': case 'constant': case 'assign': result = inputs[0] || 0; break
      default: result = 0
    }
    if (step.output) store[step.output] = result
    return result
  }
  for (const step of rule.formula.steps) evalStep(step)
  if (outputStore) Object.assign(outputStore, store)
  const finalOutput = rule.formula.finalOutput
  let val = finalOutput ? (store[finalOutput] ?? 0) : 0
  if (!val) { for (const k of ['totalPrice', 'finalPrice', 'total', 'price', 'cost', 'totalInterliningPrice']) { if (store[k] > 0) { val = store[k]; break } } }
  return typeof val === 'number' && !isNaN(val) ? val : 0
}

function splitLiningRuleAmounts(outputs: Record<string, any>, totalAmount: number) {
  const outputKeys = Object.keys(outputs).filter(key => Number.isFinite(Number(outputs[key])))
  const hasWorkmanship = outputKeys.some(key => /workmanship/i.test(key) && !/multiplier/i.test(key))

  const directWorkmanshipKey = outputKeys.find(key => /workmanship.*total|total.*workmanship/i.test(key))
    || outputKeys.find(key => /workmanshipcost/i.test(key))
  const workmanshipAmount = directWorkmanshipKey
    ? numberValue(outputs[directWorkmanshipKey])
    : outputKeys
      .filter(key => /workmanship/i.test(key) && !/multiplier|total/i.test(key))
      .reduce((sum, key) => sum + numberValue(outputs[key]), 0)

  const materialKey = outputKeys.find(key => /^interliningMaterialCost$/i.test(key))
    || outputKeys.find(key => /(?:interlining|lining).*material.*cost/i.test(key))
    || outputKeys.find(key => /^materialCost$/i.test(key))
    || outputKeys.find(key => /materialCost/i.test(key))
  const materialAmount = materialKey ? numberValue(outputs[materialKey]) : 0
  if (!hasWorkmanship) {
    return {
      hasWorkmanship: false,
      // Legacy lining rules may contain additional charges without naming
      // them as workmanship. Keep those rules as one lining charge.
      materialAmount: numberValue(totalAmount),
      workmanshipAmount: 0,
    }
  }
  const additionalAmount = hasWorkmanship
    ? Math.max(0, numberValue(totalAmount) - materialAmount - workmanshipAmount)
    : 0

  return {
    hasWorkmanship,
    materialAmount: materialAmount + additionalAmount,
    workmanshipAmount,
  }
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

export const isAuthoritativeMadeToMeasureLine = (item: any): boolean => {
  const configuration = item?.configuration && typeof item.configuration === 'object' ? item.configuration : {}
  return Boolean(
    item?.madeToMeasureV2 === true || item?.authoritativeQuote === true || item?.selectedOptions ||
    item?.liningTypeKey || item?.cushionPadKey || item?.mechanismFinishKey ||
    configuration.madeToMeasureV2 === true || configuration.authoritativeQuote ||
    configuration.selectedOptions || configuration.liningTypeKey ||
    configuration.liningColourKey || configuration.cushionPadKey ||
    configuration.mechanismFinishKey
  )
}

function evaluatePricingRuleOutputs(rule: any, data: Record<string, any>): Record<string, any> {
  if (!rule?.formula?.steps || !Array.isArray(rule.formula.steps)) return {}
  const store: Record<string, any> = { ...data }
  const resolve = (input: any): any => {
    if (typeof input === 'number') return input
    if (typeof input !== 'string') return input ?? 0
    const trimmed = input.trim()
    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) return trimmed.slice(1, -1)
    return input.split('.').reduce((obj: any, key) => {
      if (key.endsWith('[]')) {
        const array = obj?.[key.slice(0, -2)]
        return Array.isArray(array) ? array : []
      }
      if (Array.isArray(obj)) return obj.map(item => item?.[key])
      return obj != null ? obj[key] : undefined
    }, store) ?? 0
  }
  const evaluateCondition = (condition: any): boolean => {
    if (typeof condition !== 'string') return false
    const operators = ['>=', '<=', '===', '!==', '==', '!=', '>', '<']
    const operator = operators.find(candidate => condition.includes(candidate))
    if (!operator) return false
    const parts = condition.split(operator)
    const left = resolve(parts[0].trim())
    const right = resolve(parts.slice(1).join(operator).trim())
    switch (operator) {
      case '>': return left > right
      case '<': return left < right
      case '>=': return left >= right
      case '<=': return left <= right
      case '!=':
      case '!==': return left != right
      case '==':
      case '===': return left == right
      default: return false
    }
  }
  const sumValue = (value: any): number => {
    if (Array.isArray(value)) return value.reduce((total, item) => total + sumValue(item), 0)
    if (value && typeof value === 'object') return numberValue(value.price)
    return numberValue(value)
  }
  const evaluate = (step: any): any => {
    if (!step || typeof step !== 'object') return 0
    if (step.operation === 'if_else') {
      let result = 0
      const branch = evaluateCondition(step.condition) ? step.on_true : step.on_false
      if (branch?.sub_steps && Array.isArray(branch.sub_steps)) {
        for (const subStep of branch.sub_steps) result = evaluate(subStep)
      } else if (branch?.operation) {
        result = evaluate(branch)
      }
      if (step.output) store[step.output] = result
      return result
    }
    const inputs = Array.isArray(step.inputs) && step.inputs.length
      ? step.inputs.map(resolve)
      : step.input !== undefined ? [resolve(step.input)] : []
    let result = 0
    switch (step.operation) {
      case 'multiply': result = inputs.reduce((total: number, value: any) => total * numberValue(value), 1); break
      case 'divide': result = inputs[1] ? numberValue(inputs[0]) / numberValue(inputs[1]) : numberValue(inputs[0]); break
      case 'add': result = inputs.reduce((total: number, value: any) => total + numberValue(value), 0); break
      case 'subtract': result = numberValue(inputs[0]) - numberValue(inputs[1]); break
      case 'customRound': {
        const value = numberValue(inputs[0])
        const threshold = numberValue(inputs[1], 0.5)
        const decimal = value % 1
        result = decimal > threshold ? Math.ceil(value) : Math.floor(value)
        break
      }
      case 'ceil': result = Math.ceil(numberValue(inputs[0])); break
      case 'ceilDivide': result = numberValue(inputs[1]) ? Math.ceil(numberValue(inputs[0]) / numberValue(inputs[1])) : numberValue(inputs[0]); break
      case 'sum': result = inputs.reduce((total: number, value: any) => total + sumValue(value), 0); break
      case 'set':
      case 'constant':
      case 'assign': result = inputs[0] ?? 0; break
      default: result = 0
    }
    if (step.output) store[step.output] = result
    return result
  }
  for (const step of rule.formula.steps) evaluate(step)
  return store
}

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
  const fullnessMultiplier = numberValue(validated.selectedOptions.curtainType?.fullnessMultiplier, 1)
  let materialMetres = productType === 'cushion'
    ? calculateCushionFabricMetres(fabric, widthCm, heightCm, validated.selectedOptions.cushionFinish?.label)
    : fabricMetres(fabric, productType, widthCm, heightCm, fullnessMultiplier)
  const fabricUnitPence = toPence(fabric?.price_per_metre)
  const cushionRuleData = productType === 'cushion' ? {
    width_cm: widthCm,
    height_cm: heightCm,
    size: {
      fabric_metres: materialMetres,
      workmanship_cost: validated.selectedOptions.cushionSize?.workmanshipCost == null
        ? LEGACY_CUSHION_WORKMANSHIP
        : numberValue(validated.selectedOptions.cushionSize.workmanshipCost),
    },
    fabric: {
      price_per_metre: numberValue(fabric?.price_per_metre),
      usableWidth_cm: numberValue(fabric?.usable_width_cm || fabric?.usableWidth_cm, 137),
      patternRepeat_cm: numberValue(fabric?.pattern_repeat_cm || fabric?.patternRepeat_cm),
    },
    cushion_piping_type: { price: numberValue(validated.selectedOptions.cushionFinish?.unitPrice) },
    cushion_pad: { price: numberValue(validated.selectedOptions.cushionPad?.unitPrice) },
  } : null
  const ruleOutputs = cushionRuleData ? evaluatePricingRuleOutputs(rule, cushionRuleData) : {}
  const nonCushionRuleOutputs = productType === 'cushion' ? {} : evaluatePricingRuleOutputs(rule, {
    width_cm: widthCm,
    height_cm: heightCm,
    quantity,
    fullness_multiplier: fullnessMultiplier,
    curtain_type: { fullness_multiplier: fullnessMultiplier },
    curtain_heading: { name: validated.selectedOptions.curtainType?.label || validated.selectedOptions.curtainType?.name || '' },
    blind_type: validated.selectedOptions.blindType || {},
    mechanism: validated.selectedOptions.mechanism || {},
    fabric: {
      price_per_metre: numberValue(fabric?.price_per_metre),
      usableWidth_cm: numberValue(fabric?.usable_width_cm || fabric?.usableWidth_cm, 137),
      patternRepeat_cm: numberValue(fabric?.pattern_repeat_cm || fabric?.patternRepeat_cm),
    },
    lining: { price_per_metre: numberValue(validated.selectedOptions.liningType?.unitPrice) },
    trimmings: [],
  })
  const liningPricingRule = productType === 'cushion' ? null : validated.lining?.type?.pricing_rule
  const liningRuleOutputs: Record<string, any> = {}
  const liningRuleData = liningPricingRule?.formula?.steps ? {
    width_cm: widthCm,
    height_cm: heightCm,
    curtain_type: { fullness_multiplier: fullnessMultiplier },
    fabric: { usableWidth_cm: numberValue(fabric?.usableWidth_cm || fabric?.usable_width_cm, 137), patternRepeat_cm: numberValue(fabric?.patternRepeat_cm || fabric?.pattern_repeat_cm), hemAllowance_cm: numberValue(fabric?.hemAllowance_cm, 30) },
    interlining: { price_per_metre: numberValue(validated.lining?.type?.price_per_metre) },
    quantity: 1,
  } : null
  const liningRuleTotalAmount = liningPricingRule && liningRuleData
    ? evaluateLiningPricingRule(liningPricingRule, liningRuleData, liningRuleOutputs)
    : 0
  const liningRuleAmounts = splitLiningRuleAmounts(liningRuleOutputs, liningRuleTotalAmount)
  // An all-in lining rule such as Interlining contains its own making labour.
  // It replaces the standard blind/curtain making charge, while the response
  // still exposes that labour as a separate workmanship line.
  const liningRuleIncludesWorkmanship = Boolean(liningPricingRule && liningRuleAmounts.hasWorkmanship)
  const workmanshipAmount = productType === 'cushion'
    ? (ruleOutputs.workmanshipCost ?? rule?.formula?.workmanshipFee ?? rule?.formula?.config?.workmanshipFee ?? validated.selectedOptions.cushionSize?.workmanshipCost ?? LEGACY_CUSHION_WORKMANSHIP)
    : liningRuleIncludesWorkmanship
      ? liningRuleAmounts.workmanshipAmount
    : (rule?.formula?.workmanshipFee ?? rule?.formula?.config?.workmanshipFee ?? nonCushionRuleOutputs.workmanshipCost ?? 0)
  const workmanshipPence = toPence(workmanshipAmount)
  const fabricAmount = productType === 'cushion' && ruleOutputs.fabricCost !== undefined
    ? numberValue(ruleOutputs.fabricCost)
    : numberValue(fabric?.price_per_metre) * materialMetres
  const fabricPence = productType === 'cushion'
    ? toPence(fabricAmount)
    : multiplyPence(fabricUnitPence, materialMetres)
  const baseProductPence = fabricPence + workmanshipPence
  const accessories: any[] = []

  if (validated.selectedOptions.mechanism) {
    const unit = validated.selectedOptions.mechanism.unitPricePence || 0
    accessories.push({ type: 'mechanism', label: validated.selectedOptions.mechanism.label, quantity: 1, unit: 'item', unitPrice: fromPence(unit), unitPricePence: unit, total: fromPence(multiplyPence(unit, quantity)), totalPence: multiplyPence(unit, quantity) })
  }
  if (validated.selectedOptions.cushionFinish) {
    const rulePrice = productType === 'cushion' && ruleOutputs.pipingCost !== undefined ? numberValue(ruleOutputs.pipingCost) : null
    const unit = rulePrice === null ? (validated.selectedOptions.cushionFinish.unitPricePence || 0) : toPence(rulePrice)
    accessories.push({ type: 'cushion_finish', label: validated.selectedOptions.cushionFinish.label, quantity, unit: 'item', unitPrice: fromPence(unit), unitPricePence: unit, total: fromPence(multiplyPence(unit, quantity)), totalPence: multiplyPence(unit, quantity) })
  }
  if (validated.selectedOptions.cushionPad) {
    const rulePrice = productType === 'cushion' && ruleOutputs.padCost !== undefined ? numberValue(ruleOutputs.padCost) : null
    const unit = rulePrice === null ? (validated.selectedOptions.cushionPad.unitPricePence || 0) : toPence(rulePrice)
    accessories.push({ type: 'cushion_pad', label: validated.selectedOptions.cushionPad.label, quantity, unit: 'item', unitPrice: fromPence(unit), unitPricePence: unit, total: fromPence(multiplyPence(unit, quantity)), totalPence: multiplyPence(unit, quantity) })
  }
  const blindTypeLabel = String(validated.selectedOptions.blindType?.label || validated.selectedOptions.blindType?.name || '')
  const requiresRomanTrack = productType === 'blind' && /waterfall|stacked|roman/i.test(blindTypeLabel)
  const liningMetres = productType === 'cushion' ? 0 : requiresRomanTrack ? materialMetres + 0.5 : materialMetres
  if (validated.selectedOptions.liningType) {
    let liningTotalPence: number
    if (liningPricingRule && liningPricingRule.formula && liningPricingRule.formula.steps) {
      // Keep the rule's material and labour components separate so the
      // summary does not present workmanship as a per-metre fabric price.
      liningTotalPence = multiplyPence(toPence(liningRuleAmounts.materialAmount), quantity)
    } else {
      const unit = validated.selectedOptions.liningType.unitPricePence || 0
      liningTotalPence = multiplyPence(unit, liningMetres * quantity)
    }
    const unit = liningTotalPence > 0 ? Math.round(liningTotalPence / (liningMetres * quantity || 1)) : 0
    accessories.push({
      type: liningRuleIncludesWorkmanship ? 'lining_material' : 'lining',
      label: `${validated.selectedOptions.liningType.label}${validated.selectedOptions.liningColour?.label ? ` — ${validated.selectedOptions.liningColour.label}` : ''}`,
      quantity: liningMetres * quantity,
      unit: 'metre',
      unitPrice: fromPence(unit),
      unitPricePence: unit,
      total: fromPence(liningTotalPence),
      totalPence: liningTotalPence,
    })
  }
  if (validated.selectedOptions.interliningType) {
    const unit = validated.selectedOptions.interliningType.unitPricePence || toPence(validated.selectedOptions.interliningType.unitPrice)
    const interliningTotalPence = multiplyPence(unit, liningMetres * quantity)
    accessories.push({
      type: 'interlining',
      label: validated.selectedOptions.interliningType.label || 'Interlining',
      quantity: liningMetres * quantity,
      unit: 'metre',
      unitPrice: fromPence(unit),
      unitPricePence: unit,
      total: fromPence(interliningTotalPence),
      totalPence: interliningTotalPence,
    })
  }
  if (requiresRomanTrack) {
    const trackBaseMetres = materialMetres
    const trackUnitPence = toPence(trackBaseMetres <= 1 ? 100 : 100 + Math.ceil((trackBaseMetres - 1) / 0.5) * 30)
    const trackTotalPence = multiplyPence(trackUnitPence, quantity)
    accessories.push({
      type: 'track',
      label: 'Roman blind track',
      quantity,
      unit: 'item',
      unitPrice: fromPence(trackUnitPence),
      unitPricePence: trackUnitPence,
      total: fromPence(trackTotalPence),
      totalPence: trackTotalPence,
      baseMetres: trackBaseMetres,
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
      makingCharge: { label: liningRuleIncludesWorkmanship ? `${validated.selectedOptions.liningType?.label || 'Lining'} workmanship` : productType === 'blind' ? 'Blind making' : 'Making charge', quantity, unit: 'item', unitPrice: fromPence(workmanshipPence), unitPricePence: workmanshipPence, total: fromPence(multiplyPence(workmanshipPence, quantity)), totalPence: multiplyPence(workmanshipPence, quantity) },
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
