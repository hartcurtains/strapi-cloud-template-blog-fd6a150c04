import {
  calculateMadeToMeasureQuote,
  calculateSampleQuote,
  MadeToMeasureValidationError,
} from '../services/made-to-measure'
import { buildCatalogueSnapshot } from '../services/catalogue-snapshot'

const firstMediaUrl = (media: any): string | null => {
  const visit = (value: any): string | null => {
    if (!value) return null
    if (typeof value === 'string') return value
    if (Array.isArray(value)) {
      for (const entry of value) {
        const url = visit(entry)
        if (url) return url
      }
      return null
    }
    if (typeof value !== 'object') return null

    // Option cards only need a tiny derivative. Returning the original media
    // here makes a 1–3 MB image download for every drawer card.
    for (const derivative of ['thumbnail', 'small', 'medium', 'large']) {
      const url = visit(value.formats?.[derivative])
      if (url) return url
    }
    for (const nested of [value.data, value.attributes]) {
      const url = visit(nested)
      if (url) return url
    }
    if (typeof value.url === 'string') return value.url
    return null
  }
  return visit(media)
}

const identity = (item: any) => ({
  id: item.documentId || item.id,
  documentId: item.documentId || null,
  numericId: item.id || null,
  key: item.key || null,
})

const findPublicOptions = async (strapi: any, section: string, uid: string, options: any = {}, requestId: string, optional = false) => {
  const query = {
    publicationState: 'live',
    limit: 200,
    // `id` is present in every deployed content type. Optional configurator
    // schemas may add sort_order, but the legacy production schemas do not.
    sort: options.sort || ['id:asc'],
    ...(options.filters ? { filters: options.filters } : {}),
    ...(options.populate ? { populate: options.populate } : {}),
  }
  const log = (level: 'info' | 'error', payload: Record<string, any>) => {
    const logger = strapi?.log?.[level]
    if (typeof logger === 'function') logger(JSON.stringify({ requestId, section, ...payload }))
  }
  log('info', { event: 'configurator-options-query-start', uid, filters: query.filters || {}, populate: query.populate || {} })
  try {
    const records = await strapi.entityService.findMany(uid, query)
    if (!Array.isArray(records)) {
      const shapeError = new Error(`Expected an array from ${uid}, received ${records === null ? 'null' : typeof records}`)
      log('error', { event: 'configurator-options-query-failure', uid, errorName: shapeError.name, errorMessage: shapeError.message, stack: shapeError.stack })
      throw shapeError
    }
    log('info', { event: 'configurator-options-query-success', uid, resultType: 'array', resultCount: records.length })
    return records
  } catch (error: any) {
    log('error', { event: 'configurator-options-query-failure', uid, errorName: error?.name || 'Error', errorMessage: error?.message || String(error), stack: error?.stack || null })
    if (optional) {
      log('info', { event: 'configurator-options-query-optional-empty', uid })
      return []
    }
    throw error
  }
}

function publicOption(item: any, extra: Record<string, any> = {}) {
  return {
    ...identity(item),
    label: item.display_name || item.name || item.liningType || item.colour || '',
    name: item.display_name || item.name || item.liningType || item.colour || '',
    active: item.active !== false,
    sortOrder: Number(item.sort_order) || 0,
    ...extra,
  }
}

function relationItems(value: any): any[] {
  const items = Array.isArray(value) ? value : (Array.isArray(value?.data) ? value.data : [])
  return items.map((item: any) => item?.attributes ? {
    ...item.attributes,
    id: item.id ?? item.attributes.id,
    documentId: item.documentId ?? item.attributes.documentId,
  } : item).filter(Boolean)
}

function publicLiningType(item: any, fallbackColours: any[] = [], appliesField: 'applies_to_curtains' | 'applies_to_blinds' = 'applies_to_curtains') {
  const typeIdentifiers = new Set([item.key, item.documentId, item.id].filter(Boolean).map((value: any) => String(value)))
  const linkedColours = relationItems(item.lining_colour_options)
  const compatibleFallbackColours = fallbackColours.filter((colour: any) => {
    if (colour[appliesField] !== true) return false
    return relationItems(colour.compatible_lining_types).some((type: any) =>
      [type.key, type.documentId, type.id].filter(Boolean).some((value: any) => typeIdentifiers.has(String(value)))
    )
  })
  const isInterlining = /interlin/i.test(String(item.key || item.display_name || item.liningType || item.name || ''))
  const colours = isInterlining ? [] : (linkedColours.length > 0 ? linkedColours : compatibleFallbackColours)
  const displayName = /full\s+lining/i.test(String(item.display_name || item.liningType || item.name || ''))
    ? 'Standard Lining'
    : item.display_name || item.liningType || item.name || ''

  return publicOption({ ...item, display_name: displayName }, {
    liningType: displayName,
    pricePerMetre: Number(item.price_per_metre) || 0,
    pricePerMetrePence: Math.round((Number(item.price_per_metre) || 0) * 100),
    blackout: item.blackout === true,
    appliesToCurtains: item.applies_to_curtains === true,
    appliesToBlinds: item.applies_to_blinds === true,
    thumbnail: firstMediaUrl(item.thumbnail),
    requiresColour: !isInterlining,
    availableColours: colours.filter((colour: any) => colour?.active !== false).map(publicLiningColour),
  })
}

function publicLiningColour(item: any) {
  return publicOption(item, {
    thumbnail: firstMediaUrl(item.thumbnail),
    hex: item.hex || null,
    appliesToCurtains: item.applies_to_curtains === true,
    appliesToBlinds: item.applies_to_blinds === true,
    compatibleLiningTypeKeys: relationItems(item.compatible_lining_types).map((type: any) => type.key || type.documentId || type.id).filter(Boolean),
  })
}

function configMetadata(config: any, fallbackKey: string) {
  return config ? {
    key: fallbackKey,
    leadTime: config.delivery_lead_time || null,
    message: config.delivery_message || null,
    deliveryReturnsCopy: config.delivery_returns_copy || null,
    disabledOptionCategories: Array.isArray(config.disabled_option_categories) ? config.disabled_option_categories : [],
  } : {
    key: fallbackKey,
    leadTime: null,
    message: null,
    deliveryReturnsCopy: null,
    disabledOptionCategories: [],
  }
}

function liningPricingRules(linings: any[]) {
  const values = linings.map((lining: any) => ({ key: lining.key || lining.documentId || lining.id, perMetre: Number(lining.pricePerMetre ?? lining.price_per_metre) || 0 }))
  const uniqueValues = [...new Set(values.map(item => item.perMetre))]
  return {
    liningPerMetre: uniqueValues.length === 1 ? uniqueValues[0] : null,
    byLiningTypeKey: Object.fromEntries(values.map(item => [item.key, item.perMetre])),
    source: 'lining.price_per_metre',
  }
}

export default {
  async navigation(ctx: any) {
    const [fabrics, brands, curtainPoles, linings, curtainTypes] = await Promise.all([
      strapi.entityService.findMany('api::fabric.fabric', {
        publicationState: 'live',
        filters: { availability: 'in_stock' },
        fields: ['name', 'slug', 'pattern', 'is_curtain', 'is_blind', 'is_cushion', 'availability'],
        populate: { brand: { fields: ['name'] }, colours: { fields: ['name'] } },
        limit: 1000,
        sort: ['name:asc'],
      }),
      strapi.entityService.findMany('api::brand.brand', { publicationState: 'live', fields: ['name'], limit: 100, sort: ['name:asc'] }),
      strapi.entityService.findMany('api::curtain-pole.curtain-pole', { publicationState: 'live', fields: ['name'], limit: 200, sort: ['name:asc'] }),
      strapi.entityService.findMany('api::lining.lining', { publicationState: 'live', fields: ['liningType'], limit: 100, sort: ['liningType:asc'] }),
      strapi.entityService.findMany('api::curtain-type.curtain-type', { publicationState: 'live', fields: ['name'], limit: 100, sort: ['name:asc'] }),
    ])
    const fabricIndex = (Array.isArray(fabrics) ? fabrics : []).map((item: any) => ({
      ...identity(item), name: item.name || '', slug: item.slug || '', pattern: item.pattern || '', availability: item.availability || '',
      is_curtain: item.is_curtain === true, is_blind: item.is_blind === true, is_cushion: item.is_cushion === true,
      brand: item.brand ? { id: item.brand.documentId || item.brand.id, name: item.brand.name || '' } : null,
      colours: (Array.isArray(item.colours) ? item.colours : []).map((colour: any) => ({ id: colour.documentId || colour.id, name: colour.name || '' })),
    }))
    ctx.set('Cache-Control', 'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400')
    ctx.body = { data: {
      brands: (Array.isArray(brands) ? brands : []).map((item: any) => ({ ...identity(item), name: item.name || '' })),
      fabrics: fabricIndex, curtains: fabricIndex.filter((item: any) => item.is_curtain), blinds: fabricIndex.filter((item: any) => item.is_blind), cushions: fabricIndex.filter((item: any) => item.is_cushion),
      curtainPoles: (Array.isArray(curtainPoles) ? curtainPoles : []).map((item: any) => ({ ...identity(item), name: item.name || '' })),
      linings: (Array.isArray(linings) ? linings : []).map((item: any) => ({ ...identity(item), name: item.liningType || 'Lining', liningType: item.liningType || 'Lining' })),
      curtainTypes: (Array.isArray(curtainTypes) ? curtainTypes : []).map((item: any) => ({ ...identity(item), name: item.name || '' })),
    } }
  },

  async catalogueSnapshot(ctx: any) {
    const requestId = ctx.get('x-request-id') || `catalogue-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const snapshot = await buildCatalogueSnapshot(strapi, requestId)
    // Next owns the long-lived tagged cache. Keep this authenticated upstream
    // response out of shared edge caches so a refresh always reads the latest
    // live database state instead of serving a stale aggregate.
    ctx.set('Cache-Control', 'private, no-store')
    ctx.body = { data: snapshot }
  },

  async configuratorOptions(ctx: any) {
    const requestId = ctx.get('x-request-id') || `configurator-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    if (typeof strapi?.log?.info === 'function') strapi.log.info(JSON.stringify({ event: 'configurator-options-request-start', requestId, path: ctx.path }))
    const [curtainTypes, blindTypes, legacyTrimmings, linings, liningColours, mechanisations, mechanismFinishes, cushionFinishes, cushionPads, cushionSizes, pricingRules, configurations] = await Promise.all([
      // These filters/relations are not present in the deployed legacy schemas.
      findPublicOptions(strapi, 'curtain-types', 'api::curtain-type.curtain-type', { populate: { thumbnail: true } }, requestId),
      findPublicOptions(strapi, 'blind-types', 'api::blind-type.blind-type', { populate: { thumbnail: true } }, requestId),
      findPublicOptions(strapi, 'trimmings', 'api::trimming.trimming', {}, requestId),
      findPublicOptions(strapi, 'linings', 'api::lining.lining', { populate: { thumbnail: true, lining_colour_options: { populate: { thumbnail: true } } } }, requestId),
      findPublicOptions(strapi, 'lining-colours', 'api::lining-colour.lining-colour', { populate: { thumbnail: true, compatible_lining_types: true } }, requestId),
      findPublicOptions(strapi, 'mechanisations', 'api::mechanisation.mechanisation', { populate: { thumbnail: true, mechanism_finishes: true } }, requestId),
      findPublicOptions(strapi, 'mechanism-finishes', 'api::mechanism-finish.mechanism-finish', { populate: { thumbnail: true, compatible_mechanisations: true } }, requestId, true),
      findPublicOptions(strapi, 'cushion-finishes', 'api::cushion-piping.cushion-piping', { populate: { thumbnail: true } }, requestId),
      findPublicOptions(strapi, 'cushion-pads', 'api::cushion-pad.cushion-pad', { populate: { thumbnail: true } }, requestId),
      findPublicOptions(strapi, 'cushion-sizes', 'api::cushion-size.cushion-size', { populate: { thumbnail: true } }, requestId),
      findPublicOptions(strapi, 'pricing-rules', 'api::pricing-rule.pricing-rule', {}, requestId),
      findPublicOptions(strapi, 'configurations', 'api::made-to-measure-configuration.made-to-measure-configuration', { filters: { active: true } }, requestId, true),
    ])
    const configurationByType = Object.fromEntries(configurations.map((item: any) => [item.product_type, item]))
    const activeLinings = linings.filter((item: any) => item.active !== false && item.is_configurator_option !== false && !/no[-_ ]lining|none|unlined/i.test(String(item.key || item.display_name || item.liningType || item.name || '')))
    const activeLiningColours = liningColours.filter((item: any) => item.active !== false)
    const curtainLiningTypes = activeLinings.filter((item: any) => item.applies_to_curtains === true).map((item: any) => publicLiningType(item, activeLiningColours, 'applies_to_curtains'))
    const blindLiningTypes = activeLinings.filter((item: any) => item.applies_to_blinds === true).map((item: any) => publicLiningType(item, activeLiningColours, 'applies_to_blinds'))
    const curtainLiningColours = activeLiningColours.filter((item: any) => item.applies_to_curtains === true).map(publicLiningColour)
    const blindLiningColours = activeLiningColours.filter((item: any) => item.applies_to_blinds === true).map(publicLiningColour)
    const activeCushionFinishes = cushionFinishes.filter((item: any) => ['piped', 'unpiped'].includes(item.type))
    const sampleConfiguration = configurationByType.fabric_sample
    const parsedSampleUnitPricePence = Number(sampleConfiguration?.sample_unit_price_pence)
    const parsedSampleMaximumQuantity = Number(sampleConfiguration?.sample_max_quantity)
    const sampleUnitPricePence = Number.isSafeInteger(parsedSampleUnitPricePence) && parsedSampleUnitPricePence >= 0 ? parsedSampleUnitPricePence : null
    const sampleMaximumQuantity = Number.isSafeInteger(parsedSampleMaximumQuantity) && parsedSampleMaximumQuantity >= 1 ? parsedSampleMaximumQuantity : null
    const sampleConfigured = Boolean(sampleConfiguration && sampleUnitPricePence !== null && sampleMaximumQuantity !== null)
    const data = {
      curtain: {
        curtainTypes: curtainTypes.map((item: any) => publicOption(item, { fullnessMultiplier: Number(item.fullness_multiplier) || 0, thumbnail: firstMediaUrl(item.thumbnail) })),
        liningTypes: curtainLiningTypes,
        liningColours: curtainLiningColours,
        surchargeRules: liningPricingRules(curtainLiningTypes),
        delivery: configMetadata(configurationByType.curtain, 'curtain'),
        disabledOptionCategories: ['trimmings', 'curtain_poles', 'curtain_tracks'],
      },
      blind: {
        blindTypes: blindTypes.map((item: any) => publicOption(item, { thumbnail: firstMediaUrl(item.thumbnail) })),
        mechanisms: mechanisations.map((item: any) => publicOption(item, { thumbnail: firstMediaUrl(item.thumbnail), mechanismFamily: item.mechanism_family || null, price: Number(item.price) || 0, compatibleFinishKeys: Array.isArray(item.mechanism_finishes) ? item.mechanism_finishes.map((finish: any) => finish.key || finish.documentId || finish.id).filter(Boolean) : [] })),
        mechanismFinishes: mechanismFinishes.map((item: any) => publicOption(item, { thumbnail: firstMediaUrl(item.thumbnail), compatibleMechanismKeys: Array.isArray(item.compatible_mechanisations) ? item.compatible_mechanisations.map((mechanism: any) => mechanism.key || mechanism.documentId || mechanism.id).filter(Boolean) : [] })),
        liningTypes: blindLiningTypes,
        liningColours: blindLiningColours,
        surchargeRules: liningPricingRules(blindLiningTypes),
        delivery: configMetadata(configurationByType.blind, 'blind'),
        disabledOptionCategories: ['trimmings'],
      },
      cushion: {
        finishes: activeCushionFinishes.map((item: any) => publicOption(item, { type: item.type, price: Number(item.price) || 0, thumbnail: firstMediaUrl(item.thumbnail) })),
        sizes: cushionSizes.map((item: any) => publicOption(item, {
          shape: item.shape,
          width_cm: Number(item.width_cm),
          height_cm: Number(item.height_cm),
          workmanshipCost: item.workmanship_cost == null ? 25 : Number(item.workmanship_cost),
          duckFeatherSurcharge: Number(item.duck_feather_surcharge) || 0,
          thumbnail: firstMediaUrl(item.thumbnail),
        })),
        pads: cushionPads.map((item: any) => publicOption(item, {
          type: item.type,
          // Duck Feather is priced by the selected size surcharge. Cover Only
          // is the zero-cost base option; neither uses the legacy generic pad
          // price stored on the pad row.
          price: item.type === 'duck_feather' || item.type === 'cover_only'
            ? 0
            : item.price == null ? null : Number(item.price),
          priceMode: item.type === 'duck_feather' ? 'size_surcharge' : 'fixed',
          thumbnail: firstMediaUrl(item.thumbnail),
        })),
        delivery: configMetadata(configurationByType.cushion, 'cushion'),
      },
      sample: {
        enabled: sampleConfigured,
        unitPrice: sampleUnitPricePence !== null ? sampleUnitPricePence / 100 : null,
        unitPricePence: sampleUnitPricePence,
        currency: 'GBP',
        maximumQuantity: sampleMaximumQuantity,
        maxQuantity: sampleMaximumQuantity,
        unavailableReason: sampleConfigured ? null : 'Fabric sample ordering is not configured.',
        delivery: configMetadata(sampleConfiguration, 'fabric-sample'),
      },
      // Legacy keys remain stable for existing consumers, but disabled option
      // collections are empty so they cannot be selected by new configurators.
      curtainTypes: curtainTypes.map((item: any) => publicOption(item, { thumbnail: firstMediaUrl(item.thumbnail) })),
      blindTypes: blindTypes.map((item: any) => publicOption(item, { thumbnail: firstMediaUrl(item.thumbnail) })),
      trimmings: [],
      linings: curtainLiningTypes,
      liningColours: curtainLiningColours,
      mechanisations: mechanisations.map((item: any) => publicOption(item, { thumbnail: firstMediaUrl(item.thumbnail), price: Number(item.price) || 0 })),
      mechanismFinishes: mechanismFinishes.map((item: any) => publicOption(item, { thumbnail: firstMediaUrl(item.thumbnail), compatibleMechanismKeys: Array.isArray(item.compatible_mechanisations) ? item.compatible_mechanisations.map((mechanism: any) => mechanism.key || mechanism.documentId || mechanism.id).filter(Boolean) : [] })),
      cushionPipingTypes: activeCushionFinishes.map((item: any) => publicOption(item, { type: item.type, price: Number(item.price) || 0, thumbnail: firstMediaUrl(item.thumbnail) })),
      cushionPads: cushionPads.map((item: any) => publicOption(item, {
        type: item.type,
        price: item.type === 'duck_feather' || item.type === 'cover_only'
          ? 0
          : item.price == null ? null : Number(item.price),
        priceMode: item.type === 'duck_feather' ? 'size_surcharge' : 'fixed',
        thumbnail: firstMediaUrl(item.thumbnail),
      })),
      cushionSizes: cushionSizes.map((item: any) => publicOption(item, { shape: item.shape, width_cm: Number(item.width_cm), height_cm: Number(item.height_cm), workmanshipCost: item.workmanship_cost == null ? 25 : Number(item.workmanship_cost), duckFeatherSurcharge: Number(item.duck_feather_surcharge) || 0, thumbnail: firstMediaUrl(item.thumbnail) })),
      // Rule formulas remain server-side implementation details. The public
      // options contract only needs identity metadata; MTM quote/checkout
      // routes resolve the authoritative rule from Strapi when calculating.
      pricingRules: pricingRules.map((item: any) => ({ ...identity(item), name: item.name || '', product_type: item.product_type || '' })),
      disabledLegacyOptions: { trimmings: legacyTrimmings.length === 0, curtainPoles: true, curtainTracks: true },
    }
    ctx.set('Cache-Control', 'public, max-age=300, s-maxage=900, stale-while-revalidate=86400')
    ctx.body = { data }
  },

  async madeToMeasureQuote(ctx: any) {
    try {
      const body = ctx.request.body?.data || ctx.request.body || {}
      const quote = await strapi.service('api::pricing-rule.pricing-rule').calculateMadeToMeasureQuote(body)
      // Persisting the quote is best-effort: the storefront still needs the
      // calculated payload even if the quote content type is unavailable.
      let quoteRecord: any = null
      try {
        quoteRecord = await strapi.entityService.create('api::quote.quote' as any, {
          data: {
            quote_number: `Q-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
            items: quote.items,
            selected_options: quote.items.map((item: any) => item.selectedOptions),
            quote_breakdown: quote.breakdown,
            subtotal: quote.breakdown.subtotal,
            shipping: quote.breakdown.delivery.total,
            total: quote.breakdown.total,
            pricing_version: quote.pricingVersion,
            ...(ctx.state.user?.id ? { user: ctx.state.user.id } : {}),
          },
        })
      } catch (persistError: any) {
        strapi.log.warn('Quote record could not be persisted', persistError)
      }
      return ctx.send({ data: { quoteId: quoteRecord?.documentId || quoteRecord?.id || null, ...quote } })
    } catch (error: any) {
      if (error instanceof MadeToMeasureValidationError) return ctx.badRequest({ error: error.message, details: error.issues })
      strapi.log.error('Made-to-measure quote calculation failed', error)
      return ctx.internalServerError('Quote calculation failed')
    }
  },

  async validateSamples(ctx: any) {
    try {
      const body = ctx.request.body?.data || ctx.request.body || {}
      const quote = await calculateSampleQuote(strapi, body)
      return ctx.send({ data: { requestedTotalQuantity: quote.quantity, maximumQuantity: quote.configuration.maximumQuantity, remainingQuantity: quote.remainingQuantity, unitPrice: quote.configuration.unitPrice, unitPricePence: quote.configuration.unitPricePence, currency: quote.configuration.currency, sampleSubtotal: quote.subtotal, sampleSubtotalPence: quote.subtotalPence, valid: true } })
    } catch (error: any) {
      if (error instanceof MadeToMeasureValidationError) return ctx.badRequest({ error: error.message, details: error.issues, valid: false })
      throw error
    }
  },
}
