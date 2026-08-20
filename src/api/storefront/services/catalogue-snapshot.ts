import { createHash } from 'node:crypto'

const CATALOGUE_UIDS = {
  fabrics: 'api::fabric.fabric',
  brands: 'api::brand.brand',
  curtainPoles: 'api::curtain-pole.curtain-pole',
  linings: 'api::lining.lining',
  curtainTypes: 'api::curtain-type.curtain-type',
  normalizedColours: 'api::normalized-colour.normalized-colour',
} as const

const MAX_ROWS = 5000

function unwrap(value: any): any {
  if (value && typeof value === 'object' && value.data && !Array.isArray(value.data)) {
    return unwrap(value.data)
  }
  if (value && typeof value === 'object' && value.attributes && typeof value.attributes === 'object') {
    return { ...value.attributes, id: value.id ?? value.attributes.id, documentId: value.documentId ?? value.attributes.documentId }
  }
  return value
}

function relationItems(value: any): any[] {
  const source = Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []
  return source.map(unwrap).filter(Boolean)
}

function identity(item: any) {
  return {
    id: item?.documentId || item?.id || null,
    documentId: item?.documentId || null,
    numericId: item?.id || null,
    key: item?.key || null,
  }
}

function publicUrl(value: any): string | null {
  if (!value) return null
  const candidate = typeof value === 'string'
    ? value
    : value.formats?.thumbnail?.url || value.formats?.small?.url || value.url || value.data?.attributes?.formats?.thumbnail?.url || value.data?.attributes?.url || value.attributes?.formats?.thumbnail?.url || value.attributes?.url
  if (typeof candidate !== 'string' || !candidate.trim()) return null
  if (/^https?:\/\//i.test(candidate)) return candidate
  const base = String(process.env.PUBLIC_URL || '').replace(/\/$/, '')
  return base ? `${base}${candidate.startsWith('/') ? '' : '/'}${candidate}` : candidate
}

function mediaList(value: any, alt: string): Array<{ id: any; url: string; alt: string }> {
  const source = Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : []
  const seen = new Set<string>()
  return source.map(unwrap).map((image: any) => ({
    id: image?.id || image?.documentId || null,
    url: publicUrl(image?.formats?.medium || image?.formats?.large || image),
    alt: image?.alternativeText || alt,
  })).filter((image: any) => {
    if (!image.url || seen.has(image.url)) return false
    seen.add(image.url)
    return true
  })
}

function publicBrand(item: any) {
  const source = unwrap(item) || {}
  const thumbnail = publicUrl(source.thumbnail)
  return {
    ...identity(source),
    name: source.name || '',
    slug: source.slug || String(source.documentId || source.id || ''),
    description: source.description || '',
    ...(thumbnail ? { thumbnail: { url: thumbnail }, image: thumbnail } : {}),
    publishedAt: source.publishedAt || null,
  }
}

function publicColour(item: any) {
  const source = unwrap(item) || {}
  return {
    ...identity(source),
    name: source.name || source.colour || '',
    slug: source.slug || `colour-${source.documentId || source.id || ''}`,
    icon: publicUrl(source.thumbnail),
    hex: source.hex || null,
    normalizedColour: source.normalizedColour || null,
    availability: source.availability ?? undefined,
    status: source.status ?? undefined,
    active: source.active ?? undefined,
    isActive: source.isActive ?? undefined,
    publishedAt: source.publishedAt || null,
  }
}

function publicProduct(item: any) {
  const source = unwrap(item) || {}
  const brand = unwrap(source.brand)
  const colours = relationItems(source.colours).map(publicColour)
  const images = mediaList(source.images, source.name || 'Fabric')
  const firstImage = images[0]?.url || publicUrl(source.images?.[0]) || null
  const price = Number(source.price_per_metre ?? source.price ?? 0) || 0
  const brandName = brand?.name || ''
  const normalizedColours = [...new Set(colours.map((colour: any) => colour.normalizedColour).filter(Boolean))]
  const careInstructions = relationItems(source.care_instructions)
    .map((instruction: any) => instruction.name || instruction.type || instruction.description || instruction.title)
    .filter(Boolean)
  const cushions = relationItems(source.cushions).map((cushion: any) => {
    const cushionType = unwrap(cushion.cushion_type)
    return {
      ...identity(cushion),
      name: cushion.name || '',
      slug: cushion.slug || '',
      cushion_type: cushionType ? { ...identity(cushionType), name: cushionType.name || '' } : null,
    }
  })
  const pricingRules = relationItems(source.pricing_rules).map((rule: any) => ({
    ...identity(rule),
    name: rule.name || '',
    product_type: rule.product_type || '',
  }))

  return {
    // Only scalar catalogue fields and deliberately public relations are copied.
    // Orders, supplier mappings and other private relations are never included;
    // pricing rule relations are reduced to public identities only.
    id: String(source.documentId || source.id || ''),
    documentId: source.documentId || undefined,
    numericId: source.id ?? undefined,
    name: source.name || '',
    slug: source.slug || String(source.documentId || source.id || ''),
    description: source.description || '',
    price: `£${price.toFixed(2)}`,
    pricePerMeter: price,
    basePrice: price,
    brand: brandName,
    brand_obj: brand ? publicBrand(brand) : null,
    color: colours.map((colour: any) => colour.name).filter(Boolean).join(', '),
    colours,
    normalizedColours,
    composition: source.composition || 'Premium fabric',
    material: source.material || source.composition || '',
    weight: source.weight || '',
    martindale: source.martindale ? `${source.martindale} rubs` : 'N/A',
    fireRetardant: source.fireRetardant === true || source.fire_retardant === true,
    blackout: source.blackout === true,
    thermal: source.thermal === true,
    rating: Number(source.rating) || 0,
    reviewCount: Number(source.reviewCount) || 0,
    width: source.usableWidth_cm == null ? 'Standard' : `${source.usableWidth_cm}cm`,
    usableWidth_cm: source.usableWidth_cm,
    patternRepeat_cm: source.patternRepeat_cm || 0,
    patternRepeat: source.patternRepeat_cm == null ? '' : `${source.patternRepeat_cm}`,
    pattern: source.pattern || '',
    collection: source.collection || '',
    type: 'fabric',
    productType: 'fabric',
    productTypes: ['fabric'],
    image: firstImage,
    images,
    thumbnail: firstImage,
    isFeatured: source.is_featured === true,
    is_featured: source.is_featured === true,
    featured_until: source.featured_until || null,
    is_curtain: source.is_curtain === true,
    is_blind: source.is_blind === true,
    is_cushion: source.is_cushion === true,
    availability: source.availability ?? undefined,
    status: source.status ?? undefined,
    createdAt: source.createdAt || '',
    updatedAt: source.updatedAt || '',
    publishedAt: source.publishedAt || null,
    productId: source.productId || null,
    price_per_metre: price,
    careInstructions: careInstructions.join(', '),
    care_instructions: careInstructions.map((name: string) => ({ name })),
    curtains: [],
    blinds: [],
    cushions,
    pricing_rules: pricingRules,
    accessories: [],
  }
}

function publicNavigation(products: any[], brands: any[], poles: any[], linings: any[], curtainTypes: any[]) {
  const inStock = products.filter((product: any) => product.availability === 'in_stock')
  const fabricIndex = inStock.map((item: any) => ({
    ...identity(item),
    name: item.name || '',
    slug: item.slug || '',
    pattern: item.pattern || '',
    availability: item.availability || '',
    is_curtain: item.is_curtain === true,
    is_blind: item.is_blind === true,
    is_cushion: item.is_cushion === true,
    brand: item.brand_obj ? { id: item.brand_obj.id, name: item.brand_obj.name || '' } : null,
    colours: Array.isArray(item.colours) ? item.colours.map((colour: any) => ({ id: colour.id, name: colour.name || '' })) : [],
  }))
  const bounded = (value: any[], count: number) => value.slice(0, count)
  return {
    brands: bounded(brands, 100),
    fabrics: bounded(fabricIndex, 100),
    curtains: bounded(fabricIndex.filter((item: any) => item.is_curtain), 50),
    blinds: bounded(fabricIndex.filter((item: any) => item.is_blind), 50),
    cushions: bounded(fabricIndex.filter((item: any) => item.is_cushion), 50),
    curtainPoles: bounded(poles, 200),
    linings: bounded(linings, 200),
    curtainTypes: bounded(curtainTypes, 100),
  }
}

async function findMany(strapi: any, uid: string, query: any = {}, optional = false): Promise<any[]> {
  try {
    const records = await strapi.entityService.findMany(uid, {
      publicationState: 'live',
      limit: MAX_ROWS,
      ...query,
    })
    return Array.isArray(records) ? records : []
  } catch (error: any) {
    // Legacy Strapi schemas differ in a few optional scalar fields. Retry the
    // same explicit relation projection without a field allowlist so a schema
    // drift cannot take the whole aggregate endpoint down. The projection
    // below still copies only known public fields and never populates orders.
    if (query.fields) {
      try {
        const fallbackQuery = { ...query }
        delete fallbackQuery.fields
        const records = await strapi.entityService.findMany(uid, {
          publicationState: 'live',
          limit: MAX_ROWS,
          ...fallbackQuery,
        })
        return Array.isArray(records) ? records : []
      } catch (fallbackError: any) {
        error = fallbackError
      }
    }
    if (optional) {
      strapi?.log?.warn?.(`Public catalogue snapshot skipped ${uid}: ${error?.message || String(error)}`)
      return []
    }
    throw error
  }
}

async function loadConfiguratorOptions(strapi: any, requestId: string): Promise<any | null> {
  const controller = typeof strapi?.controller === 'function'
    ? strapi.controller('api::storefront.storefront')
    : null
  if (!controller || typeof controller.configuratorOptions !== 'function') return null

  const optionContext: any = {
    path: '/api/storefront/configurator-options',
    body: null,
    request: { headers: { 'x-request-id': requestId } },
    get: (name: string) => name.toLowerCase() === 'x-request-id' ? requestId : '',
    set: () => undefined,
  }
  await controller.configuratorOptions(optionContext)
  return optionContext.body?.data || null
}

function stripFormulaFields(value: any, parentKey = ''): any {
  if (Array.isArray(value)) return value.map(item => stripFormulaFields(item, parentKey))
  if (!value || typeof value !== 'object') return value
  const result: Record<string, any> = {}
  const pricingContext = /pricing[_-]?rules?|pricing[_-]?rule/i.test(parentKey)
  for (const [key, nested] of Object.entries(value)) {
    const lower = key.toLowerCase()
    if (lower === 'formula' || (pricingContext && (lower === 'conditions' || lower === 'metadata'))) continue
    if (lower === 'pricingrule' || lower === 'pricing_rule' || lower === 'pricingrules' || lower === 'pricing_rules') {
      if (Array.isArray(nested)) result[key] = nested.map(item => stripFormulaFields(item, key))
      else result[key] = stripFormulaFields(nested, key)
      continue
    }
    result[key] = stripFormulaFields(nested, key)
  }
  return result
}

function snapshotVersion(value: any): string {
  const fingerprint = JSON.stringify(value)
  return createHash('sha256').update(fingerprint).digest('hex').slice(0, 16)
}

export async function buildCatalogueSnapshot(strapi: any, requestId = `catalogue-${Date.now()}`) {
  const [rawFabrics, rawBrands, rawPoles, rawLinings, rawCurtainTypes, rawColours, configuratorOptions] = await Promise.all([
    findMany(strapi, CATALOGUE_UIDS.fabrics, {
      filters: { availability: { $ne: 'discontinued' } },
      sort: ['name:asc'],
      fields: ['name', 'collection', 'patternRepeat_cm', 'usableWidth_cm', 'martindale', 'composition', 'availability', 'price_per_metre', 'is_featured', 'featured_until', 'productId', 'slug', 'pattern', 'description', 'is_curtain', 'is_blind', 'is_cushion', 'createdAt', 'updatedAt', 'publishedAt'],
      populate: {
        images: { fields: ['url', 'alternativeText', 'formats'] },
        brand: { fields: ['name', 'description', 'publishedAt'], populate: { thumbnail: { fields: ['url', 'formats'] } } },
        colours: { fields: ['name', 'normalizedColour', 'publishedAt'], populate: { thumbnail: { fields: ['url', 'formats'] } } },
        care_instructions: { fields: ['name', 'type', 'description', 'title'] },
        cushions: { fields: ['name', 'slug'], populate: { cushion_type: { fields: ['name'] } } },
        pricing_rules: { fields: ['name', 'product_type'] },
      },
    }),
    findMany(strapi, CATALOGUE_UIDS.brands, { sort: ['name:asc'], fields: ['name', 'description', 'publishedAt'], populate: { thumbnail: { fields: ['url', 'formats'] } } }),
    findMany(strapi, CATALOGUE_UIDS.curtainPoles, { sort: ['name:asc'], fields: ['name', 'price', 'allowed_lengths', 'allowed_brackets', 'bracket_requirement', 'publishedAt'], populate: { thumbnail: { fields: ['url', 'formats'] } } }, true),
    findMany(strapi, CATALOGUE_UIDS.linings, { sort: ['liningType:asc'], fields: ['liningType', 'display_name', 'key', 'price_per_metre', 'blackout', 'active', 'sort_order', 'is_configurator_option', 'applies_to_curtains', 'applies_to_blinds', 'publishedAt'], populate: { thumbnail: { fields: ['url', 'formats'] } } }, true),
    findMany(strapi, CATALOGUE_UIDS.curtainTypes, { sort: ['name:asc'], fields: ['name', 'price', 'fullness_multiplier', 'publishedAt'], populate: { thumbnail: { fields: ['url', 'formats'] } } }, true),
    findMany(strapi, CATALOGUE_UIDS.normalizedColours, { sort: ['sortOrder:asc', 'name:asc'], fields: ['name', 'slug', 'swatch', 'sourceNames', 'sortOrder', 'active'] }, true),
    loadConfiguratorOptions(strapi, requestId),
  ])

  const fabrics = rawFabrics.map(publicProduct)
  const brands = rawBrands.map(publicBrand)
  const curtainPoles = rawPoles.map((item: any) => ({ ...identity(unwrap(item)), name: unwrap(item)?.name || '', key: unwrap(item)?.key || null, display_name: unwrap(item)?.display_name || null, active: unwrap(item)?.active !== false, sort_order: Number(unwrap(item)?.sort_order) || 0 }))
  const linings = rawLinings.map((item: any) => ({ ...identity(unwrap(item)), name: unwrap(item)?.liningType || unwrap(item)?.display_name || 'Lining', liningType: unwrap(item)?.liningType || unwrap(item)?.display_name || 'Lining', key: unwrap(item)?.key || null, active: unwrap(item)?.active !== false, sort_order: Number(unwrap(item)?.sort_order) || 0 }))
  const curtainTypes = rawCurtainTypes.map((item: any) => ({ ...identity(unwrap(item)), name: unwrap(item)?.name || unwrap(item)?.display_name || '', key: unwrap(item)?.key || null, active: unwrap(item)?.active !== false, sort_order: Number(unwrap(item)?.sort_order) || 0 }))
  const normalizedColours = rawColours.map((item: any) => {
    const source = unwrap(item) || {}
    return { id: String(source.documentId || source.id || ''), documentId: source.documentId || undefined, name: source.name || '', slug: source.slug || '', swatch: source.swatch || '', sourceNames: Array.isArray(source.sourceNames) ? source.sourceNames : [], sortOrder: Number(source.sortOrder) || 0, active: source.active !== false }
  })
  const navigation = publicNavigation(fabrics, brands, curtainPoles, linings, curtainTypes)
  const publicOptions = stripFormulaFields(configuratorOptions)
  const payload = { brands, fabrics, curtains: fabrics.filter((item: any) => item.is_curtain), blinds: fabrics.filter((item: any) => item.is_blind), cushions: fabrics.filter((item: any) => item.is_cushion), curtainPoles, linings, curtainTypes, normalizedColours, configuratorOptions: publicOptions, navigation }
  return {
    version: snapshotVersion(payload),
    generatedAt: new Date().toISOString(),
    ...payload,
  }
}

export const catalogueContentTypeUids = Object.values(CATALOGUE_UIDS)
