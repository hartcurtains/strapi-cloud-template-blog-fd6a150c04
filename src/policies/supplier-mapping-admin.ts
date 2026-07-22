'use strict';

const { authenticateAdmin } = require('../auth/catalog-write-auth');

module.exports = async (policyContext: any) => {
  const existing = policyContext.state.catalogWriteAuth;
  const authentication = existing || await authenticateAdmin(policyContext);
  if (!authentication || authentication.kind !== 'admin') return false;
  policyContext.state.catalogWriteAuth = authentication;
  return true;
};
