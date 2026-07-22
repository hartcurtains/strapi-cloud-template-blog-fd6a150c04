'use strict';

const { authorized, authenticateCatalogWrite } = require('../auth/catalog-write-auth');

module.exports = async (policyContext: any) => {
  const authentication = policyContext.state.catalogWriteAuth || await authenticateCatalogWrite(policyContext);
  return Boolean(authentication);
};

module.exports.authorized = authorized;

export {};
