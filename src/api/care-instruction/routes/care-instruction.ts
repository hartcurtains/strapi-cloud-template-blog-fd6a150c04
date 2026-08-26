/**
 * care-instruction router
 */

const { mutationPolicyConfig } = require('../../../catalog/catalog-mutation-surface');

export default {
  routes: [
    {
      method: 'GET',
      path: '/care-instructions',
      handler: 'care-instruction.find',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'GET',
      path: '/care-instructions/:id',
      handler: 'care-instruction.findOne',
      config: {
        auth: false, // Allow public access for reading
      },
    },
    {
      method: 'POST',
      path: '/care-instructions',
      handler: 'care-instruction.create',
      config: mutationPolicyConfig('api::care-instruction.care-instruction'),
    },
    {
      method: 'PUT',
      path: '/care-instructions/:id',
      handler: 'care-instruction.update',
      config: mutationPolicyConfig('api::care-instruction.care-instruction'),
    },
    {
      method: 'DELETE',
      path: '/care-instructions/:id',
      handler: 'care-instruction.delete',
      config: mutationPolicyConfig('api::care-instruction.care-instruction'),
    },
  ],
};
