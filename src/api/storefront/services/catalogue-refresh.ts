const CATALOGUE_MUTATION_UIDS = [
  'api::fabric.fabric',
  'api::brand.brand',
  'api::colour.colour',
  'api::normalized-colour.normalized-colour',
  'api::curtain-pole.curtain-pole',
  'api::lining.lining',
  'api::lining-colour.lining-colour',
  'api::curtain-type.curtain-type',
  'api::blind-type.blind-type',
  'api::trimming.trimming',
  'api::mechanisation.mechanisation',
  'api::mechanism-finish.mechanism-finish',
  'api::cushion.cushion',
  'api::cushion-piping.cushion-piping',
  'api::cushion-pad.cushion-pad',
  'api::cushion-size.cushion-size',
  'api::cushion-type.cushion-type',
  'api::made-to-measure-configuration.made-to-measure-configuration',
  'api::pricing-rule.pricing-rule',
  'api::care-instruction.care-instruction',
  'api::fabric-colour-asset.fabric-colour-asset',
  'api::fabric-colour-identity.fabric-colour-identity',
]

const registrations = new WeakSet<object>()
const states = new WeakMap<object, { timer: ReturnType<typeof setTimeout> | null; pending: boolean }>()

function refreshUrl(): string | null {
  const frontend = String(process.env.FRONTEND_URL || '').trim()
  if (!frontend) return null
  try {
    return new URL('/api/internal/catalogue/refresh', frontend).toString()
  } catch {
    return null
  }
}

async function postRefresh(reason: string): Promise<void> {
  const url = refreshUrl()
  const secret = String(process.env.CATALOGUE_REFRESH_SECRET || '')
  if (!url || !secret) return

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'strapi-catalogue-change', source: reason }),
      signal: controller.signal,
    })
    if (!response.ok) {
      console.warn(`[catalogue-refresh] Storefront refresh returned HTTP ${response.status}`)
    }
  } catch (error: any) {
    console.warn(`[catalogue-refresh] Storefront refresh failed: ${error?.name || 'Error'}`)
  } finally {
    clearTimeout(timeout)
  }
}

function scheduleRefresh(strapi: any, reason: string): void {
  const state = states.get(strapi) || { timer: null, pending: false }
  state.pending = true
  if (state.timer) clearTimeout(state.timer)
  state.timer = setTimeout(() => {
    state.timer = null
    if (!state.pending) return
    state.pending = false
    void postRefresh(reason)
  }, 250)
  states.set(strapi, state)
}

/**
 * Registers one debounced server-to-server refresh trigger. The secret is
 * read only by Strapi and never sent to a browser or included in catalogue
 * responses. Multiple rows changed by one admin action become one refresh.
 */
export function registerCatalogueRefresh(strapi: any): void {
  if (!strapi || registrations.has(strapi)) return
  const url = refreshUrl()
  const secret = String(process.env.CATALOGUE_REFRESH_SECRET || '')
  if (!url || secret.length < 32) {
    strapi?.log?.warn?.('[catalogue-refresh] Disabled: FRONTEND_URL or CATALOGUE_REFRESH_SECRET is not configured')
    return
  }
  if (typeof strapi?.db?.lifecycles?.subscribe !== 'function') {
    strapi?.log?.warn?.('[catalogue-refresh] Disabled: Strapi lifecycle subscription API is unavailable')
    return
  }

  registrations.add(strapi)
  strapi.db.lifecycles.subscribe({
    models: CATALOGUE_MUTATION_UIDS,
    afterCreate() { scheduleRefresh(strapi, 'afterCreate') },
    afterUpdate() { scheduleRefresh(strapi, 'afterUpdate') },
    afterDelete() { scheduleRefresh(strapi, 'afterDelete') },
    afterCreateMany() { scheduleRefresh(strapi, 'afterCreateMany') },
    afterUpdateMany() { scheduleRefresh(strapi, 'afterUpdateMany') },
    afterDeleteMany() { scheduleRefresh(strapi, 'afterDeleteMany') },
  })
  strapi?.log?.info?.('[catalogue-refresh] Registered public catalogue lifecycle refresh')
}

export { CATALOGUE_MUTATION_UIDS, postRefresh }
