/**
 * pricing-rule router
 */

import { factories } from '@strapi/strapi';
const { mutationPolicyConfig } = require('../../../catalog/catalog-mutation-surface');

const mutation = mutationPolicyConfig('api::pricing-rule.pricing-rule');
export default factories.createCoreRouter('api::pricing-rule.pricing-rule', {
  config: { find: { auth: false }, findOne: { auth: false }, create: mutation, update: mutation, delete: mutation },
});
