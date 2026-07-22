/**
 * cushion router
 */

import { factories } from '@strapi/strapi';
const { mutationPolicyConfig } = require('../../../catalog/catalog-mutation-surface');

const mutation = mutationPolicyConfig('api::cushion.cushion');
export default factories.createCoreRouter('api::cushion.cushion', {
  config: { find: { auth: false }, findOne: { auth: false }, create: mutation, update: mutation, delete: mutation },
});
