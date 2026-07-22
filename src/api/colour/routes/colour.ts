/**
 * colour router
 */

import { factories } from '@strapi/strapi';
const { mutationPolicyConfig } = require('../../../catalog/catalog-mutation-surface');

const mutation = mutationPolicyConfig('api::colour.colour');
export default factories.createCoreRouter('api::colour.colour', {
  config: { find: { auth: false }, findOne: { auth: false }, create: mutation, update: mutation, delete: mutation },
});
