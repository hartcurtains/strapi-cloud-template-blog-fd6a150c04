'use strict';

const { authenticateCatalogWrite: authenticateCatalogMutation } = require('../auth/catalog-write-auth');

module.exports = async (policyContext: any) => {
  const authentication = policyContext.state.catalogWriteAuth || await authenticateCatalogMutation(policyContext);
  if (!authentication) return false;
  policyContext.state.catalogWriteAuth = authentication;
  return true;
};
