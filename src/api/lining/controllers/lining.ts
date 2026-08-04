/**
 * lining controller
 */

import { factories } from '@strapi/strapi'

const liningPopulate = (query: any): Record<string, any> => {
  const requested = query?.populate
  const populateQuery = (typeof requested === 'object' && requested !== null && !Array.isArray(requested))
    ? requested as Record<string, any>
    : {}
  return {
    ...populateQuery,
    thumbnail: true,
    lining_colour_options: { populate: { thumbnail: true } },
  }
}

export default factories.createCoreController('api::lining.lining', ({ strapi }) => ({
  async find(ctx) {
    const { query } = ctx
    const populate = liningPopulate(query)
    const sanitizedQuery = await this.sanitizeQuery(ctx)
    sanitizedQuery.populate = populate
    
    const { results, pagination } = await strapi.entityService.findPage('api::lining.lining', sanitizedQuery)
    
    return this.transformResponse(results, { pagination })
  },
  
  async findOne(ctx) {
    const { id } = ctx.params
    const { query } = ctx
    const populate = liningPopulate(query)
    const sanitizedQuery = await this.sanitizeQuery(ctx)
    sanitizedQuery.populate = populate
    
    const entity = await strapi.entityService.findOne('api::lining.lining', id, sanitizedQuery)
    
    if (!entity) {
      return ctx.notFound()
    }
    
    return this.transformResponse(entity)
  },
}));
