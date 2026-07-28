export const ACTIVE_REFRESH_ERROR = 'The mapping was activated, but the active version could not be refreshed.';

export function isJsonContentType(contentType) {
  return /(?:^|\/)(?:json|[^;]+\+json)(?:\s*;|$)/i.test(String(contentType || '').trim());
}

function responseContentType(response) {
  return response?.headers?.get?.('content-type') || '';
}

function responseErrorMessage(payload, fallback) {
  const value = payload?.error;
  if (typeof value === 'string') return value;
  if (value?.message) return value.message;
  if (payload?.message) return payload.message;
  return fallback;
}

export class SupplierMappingRequestError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SupplierMappingRequestError';
    Object.assign(this, details);
  }
}

function getAdminToken() {
  try {
    const stored = window.localStorage?.getItem('jwtToken');
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function requestUrl(url) {
  if (/^(?:[a-z]+:)?\/\//i.test(url)) return url;
  const backendURL = window.strapi?.backendURL || '';
  return `${backendURL}${url.startsWith('/') ? url : `/${url}`}`;
}

export async function safeAdminJsonRequest(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  const token = getAdminToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(requestUrl(url), {
    ...options,
    method: options.method || 'GET',
    headers,
    credentials: 'same-origin',
    redirect: 'follow',
  });
  const contentType = responseContentType(response);
  const fallback = options.fallbackMessage || 'The supplier mapping request failed.';

  if (!response.ok) {
    if (isJsonContentType(contentType)) {
      let payload;
      try { payload = await response.json(); } catch { payload = null; }
      throw new SupplierMappingRequestError(responseErrorMessage(payload, fallback), { status: response.status, contentType });
    }
    await response.text();
    throw new SupplierMappingRequestError(fallback, { status: response.status, contentType });
  }

  if (!isJsonContentType(contentType)) {
    await response.text();
    throw new SupplierMappingRequestError(fallback, { status: response.status, contentType });
  }

  try {
    return await response.json();
  } catch {
    throw new SupplierMappingRequestError(fallback, { status: response.status, contentType });
  }
}
