'use strict';

const TRACE_ID_PATTERN = /^aw_[a-z0-9]{1,16}\*[a-z0-9]{1,16}\*[1-9]\d{0,5}$/i;

function normalizeTraceId(value) {
  const candidate = String(value || '').trim();
  return TRACE_ID_PATTERN.test(candidate) ? candidate : null;
}

function traceIdFromRequest(ctx) {
  return normalizeTraceId(ctx?.request?.headers?.['x-ashley-trace-id']);
}

function attemptFromTraceId(traceId) {
  const match = normalizeTraceId(traceId)?.match(/\*(\d+)$/);
  return match ? Number(match[1]) : null;
}

function safeDiagnosticText(value, maxLength = 512) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength) || null;
}

function safeDiagnosticPath(value) {
  return safeDiagnosticText(value);
}

function safeDiagnosticMessage(value) {
  return safeDiagnosticText(value, 500) || 'Unknown upload error';
}

function diagnosticContext({ traceId, relativePath, filename, sizeBytes, mimeType, attempt } = {}) {
  const normalizedTraceId = normalizeTraceId(traceId);
  const safeAttempt = Number.isSafeInteger(Number(attempt)) && Number(attempt) > 0
    ? Number(attempt)
    : attemptFromTraceId(normalizedTraceId);
  return {
    traceId: normalizedTraceId,
    filename: safeDiagnosticText(filename),
    relativePath: safeDiagnosticPath(relativePath),
    sizeBytes: Number.isFinite(Number(sizeBytes)) ? Number(sizeBytes) : null,
    mimeType: safeDiagnosticText(mimeType, 128),
    attempt: safeAttempt || null,
  };
}

function logAshleyDiagnostic(strapi, stage, details = {}) {
  const entry = { timestamp: new Date().toISOString(), stage, ...details };
  const logger = strapi?.log?.info ? strapi.log : console;
  logger.info(`[AshleyUpload] ${JSON.stringify(entry)}`);
}

module.exports = {
  attemptFromTraceId,
  diagnosticContext,
  logAshleyDiagnostic,
  normalizeTraceId,
  safeDiagnosticMessage,
  traceIdFromRequest,
};
