'use strict';

function fabricKey(fabric) {
  return fabric?.documentId || fabric?.id || null;
}

async function fetchAllFabrics(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const pageSize = options.pageSize || 100;
  const baseParams = new URLSearchParams();
  const populate = options.populate || '*';
  if (Array.isArray(populate)) populate.forEach((value, index) => baseParams.append(`populate[${index}]`, value));
  else baseParams.set('populate', populate);
  if (options.publicationState) baseParams.set('publicationState', options.publicationState);
  baseParams.set('sort', 'id:asc');

  const rows = [];
  let pagination;
  for (let page = 1; page === 1 || page <= pagination.pageCount; page += 1) {
    const params = new URLSearchParams(baseParams);
    params.set('pagination[page]', String(page));
    params.set('pagination[pageSize]', String(pageSize));
    const response = await fetchImpl(`/api/fabrics?${params}`, { headers: options.headers, signal: options.signal });
    if (!response.ok) throw new Error(`Complete fabric catalogue request failed on page ${page} (${response.status}).`);
    const payload = await response.json();
    const current = payload?.meta?.pagination;
    if (!current || !Number.isSafeInteger(current.pageCount) || !Number.isSafeInteger(current.total)) {
      throw new Error(`Complete fabric catalogue response is missing pagination metadata on page ${page}.`);
    }
    if (!Array.isArray(payload.data)) throw new Error(`Complete fabric catalogue response has invalid data on page ${page}.`);
    if (!pagination) pagination = current;
    else if (current.pageCount !== pagination.pageCount || current.total !== pagination.total) {
      throw new Error(`Complete fabric catalogue pagination changed while fetching page ${page}.`);
    }
    rows.push(...payload.data);
  }

  const physicalById = new Map();
  const duplicatePhysicalIds = new Set();
  for (const fabric of rows) {
    if (fabric?.id == null) throw new Error('Complete fabric catalogue returned a record without a physical id.');
    if (physicalById.has(fabric.id)) duplicatePhysicalIds.add(fabric.id);
    else physicalById.set(fabric.id, fabric);
  }
  const physicalRows = [...physicalById.values()];
  if (physicalRows.length !== pagination.total) {
    const duplicates = [...duplicatePhysicalIds].join(', ') || 'none';
    throw new Error(`Complete fabric catalogue returned ${physicalRows.length} unique physical IDs of ${pagination.total}; duplicated IDs: ${duplicates}; missing count: ${Math.max(0, pagination.total - physicalRows.length)}.`);
  }
  const seen = new Set();
  const data = physicalRows.filter((fabric) => {
    const key = fabricKey(fabric);
    if (key == null) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { data, meta: { pagination }, totalFetched: physicalRows.length };
}

export { fetchAllFabrics };
