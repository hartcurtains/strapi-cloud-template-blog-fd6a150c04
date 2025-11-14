/**
 * brand controller
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::brand.brand', ({ strapi }) => ({
  async find(ctx) {
    // Get the populate parameter from query
    const { populate } = ctx.query;
    
    // If fabrics is requested in populate, ensure we fetch them
    // Strapi can parse populate as:
    // - '*' (string)
    // - ['fabrics'] (array when using populate[0]=fabrics)
    // - { fabrics: true } (object)
    const shouldPopulateFabrics = 
      populate === '*' || 
      (Array.isArray(populate) && populate.includes('fabrics')) ||
      (typeof populate === 'object' && populate !== null && 'fabrics' in populate && (populate as any).fabrics);
    
    // Call parent find method
    const { data, meta } = await super.find(ctx);
    
    // If fabrics should be populated but aren't present, manually fetch them
    if (shouldPopulateFabrics && data && Array.isArray(data)) {
      // Fetch all fabrics grouped by brand
      const allFabrics = await strapi.entityService.findMany('api::fabric.fabric', {
        filters: {},
        populate: ['brand'],
      }) as any[];
      
      // Group fabrics by brand ID
      const fabricsByBrand: { [brandId: number]: any[] } = {};
      allFabrics.forEach(fabric => {
        if (fabric.brand && fabric.brand.id) {
          const brandId = fabric.brand.id;
          if (!fabricsByBrand[brandId]) {
            fabricsByBrand[brandId] = [];
          }
          // Remove brand relation to avoid circular reference
          const fabricWithoutBrand = { ...fabric };
          delete fabricWithoutBrand.brand;
          fabricsByBrand[brandId].push(fabricWithoutBrand);
        }
      });
      
      // Attach fabrics to brands that don't have them populated
      data.forEach((brand: any) => {
        if (!brand.fabrics || !Array.isArray(brand.fabrics) || brand.fabrics.length === 0) {
          if (fabricsByBrand[brand.id]) {
            brand.fabrics = fabricsByBrand[brand.id];
          } else {
            brand.fabrics = [];
          }
        }
      });
      
      console.log(`🔧 Brand Controller: Manually populated fabrics for ${data.length} brands`);
    }
    
    return { data, meta };
  },
  
  async findOne(ctx) {
    // Get the populate parameter from query
    const { populate } = ctx.query;
    
    // If fabrics is requested in populate, ensure we fetch them
    // Strapi can parse populate as:
    // - '*' (string)
    // - ['fabrics'] (array when using populate[0]=fabrics)
    // - { fabrics: true } (object)
    const shouldPopulateFabrics = 
      populate === '*' || 
      (Array.isArray(populate) && populate.includes('fabrics')) ||
      (typeof populate === 'object' && populate !== null && 'fabrics' in populate && (populate as any).fabrics);
    
    // Call parent findOne method
    const { data } = await super.findOne(ctx);
    
    // If fabrics should be populated but aren't present, manually fetch them
    if (shouldPopulateFabrics && data) {
      // Fetch all fabrics for this brand
      const brandFabrics = await strapi.entityService.findMany('api::fabric.fabric', {
        filters: {
          brand: {
            id: data.id
          }
        },
      }) as any[];
      
      // Remove brand relation to avoid circular reference
      const fabricsWithoutBrand = brandFabrics.map(fabric => {
        const fabricWithoutBrand = { ...fabric };
        delete fabricWithoutBrand.brand;
        return fabricWithoutBrand;
      });
      
      if (!data.fabrics || !Array.isArray(data.fabrics) || data.fabrics.length === 0) {
        data.fabrics = fabricsWithoutBrand;
        console.log(`🔧 Brand Controller: Manually populated ${fabricsWithoutBrand.length} fabrics for brand "${data.name}"`);
      }
    }
    
    return { data };
  },
}));
