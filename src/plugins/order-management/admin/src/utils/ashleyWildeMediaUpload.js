import { normalizeStagingError, parseStagingResponse, sanitizeDiagnosticMessage } from './stagingResponse';

export const ASHLEY_MEDIA_UPLOAD_PATH = '/upload';
export const ASHLEY_PREPARED_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const ACCEPTED_ASHLEY_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const MEDIA_UPLOAD_RETRY_MESSAGE = 'The image service was temporarily unavailable. This image was not uploaded. Please retry it.';
export const MEDIA_UPLOAD_UNAUTHORISED_MESSAGE = 'The image upload was not authorised. Refresh your administrator session and retry.';

export function getSafeBasename(relativePath) {
  return String(relativePath || '').normalize('NFKC').replace(/\\/g, '/').split('/').pop() || '';
}

export function mediaBindingFor({ analysisToken, folderFingerprint, relativePath, fileFingerprint }) {
  const signature = String(analysisToken || '').split('.').pop();
  return `aw-ashley:${signature}:${folderFingerprint}:${relativePath}:${fileFingerprint}`;
}

/**
 * Strapi 5.23.6's Media Library upload hook returns res.data, which is an
 * array for a normal upload. Keep the numeric id and documentId distinct and
 * only copy fields that the installed Media Library actually returned.
 */
export function normalizeMediaRecord(payload) {
  const candidate = Array.isArray(payload)
    ? payload[0]
    : payload?.data && !payload.id && !payload.documentId
      ? (Array.isArray(payload.data) ? payload.data[0] : payload.data)
      : payload;
  if (!candidate || (candidate.id === undefined && !candidate.documentId)) {
    const error = new Error('The Media Library did not return a Media record.');
    error.code = 'ASHLEY_WILDE_MEDIA_RESPONSE_INVALID';
    throw error;
  }

  const normalized = {};
  for (const field of ['id', 'documentId', 'name', 'mime', 'size', 'url', 'hash', 'width', 'height']) {
    if (candidate[field] !== undefined && candidate[field] !== null) normalized[field] = candidate[field];
  }
  return normalized;
}

export function safeMediaUploadErrorMessage(error) {
  const status = error?.status || error?.response?.status;
  if (status === 401 || status === 403) return MEDIA_UPLOAD_UNAUTHORISED_MESSAGE;
  if (status === 413) return 'This prepared image is larger than the server can accept.';
  if (status === 503 || error?.code === 'ASHLEY_WILDE_UPSTREAM_UNAVAILABLE') return MEDIA_UPLOAD_RETRY_MESSAGE;
  if (error?.code === 'ASHLEY_WILDE_MEDIA_TOO_LARGE') return 'This prepared image is larger than the supported 20 MiB limit.';
  if (/unexpected token|json|cloudflare|html/i.test(String(error?.message || ''))) return 'The image upload response was invalid. Please retry this image.';
  return sanitizeDiagnosticMessage(error?.message) || 'The image could not be uploaded. Please retry it.';
}

export async function uploadAshleyWildeMedia(file, { analysisToken, folderFingerprint, relativePath, fileFingerprint, adminPost, signal } = {}) {
  const size = Number(file?.size || 0);
  const mimeType = String(file?.type || '').toLowerCase();
  if (!Number.isSafeInteger(size) || size < 1 || size > ASHLEY_PREPARED_IMAGE_MAX_BYTES) {
    const error = new Error('This prepared image is larger than the supported 20 MiB limit.');
    error.code = 'ASHLEY_WILDE_MEDIA_TOO_LARGE';
    error.status = 413;
    throw error;
  }
  if (!ACCEPTED_ASHLEY_MEDIA_TYPES.has(mimeType)) {
    const error = new Error('The selected file is not a supported image type.');
    error.code = 'ASHLEY_WILDE_MEDIA_TYPE_INVALID';
    error.status = 400;
    throw error;
  }

  const form = new FormData();
  // This mirrors @strapi/upload 5.23.6's useUpload hook exactly:
  // formData.append('files', rawFile) and formData.append('fileInfo', JSON.stringify(...)).
  // The injected admin client supplies the current authenticated session and
  // deliberately owns the request headers/boundary.
  const canonicalFilename = getSafeBasename(relativePath || file.name);
  form.append('files', file, canonicalFilename);
  form.append('fileInfo', JSON.stringify({
    name: canonicalFilename,
    alternativeText: null,
    caption: null,
    folder: undefined,
  }));

  try {
    if (typeof adminPost !== 'function') throw new Error('The authenticated Strapi admin upload client is unavailable.');
    const response = await adminPost(ASHLEY_MEDIA_UPLOAD_PATH, form, { signal });
    const payload = await parseStagingResponse(response);
    return normalizeMediaRecord(payload);
  } catch (error) {
    const normalized = await normalizeStagingError(error);
    normalized.safeMessage = safeMediaUploadErrorMessage(normalized);
    throw normalized;
  }
}
