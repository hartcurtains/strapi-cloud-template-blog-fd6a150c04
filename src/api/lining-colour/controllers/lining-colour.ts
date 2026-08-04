/**
 * lining-colour controller
 */

import { factories } from '@strapi/strapi'

const liningColourPopulate = (query: any): Record<string, any> => {
  const requested = query?.populate
  const populateQuery = (typeof requested === 'object' && requested !== null && !Array.isArray(requested))
    ? requested as Record<string, any>
    : {}
  return {
    ...populateQuery,
    thumbnail: true,
    compatible_lining_types: true,
  }
}

export default factories.createCoreController('api::lining-colour.lining-colour' as any, ({ strapi }) => ({
  async find(ctx) {
    const sanitizedQuery = await this.sanitizeQuery(ctx)
    sanitizedQuery.populate = liningColourPopulate(ctx.query)
    const { results, pagination } = await strapi.entityService.findPage('api::lining-colour.lining-colour' as any, sanitizedQuery)
    return this.transformResponse(results, { pagination })
  },

  async findOne(ctx) {
    const sanitizedQuery = await this.sanitizeQuery(ctx)
    sanitizedQuery.populate = liningColourPopulate(ctx.query)
    const entity = await strapi.entityService.findOne('api::lining-colour.lining-colour' as any, ctx.params.id, sanitizedQuery)
    if (!entity) return ctx.notFound()
    return this.transformResponse(entity)
  },
}))
