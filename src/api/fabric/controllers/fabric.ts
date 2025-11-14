/**
 * fabric controller
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::fabric.fabric', ({ strapi }) => ({
  async find(ctx) {
    // Always populate brand and care_instructions
    const { query } = ctx
    const populateQuery = (typeof query.populate === 'object' && query.populate !== null && !Array.isArray(query.populate)) 
      ? (query.populate as Record<string, any>) 
      : {}
    
    // Ensure populate includes brand and care_instructions
    const populate: Record<string, any> = {
      ...populateQuery,
      brand: true,
      care_instructions: true,
      images: populateQuery.images !== undefined ? populateQuery.images : true,
      linings: populateQuery.linings !== undefined ? populateQuery.linings : true,
      trimmings: populateQuery.trimmings !== undefined ? populateQuery.trimmings : true,
      curtains: populateQuery.curtains !== undefined ? populateQuery.curtains : true,
      blinds: populateQuery.blinds !== undefined ? populateQuery.blinds : true,
      cushions: populateQuery.cushions !== undefined ? populateQuery.cushions : true,
    }
    
    const sanitizedQuery = await this.sanitizeQuery(ctx)
    sanitizedQuery.populate = populate
    
    const { results, pagination } = await strapi.entityService.findPage('api::fabric.fabric', sanitizedQuery)
    
    return this.transformResponse(results, { pagination })
  },
  
  async findOne(ctx) {
    // Always populate brand and care_instructions
    const { id } = ctx.params
    const { query } = ctx
    const populateQuery = (typeof query.populate === 'object' && query.populate !== null && !Array.isArray(query.populate)) 
      ? (query.populate as Record<string, any>) 
      : {}
    
    // Ensure populate includes brand and care_instructions
    const populate: Record<string, any> = {
      ...populateQuery,
      brand: true,
      care_instructions: true,
      images: populateQuery.images !== undefined ? populateQuery.images : true,
      linings: populateQuery.linings !== undefined ? populateQuery.linings : true,
      trimmings: populateQuery.trimmings !== undefined ? populateQuery.trimmings : true,
      curtains: populateQuery.curtains !== undefined ? populateQuery.curtains : true,
      blinds: populateQuery.blinds !== undefined ? populateQuery.blinds : true,
      cushions: populateQuery.cushions !== undefined ? populateQuery.cushions : true,
    }
    
    const sanitizedQuery = await this.sanitizeQuery(ctx)
    sanitizedQuery.populate = populate
    
    const entity = await strapi.entityService.findOne('api::fabric.fabric', id, sanitizedQuery)
    
    if (!entity) {
      return ctx.notFound()
    }
    
    return this.transformResponse(entity)
  },
}));
