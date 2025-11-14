/**
 * blind controller
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::blind.blind', ({ strapi }) => ({
  async find(ctx) {
    const { query } = ctx
    const populateQuery = (typeof query.populate === 'object' && query.populate !== null && !Array.isArray(query.populate)) 
      ? (query.populate as Record<string, any>) 
      : {}
    
    // Always populate relations
    const populate: Record<string, any> = {
      ...populateQuery,
      fabrics: {
        populate: {
          brand: populateQuery.fabrics?.populate?.brand !== undefined ? populateQuery.fabrics.populate.brand : true,
          images: populateQuery.fabrics?.populate?.images !== undefined ? populateQuery.fabrics.populate.images : true,
        }
      },
      blind_type: populateQuery.blind_type !== undefined ? populateQuery.blind_type : true,
      mechanisations: populateQuery.mechanisations !== undefined ? populateQuery.mechanisations : true,
    }
    
    const sanitizedQuery = await this.sanitizeQuery(ctx)
    sanitizedQuery.populate = populate
    
    const { results, pagination } = await strapi.entityService.findPage('api::blind.blind', sanitizedQuery)
    
    return this.transformResponse(results, { pagination })
  },
  
  async findOne(ctx) {
    const { id } = ctx.params
    const { query } = ctx
    const populateQuery = (typeof query.populate === 'object' && query.populate !== null && !Array.isArray(query.populate)) 
      ? (query.populate as Record<string, any>) 
      : {}
    
    const populate: Record<string, any> = {
      ...populateQuery,
      fabrics: {
        populate: {
          brand: populateQuery.fabrics?.populate?.brand !== undefined ? populateQuery.fabrics.populate.brand : true,
          images: populateQuery.fabrics?.populate?.images !== undefined ? populateQuery.fabrics.populate.images : true,
        }
      },
      blind_type: populateQuery.blind_type !== undefined ? populateQuery.blind_type : true,
      mechanisations: populateQuery.mechanisations !== undefined ? populateQuery.mechanisations : true,
    }
    
    const sanitizedQuery = await this.sanitizeQuery(ctx)
    sanitizedQuery.populate = populate
    
    const entity = await strapi.entityService.findOne('api::blind.blind', id, sanitizedQuery)
    
    if (!entity) {
      return ctx.notFound()
    }
    
    return this.transformResponse(entity)
  },
}));
