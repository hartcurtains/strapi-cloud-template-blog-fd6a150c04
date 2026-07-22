/**
 * curtain-pole router
 */

import { factories } from '@strapi/strapi';
const { mutationPolicyConfig } = require('../../../catalog/catalog-mutation-surface');

const mutation = mutationPolicyConfig('api::curtain-pole.curtain-pole');
export default factories.createCoreRouter('api::curtain-pole.curtain-pole', {
  config: { find: { auth: false }, findOne: { auth: false }, create: mutation, update: mutation, delete: mutation },
});
