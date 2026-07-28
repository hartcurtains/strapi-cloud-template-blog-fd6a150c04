function contentTypeOf(response) {
  if (!response) return '';
  if (typeof response.headers?.get === 'function') return response.headers.get('content-type') || '';
  const headers = response.headers || response.response?.headers || {};
  return headers['content-type'] || headers['Content-Type'] || '';
}

function isJsonContentType(contentType) {
  return /(?:^|\/)(?:json|problem\+json)(?:;|$)/i.test(String(contentType || '').trim())
    || /\+json(?:;|$)/i.test(String(contentType || '').trim());
}

export function sanitizeDiagnosticMessage(value, limit = 500) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function errorFromResponse(status, payload, contentType) {
  const message = typeof payload === 'string'
    ? sanitizeDiagnosticMessage(payload)
    : payload?.error?.message || payload?.error || payload?.message || '';
  const error = new Error(message || `Ashley Wilde staging request failed (${status || 'unknown'}).`);
  error.status = status;
  error.upstreamMessage = sanitizeDiagnosticMessage(message);
  error.code = status === 503 ? 'ASHLEY_WILDE_UPSTREAM_UNAVAILABLE' : 'ASHLEY_WILDE_RESPONSE_ERROR';
  error.contentType = contentType || '';
  return error;
}

async function readFetchResponse(response) {
  const contentType = contentTypeOf(response);
  if (isJsonContentType(contentType)) {
    try { return { payload: await response.json(), contentType }; }
    catch { return { payload: await response.text().catch(() => ''), contentType }; }
  }
  return { payload: await response.text().catch(() => ''), contentType };
}

export async function parseStagingResponse(response) {
  if (response && typeof response.ok === 'boolean') {
    const { payload, contentType } = await readFetchResponse(response);
    if (!response.ok) throw errorFromResponse(response.status, payload, contentType);
    return payload;
  }

  const status = response?.status || response?.response?.status;
  const contentType = contentTypeOf(response);
  const payload = response && Object.prototype.hasOwnProperty.call(response, 'data') ? response.data : response;
  if (status >= 400) throw errorFromResponse(status, payload, contentType);
  if (typeof payload === 'string') throw errorFromResponse(status, payload, contentType);
  if (payload?.success === false && payload?.data === undefined && payload?.results === undefined) {
    throw errorFromResponse(status, payload, contentType);
  }
  return payload;
}

export async function normalizeStagingError(error) {
  if (error?.upstreamMessage) return error;
  if (error?.response && typeof error.response.ok === 'boolean') {
    try { await parseStagingResponse(error.response); }
    catch (responseError) {
      responseError.cause = error;
      return responseError;
    }
  }
  const status = error?.status || error?.response?.status;
  const payload = error?.response?.data;
  if (status >= 400 || typeof payload === 'string') {
    const normalized = errorFromResponse(status, payload, contentTypeOf(error.response));
    normalized.cause = error;
    return normalized;
  }
  if (/unexpected token|json/i.test(String(error?.message || ''))) {
    const normalized = errorFromResponse(status || 503, '', contentTypeOf(error.response));
    normalized.cause = error;
    return normalized;
  }
  return error;
}
