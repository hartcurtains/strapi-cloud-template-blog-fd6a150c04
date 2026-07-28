'use strict';

const TRACE_ID_PATTERN = /^aw_[a-z0-9]{1,16}\*[a-z0-9]{1,16}\*[1-9]\d{0,5}$/i;

function normalizeTraceId(value: unknown): string | null {
  const candidate = String(value || '').trim();
  return TRACE_ID_PATTERN.test(candidate) ? candidate : null;
}

function traceIdFromRequest(ctx: any): string | null {
  return normalizeTraceId(ctx?.request?.headers?.['x-ashley-trace-id']);
}

function attemptFromTraceId(traceId: string | null): number | null {
  const match = normalizeTraceId(traceId)?.match(/\*(\d+)$/);
  return match ? Number(match[1]) : null;
}

function safeDiagnosticMessage(value: unknown): string {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 500) || 'Unknown upload error';
}

function logAshleyDiagnostic(strapi: any, stage: string, details: Record<string, unknown> = {}): void {
  const entry = { timestamp: new Date().toISOString(), stage, ...details };
  const logger = strapi?.log?.info ? strapi.log : console;
  logger.info(`[AshleyUpload] ${JSON.stringify(entry)}`);
}

function isAshleyUploadRequest(ctx: any): boolean {
  return String(ctx?.method || '').toUpperCase() === 'POST'
    && String(ctx?.path || '') === '/upload'
    && Boolean(traceIdFromRequest(ctx));
}

function authenticatedAdminPresent(ctx: any): boolean {
  const catalogWriteAuth = ctx?.state?.catalogWriteAuth;
  return Boolean(
    catalogWriteAuth?.kind === 'admin' && catalogWriteAuth.user?.isActive !== false
  ) || Boolean(
    ctx?.state?.auth?.strategy?.name === 'admin' && ctx?.state?.user?.isActive !== false
  );
}

const ashleyUploadDiagnostics = async (ctx: any, next: any) => {
  if (!isAshleyUploadRequest(ctx)) return next();

  const traceId = traceIdFromRequest(ctx);
  const startedAt = Date.now();
  const startTime = new Date().toISOString();
  const requestDetails = {
    traceId,
    attempt: attemptFromTraceId(traceId),
    contentLength: Number(ctx.get('content-length')) || null,
    authenticatedAdminPresent: authenticatedAdminPresent(ctx),
    startTime,
  };

  logAshleyDiagnostic(global.strapi, 'upload_request_received', requestDetails);
  try {
    await next();
    logAshleyDiagnostic(global.strapi, 'upload_request_completed', {
      ...requestDetails,
      responseStatus: ctx.status,
      durationMs: Date.now() - startedAt,
    });
  } catch (error: any) {
    logAshleyDiagnostic(global.strapi, 'upload_request_error', {
      ...requestDetails,
      errorClass: error?.constructor?.name || error?.name || 'Error',
      safeMessage: safeDiagnosticMessage(error?.message || error?.name),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
};

module.exports = () => ashleyUploadDiagnostics;
module.exports.handler = ashleyUploadDiagnostics;

export {};
