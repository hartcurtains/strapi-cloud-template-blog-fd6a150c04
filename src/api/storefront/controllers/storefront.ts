import {
  calculateMadeToMeasureQuote,
  calculateSampleQuote,
  MadeToMeasureValidationError,
} from '../services/made-to-measure'

const firstMediaUrl = (media: any): string | null => {
  const value = media?.data?.attributes ?? media?.data ?? media?.attributes ?? media
  return typeof value?.url === 'string' ? value.url : null
}

const identity = (item: any) => ({
  id: item.documentId || item.id,
  documentId: item.documentId || null,
  numericId: item.id || null,
  key: item.key || null,
})

const findPublicOptions = async (strapi: any, uid: string, options: any = {}) => {
  const records = await strapi.entityService.findMany(uid, {
    publicationState: 'live',
    limit: 200,
    sort: options.sort || ['sort_order:asc', 'id:asc'],
    ...(options.filters ? { filters: options.filters } : {}),
    ...(options.populate ? { populate: options.populate } : {}),
  })
  return Array.isArray(records) ? records : []
}

const activeConfigurator = { active: true, is_configurator_option: true }

function publicOption(item: any, extra: Record<string, any> = {}) {
  return {
    ...identity(item),
    label: item.display_name || item.name || item.liningType || item.colour || '',
    name: item.display_name || item.name || item.liningType || item.colour || '',
    active: true,
    sortOrder: Number(item.sort_order) || 0,
    ...extra,
  }
}

function publicLiningType(item: any) {
  return publicOption(item, {
    liningType: item.display_name || item.liningType || item.name || '',
    appliesToCurtains: item.applies_to_curtains === true,
    appliesToBlinds: item.applies_to_blinds === true,
  })
}

function publicLiningColour(item: any) {
  return publicOption(item, {
    surchargePerMetre: Number(item.surcharge_per_metre) || 0,
    surchargePerMetrePence: Math.round((Number(item.surcharge_per_metre) || 0) * 100),
    blackout: item.blackout === true,
    appliesToCurtains: item.applies_to_curtains === true,
    appliesToBlinds: item.applies_to_blinds === true,
    compatibleLiningTypeKeys: Array.isArray(item.compatible_lining_types)
      ? item.compatible_lining_types.map((type: any) => type.key || type.documentId || type.id).filter(Boolean)
      : [],
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

function liningSurchargeRules(colours: any[]) {
  const values = colours.map((colour: any) => ({ key: colour.key || colour.documentId || colour.id, perMetre: Number(colour.surchargePerMetre ?? colour.surcharge_per_metre) || 0 }))
  const uniqueValues = [...new Set(values.map(item => item.perMetre))]
  return {
    liningColourPerMetre: uniqueValues.length === 1 ? uniqueValues[0] : null,
    byColourKey: Object.fromEntries(values.map(item => [item.key, item.perMetre])),
    source: 'lining-colour.surcharge_per_metre',
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

  async configuratorOptions(ctx: any) {
    const [curtainTypes, blindTypes, legacyTrimmings, linings, liningColours, mechanisations, mechanismFinishes, cushionFinishes, cushionPads, cushionSizes, pricingRules, configurations] = await Promise.all([
      findPublicOptions(strapi, 'api::curtain-type.curtain-type', { filters: activeConfigurator, populate: { thumbnail: true } }),
      findPublicOptions(strapi, 'api::blind-type.blind-type', { filters: activeConfigurator, populate: { thumbnail: true } }),
      findPublicOptions(strapi, 'api::trimming.trimming', { filters: { active: true, available_for_made_to_measure: true } }),
      findPublicOptions(strapi, 'api::lining.lining', { filters: activeConfigurator, populate: { lining_colour_options: true } }),
      findPublicOptions(strapi, 'api::lining-colour.lining-colour', { filters: { active: true }, populate: { compatible_lining_types: true } }),
      findPublicOptions(strapi, 'api::mechanisation.mechanisation', { filters: activeConfigurator, populate: { mechanism_finishes: true } }),
      findPublicOptions(strapi, 'api::mechanism-finish.mechanism-finish', { filters: { active: true }, populate: { compatible_mechanisations: true } }),
      findPublicOptions(strapi, 'api::cushion-piping.cushion-piping', { filters: { active: true } }),
      findPublicOptions(strapi, 'api::cushion-pad.cushion-pad', { filters: { active: true } }),
      findPublicOptions(strapi, 'api::cushion-size.cushion-size', { filters: { active: true } }),
      findPublicOptions(strapi, 'api::pricing-rule.pricing-rule'),
      findPublicOptions(strapi, 'api::made-to-measure-configuration.made-to-measure-configuration', { filters: { active: true } }),
    ])
    const configurationByType = Object.fromEntries(configurations.map((item: any) => [item.product_type, item]))
    const curtainLiningTypes = linings.filter((item: any) => item.applies_to_curtains === true).map(publicLiningType)
    const blindLiningTypes = linings.filter((item: any) => item.applies_to_blinds === true).map(publicLiningType)
    const curtainLiningColours = liningColours.filter((item: any) => item.applies_to_curtains === true).map(publicLiningColour)
    const blindLiningColours = liningColours.filter((item: any) => item.applies_to_blinds === true).map(publicLiningColour)
    const activeCushionFinishes = cushionFinishes.filter((item: any) => ['piped', 'unpiped'].includes(item.type))
    const data = {
      curtain: {
        curtainTypes: curtainTypes.map((item: any) => publicOption(item, { fullnessMultiplier: Number(item.fullness_multiplier) || 0, thumbnail: firstMediaUrl(item.thumbnail) })),
        liningTypes: curtainLiningTypes,
        liningColours: curtainLiningColours,
        surchargeRules: liningSurchargeRules(curtainLiningColours),
        delivery: configMetadata(configurationByType.curtain, 'curtain'),
        disabledOptionCategories: ['trimmings', 'curtain_poles', 'curtain_tracks'],
      },
      blind: {
        blindTypes: blindTypes.map((item: any) => publicOption(item, { thumbnail: firstMediaUrl(item.thumbnail) })),
        mechanisms: mechanisations.map((item: any) => publicOption(item, { mechanismFamily: item.mechanism_family || null, price: Number(item.price) || 0, compatibleFinishKeys: Array.isArray(item.mechanism_finishes) ? item.mechanism_finishes.map((finish: any) => finish.key || finish.documentId || finish.id).filter(Boolean) : [] })),
        mechanismFinishes: mechanismFinishes.map((item: any) => publicOption(item, { compatibleMechanismKeys: Array.isArray(item.compatible_mechanisations) ? item.compatible_mechanisations.map((mechanism: any) => mechanism.key || mechanism.documentId || mechanism.id).filter(Boolean) : [] })),
        liningTypes: blindLiningTypes,
        liningColours: blindLiningColours,
        surchargeRules: liningSurchargeRules(blindLiningColours),
        delivery: configMetadata(configurationByType.blind, 'blind'),
        disabledOptionCategories: ['trimmings'],
      },
      cushion: {
        finishes: activeCushionFinishes.map((item: any) => publicOption(item, { type: item.type, price: Number(item.price) || 0 })),
        sizes: cushionSizes.map((item: any) => publicOption(item, { shape: item.shape, width_cm: Number(item.width_cm), height_cm: Number(item.height_cm), duckFeatherSurcharge: Number(item.duck_feather_surcharge) || 0 })),
        pads: cushionPads.map((item: any) => publicOption(item, { type: item.type, price: item.type === 'cover_only' ? 0 : null })),
        delivery: configMetadata(configurationByType.cushion, 'cushion'),
      },
      sample: {
        enabled: Boolean(configurationByType.fabric_sample && configurationByType.fabric_sample.sample_unit_price_pence != null && Number.isSafeInteger(Number(configurationByType.fabric_sample.sample_unit_price_pence)) && Number(configurationByType.fabric_sample.sample_unit_price_pence) >= 0 && Number(configurationByType.fabric_sample.sample_max_quantity) >= 1),
        unitPrice: configurationByType.fabric_sample?.sample_unit_price_pence != null ? Number(configurationByType.fabric_sample.sample_unit_price_pence) / 100 : null,
        unitPricePence: configurationByType.fabric_sample?.sample_unit_price_pence ?? null,
        currency: 'GBP',
        maximumQuantity: configurationByType.fabric_sample?.sample_max_quantity ?? null,
        maxQuantity: configurationByType.fabric_sample?.sample_max_quantity ?? null,
        unavailableReason: configurationByType.fabric_sample?.sample_unit_price_pence != null && configurationByType.fabric_sample?.sample_max_quantity != null ? null : 'Fabric sample ordering is not configured.',
        delivery: configMetadata(configurationByType.fabric_sample, 'fabric-sample'),
      },
      // Legacy keys remain stable for existing consumers, but disabled option
      // collections are empty so they cannot be selected by new configurators.
      curtainTypes: curtainTypes.map((item: any) => publicOption(item, { thumbnail: firstMediaUrl(item.thumbnail) })),
      blindTypes: blindTypes.map((item: any) => publicOption(item, { thumbnail: firstMediaUrl(item.thumbnail) })),
      trimmings: [],
      linings: curtainLiningTypes,
      liningColours: curtainLiningColours,
      mechanisations: mechanisations.map((item: any) => publicOption(item, { price: Number(item.price) || 0 })),
      mechanismFinishes: mechanismFinishes.map((item: any) => publicOption(item)),
      cushionPipingTypes: activeCushionFinishes.map((item: any) => publicOption(item, { type: item.type, price: Number(item.price) || 0 })),
      cushionPads: cushionPads.map((item: any) => publicOption(item, { type: item.type, price: item.type === 'cover_only' ? 0 : null })),
      cushionSizes: cushionSizes.map((item: any) => publicOption(item, { shape: item.shape, width_cm: Number(item.width_cm), height_cm: Number(item.height_cm), duckFeatherSurcharge: Number(item.duck_feather_surcharge) || 0 })),
      pricingRules: pricingRules.map((item: any) => ({ ...identity(item), name: item.name || '', product_type: item.product_type || '', formula: item.formula })),
      disabledLegacyOptions: { trimmings: legacyTrimmings.length === 0, curtainPoles: true, curtainTracks: true },
    }
    ctx.set('Cache-Control', 'public, max-age=300, s-maxage=900, stale-while-revalidate=86400')
    ctx.body = { data }
  },

  async madeToMeasureQuote(ctx: any) {
    try {
      const body = ctx.request.body?.data || ctx.request.body || {}
      const quote = await strapi.service('api::pricing-rule.pricing-rule').calculateMadeToMeasureQuote(body)
      const quoteRecord = await strapi.entityService.create('api::quote.quote', {
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
      return ctx.send({ data: { quoteId: quoteRecord.documentId || quoteRecord.id, ...quote } })
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
