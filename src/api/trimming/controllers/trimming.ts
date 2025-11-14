/**
 * trimming controller
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::trimming.trimming', ({ strapi }) => ({
  async find(ctx) {
    const { query } = ctx
    const populateQuery = (typeof query.populate === 'object' && query.populate !== null && !Array.isArray(query.populate)) 
      ? (query.populate as Record<string, any>) 
      : {}
    
    // Ensure all relations are populated
    const populate: Record<string, any> = {
      ...populateQuery,
      // Add any relations that trimmings might have
    }
    
    const sanitizedQuery = await this.sanitizeQuery(ctx)
    sanitizedQuery.populate = populate
    
    const { results, pagination } = await strapi.entityService.findPage('api::trimming.trimming', sanitizedQuery)
    
    return this.transformResponse(results, { pagination })
  },
  
  async findOne(ctx) {
    const { id } = ctx.params
    const { query } = ctx
    const populateQuery = (typeof query.populate === 'object' && query.populate !== null && !Array.isArray(query.populate)) 
      ? (query.populate as Record<string, any>) 
      : {}
    
    // Ensure all relations are populated
    const populate: Record<string, any> = {
      ...populateQuery,
      // Add any relations that trimmings might have
    }
    
    const sanitizedQuery = await this.sanitizeQuery(ctx)
    sanitizedQuery.populate = populate
    
    const entity = await strapi.entityService.findOne('api::trimming.trimming', id, sanitizedQuery)
    
    if (!entity) {
      return ctx.notFound()
    }
    
    return this.transformResponse(entity)
  },
}));
