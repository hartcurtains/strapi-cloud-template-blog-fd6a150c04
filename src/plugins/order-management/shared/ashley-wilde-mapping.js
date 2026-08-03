'use strict';

const path = require('node:path');

const SUPPLIER = 'Ashley Wilde';
const KIELDER_SUPPLIER_PRODUCT_CODE = 'KIELDER';
const KIELDER_NATURAL_FABRIC_NAME = 'Kielder Natural';
const KIELDER_OTHER_COLOURS_FABRIC_NAME = 'Kielder Other cols';
const MAPPING_MODES = Object.freeze(['production', 'pilot']);
const SUPPORTED_EXTENSIONS = Object.freeze(['.jpg', '.jpeg', '.png', '.webp']);
const ASSET_TYPES = Object.freeze(['ordinary_colour', 'full_colour_name', 'numbered_alternate', 'lifestyle', 'cameo', 'roomset', 'moodboard', 'main_image', 'non_colour', 'unknown']);
const STATUSES = Object.freeze([
  'matched', 'already_complete', 'would_create_colour',
  'would_create_internal_code', 'would_create_relation',
  'would_upload_and_link', 'duplicate_in_folder', 'previously_uploaded',
  'would_stage_identity', 'would_stage_asset', 'already_staged', 'staged',
  'unknown_mapping_product', 'pending_manual_mapping', 'unknown_colour_code', 'ambiguous_filename',
  'fabric_not_found_in_current_catalog', 'ambiguous_catalog_fabric', 'mapped',
  'identity_conflict', 'colour_conflict', 'thumbnail_conflict', 'unsupported_file',
]);

class AshleyWildeMappingError extends Error {
  constructor(message, file = 'Ashley Wilde mapping') {
    super(`${file}: ${message}`);
    this.name = 'AshleyWildeMappingError';
    this.code = 'ASHLEY_WILDE_MAPPING_INVALID';
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value, label, file) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AshleyWildeMappingError(`${label} must be a non-empty string`, file);
  }
}

function validateHeader(value, file, expectedSupplier = SUPPLIER) {
  if (!isObject(value)) throw new AshleyWildeMappingError('root must be an object', file);
  if (value.schemaVersion !== 1) throw new AshleyWildeMappingError('schemaVersion must be 1', file);
  requireString(expectedSupplier, 'expected supplier', file);
  requireString(value.supplier, 'supplier', file);
  if (normalizeSupplierName(value.supplier) !== normalizeSupplierName(expectedSupplier)) {
    throw new AshleyWildeMappingError(`supplier must be "${String(expectedSupplier).trim()}"`, file);
  }
  if (value.generatedAt !== null && (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt)))) {
    throw new AshleyWildeMappingError('generatedAt must be null or an ISO date string', file);
  }
}

function validateColourMap(value, file = 'ashley-wilde-colour-map.json', expectedSupplier = SUPPLIER) {
  validateHeader(value, file, expectedSupplier);
  if (!isObject(value.products)) throw new AshleyWildeMappingError('products must be an object', file);
  const prefixes = new Map();
  for (const [key, product] of Object.entries(value.products)) {
    if (!isObject(product)) throw new AshleyWildeMappingError(`products.${key} must be an object`, file);
    requireString(product.supplierProductCode, `products.${key}.supplierProductCode`, file);
    requireString(product.fabricName, `products.${key}.fabricName`, file);
    if (product.fabricDocumentId !== undefined) requireString(product.fabricDocumentId, `products.${key}.fabricDocumentId`, file);
    if (product.approvedAliases !== undefined && (!Array.isArray(product.approvedAliases) || product.approvedAliases.some((alias) => typeof alias !== 'string' || !alias.trim()))) {
      throw new AshleyWildeMappingError(`products.${key}.approvedAliases must be an array of non-empty strings`, file);
    }
    requireString(product.productName, `products.${key}.productName`, file);
    if (!Array.isArray(product.filenamePrefixes) || product.filenamePrefixes.length === 0) {
      throw new AshleyWildeMappingError(`products.${key}.filenamePrefixes must be a non-empty array`, file);
    }
    if (!isObject(product.colours)) throw new AshleyWildeMappingError(`products.${key}.colours must be an object`, file);
    for (const rawPrefix of product.filenamePrefixes) {
      requireString(rawPrefix, `products.${key}.filenamePrefixes[]`, file);
      const prefix = normalizeStem(rawPrefix);
      const owners = prefixes.get(prefix) || [];
      owners.push(key);
      prefixes.set(prefix, owners);
    }
    for (const [colourKey, colour] of Object.entries(product.colours)) {
      if (!isObject(colour)) throw new AshleyWildeMappingError(`products.${key}.colours.${colourKey} must be an object`, file);
      if (colour.resolved === false) {
        requireString(colour.reason, `products.${key}.colours.${colourKey}.reason`, file);
        continue;
      }
      if (colour.resolved !== true) throw new AshleyWildeMappingError(`products.${key}.colours.${colourKey}.resolved must be boolean`, file);
      requireString(colour.supplierColourCode, `products.${key}.colours.${colourKey}.supplierColourCode`, file);
      requireString(colour.supplierColourName, `products.${key}.colours.${colourKey}.supplierColourName`, file);
      requireString(colour.internalColourCode, `products.${key}.colours.${colourKey}.internalColourCode`, file);
      if (normalizeToken(colour.supplierColourCode) !== normalizeToken(colourKey)) {
        throw new AshleyWildeMappingError(`products.${key}.colours.${colourKey} key/code mismatch`, file);
      }
    }
  }
  return value;
}

function validateCodeRegistry(value, file = 'ashley-wilde-code-registry.json') {
  validateHeader(value, file);
  if (!isObject(value.codes)) throw new AshleyWildeMappingError('codes must be an object', file);
  if (!Array.isArray(value.unresolved)) throw new AshleyWildeMappingError('unresolved must be an array', file);
  for (const [codeKey, entry] of Object.entries(value.codes)) {
    if (!isObject(entry)) throw new AshleyWildeMappingError(`codes.${codeKey} must be an object`, file);
    requireString(entry.colourName, `codes.${codeKey}.colourName`, file);
    if (!Array.isArray(entry.sources)) throw new AshleyWildeMappingError(`codes.${codeKey}.sources must be an array`, file);
    if (normalizeToken(codeKey) !== codeKey) throw new AshleyWildeMappingError(`code key ${codeKey} must be normalized`, file);
    for (const source of entry.sources) {
      if (!isObject(source)) throw new AshleyWildeMappingError(`codes.${codeKey}.sources[] must be an object`, file);
      requireString(source.supplierProductCode, `codes.${codeKey}.sources[].supplierProductCode`, file);
      requireString(source.supplierColourCode, `codes.${codeKey}.sources[].supplierColourCode`, file);
    }
  }
  return value;
}

function validateImageIndex(value, file = 'ashley-wilde-image-index.json') {
  validateHeader(value, file);
  if (!isObject(value.images)) throw new AshleyWildeMappingError('images must be an object', file);
  if (!Array.isArray(value.unresolved)) throw new AshleyWildeMappingError('unresolved must be an array', file);
  for (const [relativePath, entry] of Object.entries(value.images)) {
    if (!relativePath || path.isAbsolute(relativePath) || /^[a-z]:/i.test(relativePath)) {
      throw new AshleyWildeMappingError('image keys must be non-absolute relative paths', file);
    }
    if (!isObject(entry)) throw new AshleyWildeMappingError(`images.${relativePath} must be an object`, file);
    if (!/^[a-f0-9]{64}$/.test(entry.sha256 || '')) throw new AshleyWildeMappingError(`images.${relativePath}.sha256 is invalid`, file);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw new AshleyWildeMappingError(`images.${relativePath}.size is invalid`, file);
  }
  return value;
}

function resolveMappingMode(options = {}) {
  const requested = String(options.mode || options.mappingMode || process.env.ASHLEY_WILDE_MAPPING_MODE || 'production').trim().toLowerCase();
  if (!MAPPING_MODES.includes(requested)) throw new AshleyWildeMappingError(`mapping mode must be one of: ${MAPPING_MODES.join(', ')}`);
  const production = options.production === true
    || String(options.nodeEnv || process.env.NODE_ENV || '').toLowerCase() === 'production'
    || String(options.strapiCloud || process.env.STRAPI_CLOUD || '').toLowerCase() === 'true';
  if (requested === 'pilot' && production) throw new AshleyWildeMappingError('pilot mapping mode is local-only and is refused in production/Strapi Cloud');
  return requested;
}

function loadProductionMappings(options = {}) {
  const mode = resolveMappingMode(options);
  const prefix = mode === 'pilot' ? './ashley-wilde' : './ashley-wilde';
  const colourMap = options.colourMap || require(`${prefix}-colour-map${mode === 'pilot' ? '.pilot' : ''}.json`);
  const codeRegistry = options.codeRegistry || require(`${prefix}-code-registry${mode === 'pilot' ? '.pilot' : ''}.json`);
  const imageIndex = options.imageIndex || require('./ashley-wilde-image-index.json');
  validateColourMap(colourMap);
  validateCodeRegistry(codeRegistry);
  for (const [productKey, product] of Object.entries(colourMap.products)) {
    for (const colour of Object.values(product.colours)) {
      if (colour.resolved === false) continue;
      const registryEntry = codeRegistry.codes[normalizeToken(colour.internalColourCode)];
      if (!registryEntry) throw new AshleyWildeMappingError(`products.${productKey} references missing internal code ${colour.internalColourCode}`);
      if (normalizeCanonicalColourName(registryEntry.colourName) !== normalizeCanonicalColourName(colour.supplierColourName)) {
        throw new AshleyWildeMappingError(`internal code ${colour.internalColourCode} has a conflicting colour name`);
      }
    }
  }
  return {
    mode,
    colourMap,
    codeRegistry,
    imageIndex: validateImageIndex(imageIndex),
  };
}

function normalizeToken(value) {
  return String(value || '').normalize('NFKC').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeSupplierName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function normalizeCanonicalColourName(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase().replace(/[\s_-]+/g, '');
}

function normalizeStem(value) {
  let stem = String(value || '').replace(/\.[^.]+$/, '').normalize('NFKC').trim();
  let previous;
  do {
    previous = stem;
    stem = stem
      .replace(/\s*-?\s*copy(?:\s+\d+|\s*\(\d+\))?\s*$/i, '')
      .replace(/\s*\(\d+\)\s*$/i, '')
      .trim();
  } while (stem !== previous);
  return normalizeToken(stem);
}

function isKielderProduct(productOrCode) {
  return normalizeToken(typeof productOrCode === 'object' ? productOrCode?.supplierProductCode : productOrCode) === KIELDER_SUPPLIER_PRODUCT_CODE;
}

function kielderFabricNameForSuffix(supplierColourCode) {
  return normalizeToken(supplierColourCode) === 'NA'
    ? KIELDER_NATURAL_FABRIC_NAME
    : KIELDER_OTHER_COLOURS_FABRIC_NAME;
}

function kielderFilenameMatch(stem) {
  const normalizedStem = normalizeStem(stem);
  if (normalizedStem === `${KIELDER_SUPPLIER_PRODUCT_CODE}NA`) {
    return {
      supplierProductCode: KIELDER_SUPPLIER_PRODUCT_CODE,
      supplierColourCode: 'NA',
      fabricName: KIELDER_NATURAL_FABRIC_NAME,
    };
  }
  if (!normalizedStem.startsWith(KIELDER_SUPPLIER_PRODUCT_CODE)) return null;
  const supplierColourCode = normalizedStem.slice(KIELDER_SUPPLIER_PRODUCT_CODE.length);
  if (!supplierColourCode || !/^[A-Z0-9]+$/.test(supplierColourCode)) return null;
  return {
    supplierProductCode: KIELDER_SUPPLIER_PRODUCT_CODE,
    supplierColourCode,
    fabricName: KIELDER_OTHER_COLOURS_FABRIC_NAME,
  };
}

function exactKielderProduct(products, supplierColourCode) {
  const targetName = normalizeToken(kielderFabricNameForSuffix(supplierColourCode));
  const matches = (products || []).filter((product) => normalizeToken(product.fabricName) === targetName
    && (!product.supplierProductCode || isKielderProduct(product)));
  return matches.length === 1 ? matches[0] : null;
}

function classifyFilename(filename) {
  const value = String(filename || '').normalize('NFKC').trim().toLowerCase();
  const stem = value.replace(/\.[^.]+$/, '');
  if (/(^|[\s._-])(?:non[-_ ]?colou?r|not[-_ ]?a[-_ ]?colou?r)(?:$|[\s._-])/.test(stem)) return 'non_colour';
  if (/(^|[\s._-])lifestyle(?:$|[\s._-])/.test(stem)) return 'lifestyle';
  if (/(^|[\s._-])cameo(?:$|[\s._-])/.test(stem)) return 'cameo';
  if (/(^|[\s._-])room[-_ ]?set(?:$|[\s._-])/.test(stem)) return 'roomset';
  if (/(^|[\s._-])mood[-_ ]?board(?:$|[\s._-])/.test(stem)) return 'moodboard';
  if (/(^|[\s._-])(?:main[-_ ]?image|hero[-_ ]?image|main)(?:$|[\s._-])/.test(stem)) return 'main_image';
  return 'ordinary_colour';
}

function safeFilename(filename) {
  const value = String(filename || '');
  return Boolean(value) && value === path.basename(value) && !/[\\/\0]/.test(value) && !value.startsWith('.') && !value.includes('..');
}

function normalizeRelativePath(value) {
  const normalized = String(value || '').normalize('NFKC').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error('Relative file path is invalid');
  }
  return normalized.split('/').filter(Boolean).join('/');
}

function parseFilename(filename, colourMap) {
  validateColourMap(colourMap, 'active supplier colour map', colourMap?.supplier || SUPPLIER);
  const extension = path.extname(String(filename || '')).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(extension)) return { status: 'unsupported_file', filename };
  if (!safeFilename(filename)) return { status: 'ambiguous_filename', filename, warning: 'Filename is unsafe.' };
  const assetType = classifyFilename(filename);
  if (assetType !== 'ordinary_colour') return { status: 'classified_asset', filename, assetType, warning: 'This asset is not an ordinary colour image and cannot create a colour identity.' };
  const stem = normalizeStem(path.basename(filename, extension));
  if (!stem) return { status: 'ambiguous_filename', filename, warning: 'Filename has no usable product and colour code.' };

  const kielder = kielderFilenameMatch(stem);
  let winner;
  let isKielderResolution = false;
  if (kielder) {
    const productEntries = Object.entries(colourMap.products)
      .filter(([, product]) => exactKielderProduct([product], kielder.supplierColourCode));
    if (productEntries.length !== 1) {
      return {
        status: productEntries.length ? 'ambiguous_filename' : 'unknown_mapping_product',
        filename,
        warning: productEntries.length
          ? 'The exact Kielder Fabric name belongs to multiple catalogue mappings.'
          : `The exact Kielder Fabric ${kielder.fabricName} is absent from the active mapping.`,
      };
    }
    const [productKey, product] = productEntries[0];
    winner = { productKey, product, prefix: KIELDER_SUPPLIER_PRODUCT_CODE };
    isKielderResolution = true;
  }

  if (!winner) {
    const candidates = [];
    for (const [productKey, product] of Object.entries(colourMap.products)) {
      for (const rawPrefix of product.filenamePrefixes) {
        const prefix = normalizeStem(rawPrefix);
        if (stem.startsWith(prefix) && stem.length > prefix.length) candidates.push({ productKey, product, prefix });
      }
    }
    if (!candidates.length) return { status: 'unknown_mapping_product', filename };
    const longest = Math.max(...candidates.map((candidate) => candidate.prefix.length));
    const winners = candidates.filter((candidate) => candidate.prefix.length === longest);
    const productKeys = [...new Set(winners.map((candidate) => candidate.productKey))];
    if (productKeys.length !== 1) return { status: 'ambiguous_filename', filename, warning: 'The longest approved prefix belongs to multiple products.' };
    winner = winners[0];
  }

  let supplierColourCode = isKielderResolution ? kielder.supplierColourCode : stem.slice(winner.prefix.length);
  const supplierProductCode = isKielderResolution ? KIELDER_SUPPLIER_PRODUCT_CODE : winner.product.supplierProductCode;
  let numberedAlternate = false;
  const numbered = supplierColourCode.match(/^(.+?)[_-](\d+)$/);
  if (numbered) {
    supplierColourCode = numbered[1];
    numberedAlternate = true;
  }
  if (!supplierColourCode) return { status: 'ambiguous_filename', filename, warning: 'No supplier colour suffix remains after the product prefix.' };
  const colourKey = Object.keys(winner.product.colours).find((key) => normalizeToken(key) === normalizeToken(supplierColourCode));
  const colour = colourKey ? winner.product.colours[colourKey] : null;
  const namedColourKey = Object.keys(winner.product.colours).find((key) => {
    const candidate = winner.product.colours[key];
    return candidate?.resolved === true && normalizeCanonicalColourName(candidate.supplierColourName) === normalizeCanonicalColourName(supplierColourCode);
  });
  const fullNameColour = !colour && namedColourKey ? winner.product.colours[namedColourKey] : null;
  if (fullNameColour) {
    if (!isKielderResolution) supplierColourCode = fullNameColour.supplierColourCode;
    return {
      status: 'matched', assetType: 'full_colour_name', filename, productKey: winner.productKey,
      productName: winner.product.productName, fabricName: winner.product.fabricName,
      approvedAliases: winner.product.approvedAliases || [], supplierProductCode,
      fabricDocumentId: winner.product.fabricDocumentId, mappingVersion: winner.product.mappingVersion, supplierColourCode,
      supplierColourName: fullNameColour.supplierColourName, internalColourCode: fullNameColour.internalColourCode,
      ...(isKielderResolution ? { fabricColourCode: `${KIELDER_SUPPLIER_PRODUCT_CODE}${supplierColourCode}` } : {}),
      mappingSource: fullNameColour.evidence?.source || 'approved Ashley Wilde mapping', evidence: fullNameColour.evidence || null,
    };
  }
  if (!colour || colour.resolved === false) {
    return {
      status: 'pending_manual_mapping', assetType: numberedAlternate ? 'numbered_alternate' : 'ordinary_colour', filename, productKey: winner.productKey,
      productName: winner.product.productName, fabricName: winner.product.fabricName,
      approvedAliases: winner.product.approvedAliases || [], supplierProductCode,
      fabricDocumentId: winner.product.fabricDocumentId, mappingVersion: winner.product.mappingVersion, supplierColourCode,
      ...(isKielderResolution ? { fabricColourCode: `${KIELDER_SUPPLIER_PRODUCT_CODE}${supplierColourCode}` } : {}),
      warning: colour?.reason || 'This product-scoped supplier colour code is not mapped.',
    };
  }
  return {
    status: 'matched', assetType: numberedAlternate ? 'numbered_alternate' : 'ordinary_colour', filename, productKey: winner.productKey,
    productName: winner.product.productName, fabricName: winner.product.fabricName,
    approvedAliases: winner.product.approvedAliases || [], supplierProductCode,
    fabricDocumentId: winner.product.fabricDocumentId, mappingVersion: winner.product.mappingVersion, supplierColourCode,
    supplierColourName: colour.supplierColourName, internalColourCode: colour.internalColourCode,
    ...(isKielderResolution ? { fabricColourCode: `${KIELDER_SUPPLIER_PRODUCT_CODE}${supplierColourCode}` } : {}),
    mappingSource: colour.evidence?.source || 'approved Ashley Wilde mapping', evidence: colour.evidence || null,
  };
}

function canonicalManifestLines(entries) {
  return entries.map((entry) => `${normalizeRelativePath(entry.relativePath)}\0${String(entry.sha256 || '').toLowerCase()}`)
    .sort((a, b) => a.localeCompare(b));
}

module.exports = {
  AshleyWildeMappingError, STATUSES, SUPPLIER, SUPPORTED_EXTENSIONS,
  KIELDER_SUPPLIER_PRODUCT_CODE, KIELDER_NATURAL_FABRIC_NAME, KIELDER_OTHER_COLOURS_FABRIC_NAME,
  ASSET_TYPES, classifyFilename, safeFilename,
  MAPPING_MODES, resolveMappingMode,
  canonicalManifestLines, loadProductionMappings, normalizeRelativePath,
  normalizeCanonicalColourName, normalizeStem, normalizeToken, isKielderProduct, kielderFabricNameForSuffix,
  kielderFilenameMatch, exactKielderProduct, parseFilename, validateCodeRegistry,
  validateColourMap, validateImageIndex,
};
