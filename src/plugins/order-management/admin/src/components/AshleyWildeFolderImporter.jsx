import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getFetchClient, useFetchClient } from '@strapi/strapi/admin';
import { AlertCircle, CheckCircle, FolderOpen, Loader2, RefreshCw, Upload } from 'lucide-react';
import adminCatalogRoutes from '../../../shared/routes';
import {
  MAX_BATCH_BYTES, MAX_BATCH_FILES, MAX_FILE_BYTES, READY_STATUSES, fingerprintManifest,
  folderNameFromFiles, isSupportedFileName, partitionUploadRows, relativePathOf, sha256File,
} from '../utils/ashleyWildeFolder';
import { normalizeStagingError, parseStagingResponse, sanitizeDiagnosticMessage, STAGING_PARSER_VERSION, STAGING_RETRY_MESSAGE } from '../utils/stagingResponse';
import {
  ashleyDiagnosticError, ashleyTraceRequestConfig, ashleyUploadLog, createAshleyTraceId,
  safeMediaUploadErrorMessage, uploadAshleyWildeMedia,
} from '../utils/ashleyWildeMediaUpload';

const colours = {
  text: '#374151', muted: '#6b7280', line: '#e5e7eb', blue: '#3b82f6',
  green: '#059669', amber: '#b45309', red: '#dc2626', surface: '#f9fafb',
};
const PREPARED_WARNING_BYTES = 20 * 1024 * 1024;
const ABSOLUTE_IMPORTER_FILE_BYTES = 50 * 1024 * 1024;

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function preflightStats(rows) {
  const sizes = rows.map((row) => Number(row.file?.size ?? row.size ?? 0));
  const totalBytes = sizes.reduce((total, size) => total + size, 0);
  const largestFileBytes = Math.max(0, ...sizes);
  const projected = partitionUploadRows(rows, MAX_BATCH_FILES, MAX_BATCH_BYTES);
  return {
    totalFiles: rows.length,
    totalBytes,
    largestFileBytes,
    above20MiB: sizes.filter((size) => size > MAX_FILE_BYTES).length,
    above50MiB: sizes.filter((size) => size > ABSOLUTE_IMPORTER_FILE_BYTES).length,
    projectedBatches: projected.batches.length,
  };
}

function stagingLog(step, details = {}) {
  if (typeof console?.debug !== 'function') return;
  console.debug('[Ashley Wilde staging]', { step, parserVersion: STAGING_PARSER_VERSION, ...details });
}

async function adminResponse(request, ...args) {
  try {
    return await parseStagingResponse(await request(...args));
  } catch (error) {
    const normalized = await normalizeStagingError(error);
    if (normalized?.upstreamMessage) stagingLog('safe-upstream-response', {
      status: normalized.status || null,
      contentType: normalized.contentType || null,
      upstreamMessage: sanitizeDiagnosticMessage(normalized.upstreamMessage),
    });
    throw normalized;
  }
}

function responseStatus(error) {
  return error?.status || error?.response?.status || error?.response?.data?.error?.status;
}

function responseMessage(error) {
  const payload = error?.response?.data || error?.data;
  const responseError = payload?.error;
  if (typeof responseError === 'string') return responseError;
  if (responseError?.message) return responseError.message;
  if (typeof payload?.message === 'string') return payload.message;
  return null;
}

function safeErrorMessage(error) {
  if (error?.ashleyPhase === 'upload') return safeMediaUploadErrorMessage(error);
  if (error?.code === 'ASHLEY_WILDE_ANALYSIS_INVALID') return 'The active supplier mapping changed after this folder was analysed. Analyse the folder again before continuing.';
  if (error?.ashleyPhase === 'finalisation') {
    const status = responseStatus(error);
    if (status === 401 || status === 403) return 'The image was uploaded, but its staging link could not be authorised. Refresh your admin session and retry finalisation.';
    if (status === 503 || error?.code === 'ASHLEY_WILDE_UPSTREAM_UNAVAILABLE') return STAGING_RETRY_MESSAGE;
    if (status === 413) return 'The staging request was too large. Retry this image.';
    const serverMessage = responseMessage(error);
    if (serverMessage && !/unexpected token|json/i.test(serverMessage)) return serverMessage;
    return 'The image was uploaded, but its staged fabric-colour link still needs to be completed.';
  }
  if (error?.code === 'ASHLEY_WILDE_UPLOAD_TIMEOUT') return 'The upload did not start. Please retry this batch.';
  const status = responseStatus(error);
  if (status === 401) return 'The request could not authenticate. Your administrator credentials were not accepted.';
  if (status === 403) return 'You are signed in, but your administrator account does not have permission to use the Ashley Wilde importer.';
  if (status === 413) return 'The server rejected this upload because the request was too large. Retry; batches are automatically kept below the upload limit.';
  if (status === 503 || error?.code === 'ASHLEY_WILDE_UPSTREAM_UNAVAILABLE') return STAGING_RETRY_MESSAGE;
  const serverMessage = responseMessage(error);
  if (serverMessage && !/unexpected token|json/i.test(serverMessage)) return serverMessage;
  if (status >= 500) return 'The Ashley Wilde service failed. Try again.';
  if (error?.code === 'ERR_NETWORK' || error?.request && !error?.response) {
    return 'The Ashley Wilde service could not be reached. Check that Strapi is running and try again.';
  }
  if (status === 400) return error?.message || 'The selected folder is malformed or could not be analysed.';
  return error?.message || 'The Ashley Wilde request failed. Try again.';
}

function abortRemainingFiles(error) {
  const status = responseStatus(error);
  return status === 401 || status === 403 || error?.code === 'ASHLEY_WILDE_ANALYSIS_INVALID';
}

function partialStageMessage(total, failures) {
  const names = failures.slice(0, 5).map((item) => item.filename).join(', ');
  const remainder = failures.length > 5 ? ` and ${failures.length - 5} more` : '';
  return `Staged ${total - failures.length} of ${total} files. ${failures.length} file(s) need retrying: ${names}${remainder}.`;
}

const dateLabel = (value) => value ? new Date(value).toLocaleString() : 'Not uploaded';
const statusTone = (status) => status === 'completed' || status === 'staged' ? colours.green
  : ['failed', 'unsupported_file', 'identity_conflict', 'conflicting_image', 'colour_conflict', 'thumbnail_conflict'].includes(status) ? colours.red
    : ['partial', 'completed_with_skips', 'pending_manual_mapping', 'blocked', 'exact_duplicate', 'logical_duplicate'].includes(status) ? colours.amber : colours.muted;
const statusLabel = (status) => ({
  matched: 'safely mapped', mapped: 'Fabric resolved', pending_manual_mapping: 'pending manual mapping',
  classified_asset: 'blocked filename / non-colour', blocked: 'blocked', exact_duplicate: 'exact duplicate',
  logical_duplicate: 'logical duplicate', conflicting_image: 'conflicting image', identity_conflict: 'mapping conflict',
  staged: 'staged', failed: 'failed', already_staged: 'already staged',
}[status] || String(status || 'unknown').replaceAll('_', ' '));

export default function AshleyWildeFolderImporter({ onStagingStart } = {}) {
  const { get, put, del } = useFetchClient();
  const post = useCallback((...args) => getFetchClient().post(...args), []);
  const [analysis, setAnalysis] = useState(null);
  const [folderFiles, setFolderFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [acknowledgeSkips, setAcknowledgeSkips] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [selectedHistory, setSelectedHistory] = useState(null);
  const [mappingMode, setMappingMode] = useState('production');
  const [queuedFolder, setQueuedFolder] = useState(null);
  const [analysisState, setAnalysisState] = useState('idle');
  const [analysisBatches, setAnalysisBatches] = useState([]);
  const fileQueueRef = useRef([]);
  const stagingRunRef = useRef(false);
  const traceAttemptsRef = useRef(new Map());

  const refreshMappingMode = useCallback(async () => {
    const response = await adminResponse(get, adminCatalogRoutes.ashleyWildeMode);
    const mode = response.data || {};
    setMappingMode(mode.mode || 'production');
    return mode;
  }, [get]);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await adminResponse(get, adminCatalogRoutes.ashleyWildeHistory);
      setHistory(response.data || []);
    } catch (historyError) { setError(safeErrorMessage(historyError)); }
    finally { setHistoryLoading(false); }
  }, [get]);

  useEffect(() => { refreshHistory(); refreshMappingMode().catch((modeError) => setError(safeErrorMessage(modeError))); }, [refreshHistory, refreshMappingMode]);
  useEffect(() => () => folderFiles.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl)), [folderFiles]);

  const handleFolder = async (event) => {
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    const selectedFolderName = folderNameFromFiles(files);
    const selectedRows = files.map((file) => ({
      file, filename: file.name, relativePath: relativePathOf(file), size: file.size,
      mimeType: file.type || 'application/octet-stream',
    })).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    fileQueueRef.current = selectedRows;
    folderFiles.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
    setFolderFiles([]);
    setError('');
    setAcknowledgeSkips(false);
    setQueuedFolder({ folderName: selectedFolderName, totalFiles: files.length, preflight: preflightStats(selectedRows) });
    setAnalysis(null);
    setAnalysisBatches([]);
    setAnalysisState('pending');
    event.target.value = '';
  };

  const unresolvedCount = useMemo(() => analysis?.rows.filter((row) => !READY_STATUSES.has(row.status) && row.status !== 'already_complete').length || 0, [analysis]);
  const selectedRows = useMemo(() => analysis?.rows.filter((row) => selected.has(row.relativePath)) || [], [analysis, selected]);
  const priorSameName = history.filter((item) => item.folderName === analysis?.folderName && item.folderFingerprint !== analysis?.folderFingerprint);
  const identicalHistory = history.find((item) => item.folderFingerprint === analysis?.folderFingerprint);

  const toggleRow = (row) => {
    if (!READY_STATUSES.has(row.status)) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(row.relativePath)) next.delete(row.relativePath); else next.add(row.relativePath);
      return next;
    });
  };

  const updateFolderRow = (relativePath, details) => {
    setFolderFiles((current) => current.map((row) => row.relativePath === relativePath ? { ...row, ...details } : row));
  };

  const stageAshleyRow = async ({ row, analysisToken, folderName, folderFingerprint, manifestFileCount, index, total }) => {
    const persisted = history.find((item) => item.folderFingerprint === folderFingerprint)?.manifestSummary?.resultsByPath?.[row.relativePath];
    const previousAttempt = Number(persisted?.attempt || 0);
    const attempt = Math.max(traceAttemptsRef.current.get(row.relativePath) || 0, previousAttempt) + 1;
    traceAttemptsRef.current.set(row.relativePath, attempt);
    const traceId = createAshleyTraceId({ folderFingerprint, fileFingerprint: row.sha256, attempt });
    const diagnostic = {
      traceId, filename: row.filename, relativePath: row.relativePath, sizeBytes: Number(row.size || row.file?.size || 0),
      mimeType: row.mimeType || row.file?.type || null, attempt,
    };
    let media = row.mediaRecord || null;
    ashleyUploadLog({ ...diagnostic, stage: 'attempt_start', mediaAlreadyKnown: Boolean(media) });
    const finaliseBody = {
      analysisToken,
      manifestFileCount,
      mappingVersionDocumentId: analysis?.mappingVersionDocumentId || null,
      folderName,
      folderFingerprint,
      relativePath: row.relativePath,
      originalFilename: row.filename,
      fileFingerprint: row.sha256,
      fileSize: row.size,
      mimeType: row.mimeType,
      supplierProductCode: row.supplierProductCode || null,
      supplierColourCode: row.supplierColourCode || null,
      supplierColourName: row.supplierColourName || null,
      internalColourCode: row.internalColourCode || null,
      fabricDocumentId: row.fabricDocumentId || row.resolvedFabricDocumentId || null,
    };

    if (!media) {
      ashleyUploadLog({ ...diagnostic, stage: 'media_recovery_start' });
      try {
        const lookupPayload = await adminResponse(post, adminCatalogRoutes.ashleyWildeMediaStatus, { ...finaliseBody, phase: 'lookup_media' }, ashleyTraceRequestConfig(traceId));
        const lookupResult = lookupPayload.data?.result || lookupPayload.data;
        ashleyUploadLog({ ...diagnostic, stage: 'media_recovery_result', found: lookupResult?.phase === 'media_uploaded' });
        if (lookupResult?.phase === 'media_uploaded' && lookupResult.mediaId) {
          media = { id: lookupResult.mediaId, documentId: lookupResult.mediaDocumentId || null, name: row.filename };
          fileQueueRef.current = fileQueueRef.current.map((queued) => queued.relativePath === row.relativePath ? { ...queued, mediaRecord: media, mediaId: media.id, mediaDocumentId: media.documentId, phase: 'media_uploaded' } : queued);
          updateFolderRow(row.relativePath, { phase: 'media_uploaded', mediaRecord: media, mediaId: media.id, mediaDocumentId: media.documentId });
        }
      } catch (error) {
        ashleyUploadLog({ ...diagnostic, stage: 'media_recovery_failure', ...ashleyDiagnosticError(error) });
        error.ashleyPhase = 'media_status';
        throw error;
      }
    }

    if (!media) {
      setProgress(`Uploading image ${index + 1} of ${total}: ${row.filename}`);
      updateFolderRow(row.relativePath, { phase: 'uploading_media' });
      try {
        media = await uploadAshleyWildeMedia(row.file, { analysisToken, folderFingerprint, relativePath: row.relativePath, fileFingerprint: row.sha256, mediaBinding: row.mediaBinding, traceId, attempt, adminPost: post });
      } catch (error) {
        error.ashleyPhase = 'upload';
        updateFolderRow(row.relativePath, { phase: 'retryable_upload_failure', status: 'failed', warning: safeMediaUploadErrorMessage(error) });
        ashleyUploadLog({ ...diagnostic, stage: 'attempt_failure', failedStage: 'upload', ...ashleyDiagnosticError(error) });
        try {
          ashleyUploadLog({ ...diagnostic, stage: 'progress_start' });
          await adminResponse(post, adminCatalogRoutes.ashleyWildeProgress, { ...finaliseBody, phase: 'retryable_upload_failure', errorCode: error.code || 'unknown' }, ashleyTraceRequestConfig(traceId));
          ashleyUploadLog({ ...diagnostic, stage: 'progress_success' });
        } catch (progressError) {
          ashleyUploadLog({ ...diagnostic, stage: 'progress_failure', ...ashleyDiagnosticError(progressError) });
        }
        throw error;
      }
      fileQueueRef.current = fileQueueRef.current.map((queued) => queued.relativePath === row.relativePath ? { ...queued, mediaRecord: media, mediaId: media.id, mediaDocumentId: media.documentId || null, phase: 'media_uploaded' } : queued);
      updateFolderRow(row.relativePath, { phase: 'media_uploaded', mediaRecord: media, mediaId: media.id, mediaDocumentId: media.documentId || null });
    }

    setProgress(`Finalising image ${index + 1} of ${total}: ${row.filename}`);
    updateFolderRow(row.relativePath, { phase: 'finalising_staging', mediaRecord: media, mediaId: media.id, mediaDocumentId: media.documentId || null });
    ashleyUploadLog({ ...diagnostic, stage: 'finalise_start', mediaId: media.id || null, mediaDocumentId: media.documentId || null });
    try {
      const payload = await adminResponse(post, adminCatalogRoutes.ashleyWildeFinalise, { ...finaliseBody, mediaId: media.id, mediaDocumentId: media.documentId || null }, ashleyTraceRequestConfig(traceId));
      const result = payload.data?.result || payload.data;
      updateFolderRow(row.relativePath, { ...result, phase: 'complete', mediaRecord: media, mediaId: media.id, mediaDocumentId: media.documentId || null });
      ashleyUploadLog({ ...diagnostic, stage: 'finalise_success', mediaId: media.id || null, mediaDocumentId: media.documentId || null });
      await refreshHistory();
      return result;
    } catch (error) {
      error.ashleyPhase = 'finalisation';
      ashleyUploadLog({ ...diagnostic, stage: 'attempt_failure', failedStage: 'finalise', ...ashleyDiagnosticError(error) });
      updateFolderRow(row.relativePath, { phase: 'retryable_finalisation_failure', mediaRecord: media, mediaId: media.id, mediaDocumentId: media.documentId || null, warning: 'Image uploaded; staging link still needs to be completed.' });
      throw error;
    }
  };

  const uploadFolder = async () => {
    if (!analysis || analysis.analysisComplete !== true || !selectedRows.length || (unresolvedCount > 0 && !acknowledgeSkips)) return;
    setBusy(true);
    setError('');
    try {
      const failures = [];
      for (let index = 0; index < selectedRows.length; index += 1) {
        const row = selectedRows[index];
        try {
          await stageAshleyRow({ row, analysisToken: analysis.analysisToken, folderName: analysis.folderName, folderFingerprint: analysis.folderFingerprint, manifestFileCount: analysis.rows.length, index, total: selectedRows.length });
        } catch (rowError) {
          if (abortRemainingFiles(rowError)) throw rowError;
          failures.push({ filename: row.filename, error: rowError });
        }
      }
      await refreshHistory();
      if (failures.length) {
        setProgress(`Folder import partial: ${selectedRows.length - failures.length} of ${selectedRows.length} staged`);
        setError(partialStageMessage(selectedRows.length, failures));
      } else {
        setProgress('Folder import complete');
        setSelected(new Set());
      }
    } catch (uploadError) {
      await refreshHistory();
      setError(safeErrorMessage(uploadError));
    } finally {
      setBusy(false);
      window.setTimeout(() => setProgress(''), 1500);
    }
  };

  const processQueuedFolder = async () => {
    if (!queuedFolder || !fileQueueRef.current.length || !acknowledgeSkips || analysisState === 'complete') return;
    setBusy(true);
    setError('');
    try {
      await refreshMappingMode();
      const hashed = [];
      for (let index = 0; index < fileQueueRef.current.length; index += 1) {
        const item = fileQueueRef.current[index];
        setProgress(`Hashing ${index + 1} / ${fileQueueRef.current.length}: ${item.filename}`);
        hashed.push({ ...item, sha256: await sha256File(item.file) });
      }
      fileQueueRef.current = hashed;
      const manifest = hashed.map(({ relativePath, sha256, size, mimeType }) => ({ relativePath, sha256, size, mimeType }));
      const folderFingerprint = await fingerprintManifest(manifest);
      const { batches, oversized } = partitionUploadRows(hashed, MAX_BATCH_FILES, MAX_BATCH_BYTES);
      const summary = { totalFiles: hashed.length, matchedFiles: 0, readyFiles: 0, alreadyCompleteFiles: 0, unresolvedFiles: 0, conflictFiles: 0 };
      const analysedRows = oversized.map((row) => ({ ...row, warning: row.warning || `${row.filename} is larger than the supported upload limit.` }));
      summary.skippedFiles = oversized.length;
      const analysedBatches = [];
      let lastServerAnalysis = null;
      for (let index = 0; index < batches.length; index += 1) {
        const batch = batches[index];
        const processedCount = batches.slice(0, index + 1).reduce((total, currentBatch) => total + currentBatch.length, 0);
        setProgress(`Processing ${processedCount} / ${hashed.length} — batch ${index + 1} of ${batches.length}`);
        const batchManifest = batch.map(({ relativePath, sha256, size, mimeType }) => ({ relativePath, sha256, size, mimeType }));
        const response = await adminResponse(post, adminCatalogRoutes.ashleyWildeAnalyse, {
          folderName: queuedFolder.folderName, folderFingerprint, manifest: batchManifest,
          folderManifest: manifest, queueBatch: true,
        });
        const analysisResponse = response;
        const serverAnalysis = analysisResponse.data;
        if (!serverAnalysis?.analysisToken) throw new Error('The server did not return a successful filename analysis. Staging is disabled.');
        Object.keys(summary).forEach((key) => { if (key !== 'totalFiles') summary[key] += Number(serverAnalysis.summary?.[key] || 0); });
        const filesByPath = new Map(batch.map((item) => [item.relativePath, item]));
        const rows = serverAnalysis.rows.map((row) => {
          const local = filesByPath.get(row.relativePath);
          const warning = local?.size > PREPARED_WARNING_BYTES ? 'This image has not been prepared for web upload.' : row.warning;
          if (!local || !isSupportedFileName(row.filename)) return { ...row, file: local?.file, previewUrl: local?.previewUrl, warning };
          return { ...row, file: local?.file, previewUrl: URL.createObjectURL(local.file), warning };
        });
        analysedRows.push(...rows);
        analysedBatches.push({ rows, analysisToken: serverAnalysis.analysisToken });
        lastServerAnalysis = serverAnalysis;
      }
      const order = new Map(hashed.map((row, index) => [row.file, index]));
      analysedRows.sort((left, right) => (order.get(left.file) ?? 0) - (order.get(right.file) ?? 0));
      setFolderFiles((current) => {
        current.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
        return analysedRows;
      });
      setAnalysis({ ...lastServerAnalysis, folderName: queuedFolder.folderName, folderFingerprint, rows: analysedRows, summary: { ...summary }, analysisComplete: true });
      setAnalysisBatches(analysedBatches);
      setAnalysisState('complete');
      setProgress('Folder analysis complete. Review the results, then stage confirmed files.');
    } catch (queueError) {
      setAnalysis(null);
      setAnalysisBatches([]);
      setAnalysisState('failed');
      setFolderFiles([]);
      setError(safeErrorMessage(queueError));
    } finally {
      setBusy(false);
      window.setTimeout(() => setProgress(''), 1500);
    }
  };

  const stageQueuedFolder = async () => {
    if (!queuedFolder || analysisState !== 'complete' || !analysisBatches.length || !fileQueueRef.current.length || stagingRunRef.current) return;
    stagingRunRef.current = true;
    setBusy(true);
    setError('');
    try {
      onStagingStart?.();
      const folderFingerprint = analysis?.folderFingerprint;
      const stagingRows = [];
      analysisBatches.forEach((batch) => {
        batch.rows.filter((row) => READY_STATUSES.has(row.status) && row.size <= MAX_FILE_BYTES).forEach((row) => {
          const queuedState = fileQueueRef.current.find((queued) => queued.relativePath === row.relativePath) || {};
          stagingRows.push({ row: { ...row, ...queuedState }, analysisToken: batch.analysisToken });
        });
      });
      if (!stagingRows.length) throw new Error('There are no confirmed files ready to stage.');
      const failures = [];
      const successfulPaths = new Set();
      for (let index = 0; index < stagingRows.length; index += 1) {
        const { row, analysisToken } = stagingRows[index];
        try {
          await stageAshleyRow({ row, analysisToken, folderName: queuedFolder.folderName, folderFingerprint, manifestFileCount: fileQueueRef.current.length, index, total: stagingRows.length });
          successfulPaths.add(row.relativePath);
        } catch (rowError) {
          if (abortRemainingFiles(rowError)) throw rowError;
          failures.push({ filename: row.filename, relativePath: row.relativePath, error: rowError });
        }
      }
      await refreshHistory();
      if (failures.length) {
        setAnalysisBatches((current) => current.map((batch) => ({
          ...batch,
          rows: batch.rows.map((row) => successfulPaths.has(row.relativePath) ? { ...row, status: 'already_complete' } : row),
        })));
        setProgress(`Folder import partial: ${stagingRows.length - failures.length} of ${stagingRows.length} staged`);
        setError(partialStageMessage(stagingRows.length, failures));
        return;
      }
      fileQueueRef.current = [];
      setQueuedFolder(null);
      setAnalysisBatches([]);
      setProgress('Folder import complete');
    } catch (stageError) {
      await refreshHistory();
      setError(safeErrorMessage(stageError));
    } finally {
      stagingRunRef.current = false;
      setBusy(false);
      window.setTimeout(() => setProgress(''), 1500);
    }
  };

  return (
    <section style={{ borderBottom: `1px solid ${colours.line}`, paddingBottom: '32px', marginBottom: '32px' }}>
      <div className="aw-folder-layout">
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: '18px', fontWeight: 600, color: colours.text, margin: '0 0 6px' }}>Ashley Wilde folder import</h3>
          {mappingMode === 'pilot' && <div role="status" style={{ display: 'inline-block', marginBottom: '8px', padding: '4px 8px', borderRadius: '4px', background: '#fffbeb', color: colours.amber, fontSize: '12px', fontWeight: 600 }}>Pilot mapping — local testing only</div>}
          <p style={{ fontSize: '14px', color: colours.muted, margin: '0 0 16px' }}>Select one complete folder. Files are analysed and shown before staging; the live Colour table is not changed.</p>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '6px', border: `1px solid ${colours.line}`, background: '#fff', color: colours.text, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
            <FolderOpen size={18} /> Select folder
            <input type="file" webkitdirectory="" directory="" multiple onChange={handleFolder} disabled={busy} style={{ display: 'none' }} />
          </label>

          {busy && <p style={{ display: 'flex', alignItems: 'center', gap: '8px', color: colours.muted, fontSize: '13px' }}><Loader2 size={16} className="aw-spin" />{progress}</p>}
          {error && <div role="alert" style={{ display: 'flex', gap: '8px', marginTop: '14px', padding: '12px', background: '#fef2f2', color: '#991b1b', borderRadius: '6px' }}><AlertCircle size={18} />{error}</div>}
          {queuedFolder?.preflight && <div role="status" style={{ marginTop: '14px', padding: '12px', background: colours.surface, border: `1px solid ${colours.line}`, borderRadius: '6px', color: colours.muted, fontSize: '13px' }}>
            <strong style={{ color: colours.text }}>Upload preparation pre-flight</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '7px' }}>
              <span>{queuedFolder.preflight.totalFiles} selected</span>
              <span>{formatBytes(queuedFolder.preflight.totalBytes)} total</span>
              <span>{formatBytes(queuedFolder.preflight.largestFileBytes)} largest</span>
              <span>{queuedFolder.preflight.above20MiB} above 20 MiB</span>
              <span>{queuedFolder.preflight.projectedBatches} projected batch{queuedFolder.preflight.projectedBatches === 1 ? '' : 'es'}</span>
            </div>
            {queuedFolder.preflight.above20MiB > 0 && <div style={{ marginTop: '7px', color: colours.amber }}>This image has not been prepared for web upload. Prepare these files locally before staging.</div>}
            {queuedFolder.preflight.above50MiB > 0 && <div style={{ marginTop: '4px', color: colours.red }}>{queuedFolder.preflight.above50MiB} file(s) exceed the absolute 50 MiB importer limit and will remain unsupported.</div>}
          </div>}

          {analysis?.analysisComplete === true && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', margin: '18px 0 12px', fontSize: '13px', color: colours.muted }}>
                <span><strong style={{ color: colours.text }}>{analysis.summary.totalFiles}</strong> total</span>
                <span><strong style={{ color: colours.green }}>{analysis.summary.matchedFiles}</strong> matched</span>
                <span><strong style={{ color: colours.blue }}>{analysis.summary.readyFiles}</strong> ready</span>
                <span><strong>{analysis.summary.alreadyCompleteFiles}</strong> complete</span>
                <span><strong style={{ color: colours.amber }}>{analysis.summary.unresolvedFiles}</strong> unresolved</span>
                <span><strong style={{ color: colours.red }}>{analysis.summary.conflictFiles}</strong> conflicts</span>
              </div>
              {(identicalHistory || priorSameName.length > 0) && <p style={{ fontSize: '13px', color: identicalHistory ? colours.green : colours.amber, margin: '0 0 12px' }}>{identicalHistory ? 'This exact folder fingerprint has been processed before.' : 'A folder with this name was processed before, but its contents have changed.'}</p>}
              <div style={{ overflowX: 'auto', border: `1px solid ${colours.line}`, borderRadius: '6px' }}>
                <table style={{ width: '100%', minWidth: '880px', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead><tr style={{ background: colours.surface, textAlign: 'left' }}>{['', 'Image', 'Filename', 'Product', 'Colour', 'Supplier code', 'Internal code', 'Action / status'].map((label) => <th key={label} style={{ padding: '9px', borderBottom: `1px solid ${colours.line}`, color: colours.muted }}>{label}</th>)}</tr></thead>
                  <tbody>{folderFiles.map((row) => {
                    const selectable = READY_STATUSES.has(row.status) && row.size <= MAX_FILE_BYTES;
                    return <tr key={row.relativePath} style={{ borderBottom: `1px solid ${colours.line}`, verticalAlign: 'top' }}>
                      <td style={{ padding: '9px' }}><input type="checkbox" checked={selected.has(row.relativePath)} disabled={!selectable || busy} onChange={() => toggleRow(row)} aria-label={`Select ${row.filename}`} /></td>
                      <td style={{ padding: '9px' }}>{row.previewUrl ? <img src={row.previewUrl} alt="" style={{ width: '42px', height: '42px', objectFit: 'cover', borderRadius: '4px' }} /> : '—'}</td>
                      <td style={{ padding: '9px', maxWidth: '190px', wordBreak: 'break-word', color: colours.text }}>{row.filename}<div style={{ color: colours.muted }}>{row.relativePath}</div></td>
                      <td style={{ padding: '9px' }}>{row.productName || '—'}</td>
                      <td style={{ padding: '9px' }}>{row.supplierColourName || '—'}</td>
                      <td style={{ padding: '9px' }}>{row.supplierColourCode || '—'}</td>
                      <td style={{ padding: '9px' }}>{row.internalColourCode || '—'}</td>
                          <td style={{ padding: '9px', color: statusTone(row.status) }}><strong>{statusLabel(row.status)}</strong>{row.phase && <div style={{ marginTop: '3px', color: colours.muted }}>Phase: {row.phase.replaceAll('_', ' ')}</div>}{(row.warning || row.size > MAX_FILE_BYTES) && <div style={{ marginTop: '3px', color: colours.red }}>{row.size > MAX_FILE_BYTES ? `Exceeds ${MAX_FILE_BYTES / 1024 / 1024} MB upload limit.` : row.warning}</div>}</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
              {queuedFolder ? <>
                <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginTop: '14px', fontSize: '13px', color: colours.text }}><input type="checkbox" checked={acknowledgeSkips} onChange={(event) => setAcknowledgeSkips(event.target.checked)} />Analyse in batches of up to {MAX_BATCH_FILES} files and {MAX_BATCH_BYTES / 1024 / 1024} MB, then stage confirmed files and leave unresolved, oversized, or conflicting files skipped.</label>
                <button onClick={processQueuedFolder} disabled={busy || !acknowledgeSkips || analysisState === 'complete'} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '14px', padding: '10px 16px', border: 0, borderRadius: '6px', fontWeight: 600, color: '#fff', background: colours.blue, opacity: busy || !acknowledgeSkips || analysisState === 'complete' ? 0.45 : 1, cursor: 'pointer' }}><Upload size={18} />Analyse {queuedFolder.totalFiles} file(s)</button>
                <button onClick={stageQueuedFolder} disabled={busy || analysisState !== 'complete' || !analysisBatches.some((batch) => batch.rows.some((row) => READY_STATUSES.has(row.status) && row.size <= MAX_FILE_BYTES))} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '14px', marginLeft: '8px', padding: '10px 16px', border: 0, borderRadius: '6px', fontWeight: 600, color: '#fff', background: colours.green, opacity: busy || analysisState !== 'complete' || !analysisBatches.some((batch) => batch.rows.some((row) => READY_STATUSES.has(row.status) && row.size <= MAX_FILE_BYTES)) ? 0.45 : 1, cursor: 'pointer' }}><Upload size={18} />Stage {queuedFolder.totalFiles} file(s)</button>
              </> : <>
                {unresolvedCount > 0 && <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginTop: '14px', fontSize: '13px', color: colours.text }}><input type="checkbox" checked={acknowledgeSkips} onChange={(event) => setAcknowledgeSkips(event.target.checked)} />Upload confirmed files and explicitly leave {unresolvedCount} unresolved or conflicting file(s) skipped.</label>}
                <button onClick={uploadFolder} disabled={busy || selectedRows.length === 0 || (unresolvedCount > 0 && !acknowledgeSkips)} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '14px', padding: '10px 16px', border: 0, borderRadius: '6px', fontWeight: 600, color: '#fff', background: colours.blue, opacity: busy || selectedRows.length === 0 || (unresolvedCount > 0 && !acknowledgeSkips) ? 0.45 : 1, cursor: 'pointer' }}><Upload size={18} />Stage {selectedRows.length} confirmed file(s)</button>
              </>}
            </>
          )}
          {queuedFolder && analysis?.analysisComplete !== true && (
            <div style={{ marginTop: '14px' }}>
              {analysisState === 'failed' && <p role="status" style={{ color: colours.red, fontSize: '13px' }}>Filename analysis failed; staging is disabled until the folder is analysed successfully.</p>}
              <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '13px', color: colours.text }}><input type="checkbox" checked={acknowledgeSkips} onChange={(event) => setAcknowledgeSkips(event.target.checked)} />Analyse in batches of up to {MAX_BATCH_FILES} files and {MAX_BATCH_BYTES / 1024 / 1024} MB, then stage confirmed files and leave unresolved, oversized, or conflicting files skipped.</label>
              <button onClick={processQueuedFolder} disabled={busy || !acknowledgeSkips} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '14px', padding: '10px 16px', border: 0, borderRadius: '6px', fontWeight: 600, color: '#fff', background: colours.blue, opacity: busy || !acknowledgeSkips ? 0.45 : 1, cursor: 'pointer' }}><Upload size={18} />Analyse {queuedFolder.totalFiles} file(s)</button>
              <button onClick={stageQueuedFolder} disabled style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '14px', marginLeft: '8px', padding: '10px 16px', border: 0, borderRadius: '6px', fontWeight: 600, color: '#fff', background: colours.green, opacity: 0.45, cursor: 'not-allowed' }}><Upload size={18} />Stage {queuedFolder.totalFiles} file(s)</button>
            </div>
          )}
        </div>

        <aside style={{ borderLeft: `1px solid ${colours.line}`, paddingLeft: '20px', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}><h3 style={{ fontSize: '15px', color: colours.text, margin: 0 }}>Folder history</h3><button onClick={refreshHistory} disabled={historyLoading} aria-label="Refresh folder history" style={{ border: 0, background: 'transparent', color: colours.muted, cursor: 'pointer' }}><RefreshCw size={16} className={historyLoading ? 'aw-spin' : ''} /></button></div>
          {historyLoading && <p style={{ color: colours.muted, fontSize: '13px' }}>Loading history…</p>}
          {!historyLoading && history.length === 0 && <p style={{ color: colours.muted, fontSize: '13px' }}>No folder imports yet.</p>}
          <div style={{ display: 'grid', gap: '2px' }}>{history.map((item) => <button key={item.documentId || item.id} onClick={() => setSelectedHistory(item)} style={{ textAlign: 'left', padding: '10px 0', border: 0, borderBottom: `1px solid ${colours.line}`, background: selectedHistory?.id === item.id ? colours.surface : 'transparent', cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}><strong style={{ color: colours.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.folderName}</strong>{['completed', 'completed_with_skips'].includes(item.status) ? <CheckCircle size={15} color={statusTone(item.status)} /> : <AlertCircle size={15} color={statusTone(item.status)} />}</div>
            <div style={{ color: colours.muted, fontSize: '12px', marginTop: '4px' }}>{item.supplier} · {item.uploadedFiles}/{item.totalFiles} uploaded</div>
            <div style={{ color: statusTone(item.status), fontSize: '12px' }}>{item.status.replaceAll('_', ' ')} · {item.conflictFiles} conflicts · {item.skippedFiles} skipped</div>
            <div style={{ color: colours.muted, fontSize: '11px' }}>{dateLabel(item.lastUploadedAt)} · map v{item.mappingSchemaVersion}</div>
          </button>)}</div>
          {selectedHistory && <div style={{ paddingTop: '12px', fontSize: '12px', color: colours.muted }}><strong style={{ color: colours.text }}>Selected summary</strong><div>Fingerprint: {selectedHistory.folderFingerprint?.slice(0, 12)}…</div><div>Attempts: {selectedHistory.manifestSummary?.attemptCount || 1}</div><div>Failed: {selectedHistory.failedFiles}</div></div>}
        {selectedHistory && <div style={{ paddingTop: '12px', fontSize: '12px', color: colours.muted }}><div>Current file: {selectedHistory.manifestSummary?.currentFilename || 'None'}</div><div>Phase: {selectedHistory.manifestSummary?.currentPhase || 'analysed'}</div><div>Ready: {selectedHistory.manifestSummary?.readyFiles ?? 0}</div><div>Attempts: {selectedHistory.manifestSummary?.attemptCount || 1}</div></div>}
        </aside>
      </div>
      <style>{`.aw-folder-layout{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:24px}.aw-spin{animation:aw-spin 1s linear infinite}@keyframes aw-spin{to{transform:rotate(360deg)}}@media(max-width:900px){.aw-folder-layout{grid-template-columns:minmax(0,1fr)}.aw-folder-layout aside{border-left:0!important;border-top:1px solid #e5e7eb;padding-left:0!important;padding-top:20px}}`}</style>
    </section>
  );
}
