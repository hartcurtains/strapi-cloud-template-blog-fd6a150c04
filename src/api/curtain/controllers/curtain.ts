/**
 * curtain controller
 */

import { factories } from '@strapi/strapi'

interface PopulateQuery {
  fabrics?: {
    populate?: {
      brand?: boolean | {
        populate?: {
          thumbnail?: boolean;
        };
      };
      images?: boolean;
    };
  };
  curtain_types?: boolean | {
    populate?: {
      thumbnail?: boolean;
    };
  };
  [key: string]: any;
}

export default factories.createCoreController('api::curtain.curtain', ({ strapi }) => ({
  async find(ctx) {
    try {
      // Use the default sanitizeQuery to handle query parameters
      const sanitizedQueryParams = await this.sanitizeQuery(ctx);
      
      // Get the populate query from the request
      const populateQuery = (sanitizedQueryParams.populate || {}) as PopulateQuery;
      
      // Populate valid relations only - fabrics don't have linings/trimmings relations
      // Remove invalid keys like 'curtain_type' (singular) - only use 'curtain_types' (plural)
      let finalPopulate: any = {};
      
      if (typeof populateQuery === 'object' && populateQuery !== null) {
        // Filter out invalid keys and only keep valid ones
        const validKeys = ['fabrics', 'curtain_types', 'pricing_rules'] // Only valid populate keys for curtains
        const filteredQuery: any = {}
        Object.keys(populateQuery).forEach(key => {
          if (validKeys.includes(key)) {
            filteredQuery[key] = populateQuery[key]
          }
        })
        
        finalPopulate = {
          ...filteredQuery,
          fabrics: {
            populate: {
              brand: populateQuery.fabrics?.populate?.brand !== undefined ? populateQuery.fabrics.populate.brand : true,
              images: populateQuery.fabrics?.populate?.images !== undefined ? populateQuery.fabrics.populate.images : true,
            }
          },
          curtain_types: populateQuery.curtain_types || true,
          pricing_rules: populateQuery.pricing_rules !== undefined ? populateQuery.pricing_rules : true
        };
      } else {
        finalPopulate = {
          fabrics: {
            populate: {
              brand: true,
              images: true
            }
          },
          curtain_types: true,
          pricing_rules: true
        };
      }
      
      const results = await strapi.entityService.findMany("api::curtain.curtain", {
        ...sanitizedQueryParams,
        populate: finalPopulate,
      });
      
      return { data: results, meta: { pagination: { total: results.length } } };
    } catch (error) {
      console.error('❌ Curtain Controller - Error finding curtains:', error);
      return ctx.internalServerError("Failed to find curtains");
    }
  },

  async findOne(ctx) {
    try {
      const sanitizedQueryParams = await this.sanitizeQuery(ctx);
      const { id } = ctx.params;
      
      const populateQuery = (sanitizedQueryParams.populate || {}) as PopulateQuery;
      
      // Populate valid relations only - fabrics don't have linings/trimmings relations
      // Remove invalid keys like 'curtain_type' (singular) - only use 'curtain_types' (plural)
      let finalPopulate: any = {};
      
      if (typeof populateQuery === 'object' && populateQuery !== null) {
        // Filter out invalid keys and only keep valid ones
        const validKeys = ['fabrics', 'curtain_types', 'pricing_rules'] // Only valid populate keys for curtains
        const filteredQuery: any = {}
        Object.keys(populateQuery).forEach(key => {
          if (validKeys.includes(key)) {
            filteredQuery[key] = populateQuery[key]
          }
        })
        
        finalPopulate = {
          ...filteredQuery,
          fabrics: {
            populate: {
              brand: populateQuery.fabrics?.populate?.brand !== undefined ? populateQuery.fabrics.populate.brand : true,
              images: populateQuery.fabrics?.populate?.images !== undefined ? populateQuery.fabrics.populate.images : true,
            }
          },
          curtain_types: populateQuery.curtain_types || true,
          pricing_rules: populateQuery.pricing_rules !== undefined ? populateQuery.pricing_rules : true
        };
      } else {
        finalPopulate = {
          fabrics: {
            populate: {
              brand: true,
              images: true
            }
          },
          curtain_types: true,
          pricing_rules: true
        };
      }
      
      const result = await strapi.entityService.findOne("api::curtain.curtain", id, {
        ...sanitizedQueryParams,
        populate: finalPopulate,
      });
      
      if (!result) {
        return ctx.notFound();
      }
      
      return { data: result };
    } catch (error) {
      console.error('❌ Curtain Controller - Error finding curtain:', error);
      return ctx.internalServerError("Failed to find curtain");
    }
  }
}));
