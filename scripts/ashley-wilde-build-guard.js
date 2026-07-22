'use strict';

const { resolveMappingMode } = require('../src/plugins/order-management/shared/ashley-wilde-mapping');

const mode = resolveMappingMode({ mode: process.env.ASHLEY_WILDE_MAPPING_MODE || 'production', production: true });
if (mode !== 'production') throw new Error('Production/admin builds cannot use the local Ashley Wilde pilot mapping.');
console.log('Ashley Wilde mapping build guard: production mapping selected.');
