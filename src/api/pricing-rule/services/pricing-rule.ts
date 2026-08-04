/**
 * pricing-rule service
 */

import { factories } from '@strapi/strapi';
import { calculateMadeToMeasureQuote } from '../../storefront/services/made-to-measure';

export default factories.createCoreService('api::pricing-rule.pricing-rule', ({ strapi }) => ({
  async calculateMadeToMeasureQuote(input: any) {
    return calculateMadeToMeasureQuote(strapi, input)
  },
}));
