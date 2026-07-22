'use strict';

const { authenticateAdmin } = require('../auth/catalog-write-auth');

module.exports = async (policyContext: any) => {
  const authentication = policyContext.state.catalogWriteAuth || await authenticateAdmin(policyContext);
  if (!authentication || authentication.kind !== 'admin') {
    return policyContext.unauthorized('Administrator authentication is required.');
  }
  policyContext.state.catalogWriteAuth = authentication;
  return true;
};

export {};
