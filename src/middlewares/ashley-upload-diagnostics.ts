'use strict';

const {
  attemptFromTraceId,
  logAshleyDiagnostic,
  safeDiagnosticMessage,
  traceIdFromRequest,
} = require('../plugins/order-management/server/utils/ashleyWildeDiagnostics');

function isAshleyUploadRequest(ctx: any): boolean {
  return String(ctx?.path || '') === '/upload'
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
