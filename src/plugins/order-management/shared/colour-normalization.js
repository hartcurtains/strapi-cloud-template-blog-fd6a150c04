'use strict';

// Keep the historical source import working for local tests and scripts. The
// runtime controllers and bootstrap use src/utils/colour-normalization.js,
// which is emitted into dist by the production TypeScript build.
module.exports = require('../../../utils/colour-normalization');
