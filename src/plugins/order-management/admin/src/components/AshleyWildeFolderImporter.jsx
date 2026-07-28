import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import { AlertCircle, CheckCircle, FolderOpen, Loader2, RefreshCw, Upload } from 'lucide-react';
import adminCatalogRoutes from '../../../shared/routes';
import {
  READY_STATUSES, boundedBatches, fingerprintManifest, folderNameFromFiles, isSupportedFileName,
  relativePathOf, sequentialBatches, sha256File,
} from '../utils/ashleyWildeFolder';

const colours = {
  text: '#374151', muted: '#6b7280', line: '#e5e7eb', blue: '#3b82f6',
  green: '#059669', amber: '#b45309', red: '#dc2626', surface: '#f9fafb',
};

async function adminResponse(request, ...args) {
  const response = await request(...args);
  const payload = response?.data || {};
  if (payload.success === false && payload.data === undefined && payload.results === undefined) {
    const error = new Error(typeof payload.error === 'string' ? payload.error : payload.message || 'Ashley Wilde request failed.');
    error.status = payload.error?.status || response?.status;
    error.response = response;
    throw error;
  }
  return payload;
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
  const status = responseStatus(error);
  if (status === 401) return 'The request could not authenticate. Your administrator credentials were not accepted.';
  if (status === 403) return 'You are signed in, but your administrator account does not have permission to use the Ashley Wilde importer.';
  const serverMessage = responseMessage(error);
  if (serverMessage) return serverMessage;
  if (status === 503) return 'Ashley Wilde mapping is unavailable. Check the configured mapping and try again.';
  if (status >= 500) return 'The Ashley Wilde service failed. Try again.';
  if (error?.code === 'ERR_NETWORK' || error?.request && !error?.response) {
    return 'The Ashley Wilde service could not be reached. Check that Strapi is running and try again.';
  }
  if (status === 400) return error?.message || 'The selected folder is malformed or could not be analysed.';
  return error?.message || 'The Ashley Wilde request failed. Try again.';
}

const dateLabel = (value) => value ? new Date(value).toLocaleString() : 'Not uploaded';
const statusTone = (status) => status === 'completed' || status === 'staged' ? colours.green
  : ['failed', 'identity_conflict', 'conflicting_image', 'colour_conflict', 'thumbnail_conflict'].includes(status) ? colours.red
    : ['partial', 'completed_with_skips', 'pending_manual_mapping', 'blocked', 'exact_duplicate', 'logical_duplicate'].includes(status) ? colours.amber : colours.muted;
const statusLabel = (status) => ({
  matched: 'safely mapped', mapped: 'Fabric resolved', pending_manual_mapping: 'pending manual mapping',
  classified_asset: 'blocked filename / non-colour', blocked: 'blocked', exact_duplicate: 'exact duplicate',
  logical_duplicate: 'logical duplicate', conflicting_image: 'conflicting image', identity_conflict: 'mapping conflict',
  staged: 'staged', failed: 'failed', already_staged: 'already staged',
}[status] || String(status || 'unknown').replaceAll('_', ' '));

export default function AshleyWildeFolderImporter() {
  const { get, post, put, del } = useFetchClient();
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
    fileQueueRef.current = files.map((file) => ({
      file, filename: file.name, relativePath: relativePathOf(file), size: file.size,
      mimeType: file.type || 'application/octet-stream',
    })).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    folderFiles.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
    setFolderFiles([]);
    setError('');
    setAcknowledgeSkips(false);
    setQueuedFolder({ folderName: selectedFolderName, totalFiles: files.length });
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

  const uploadFolder = async () => {
    if (!analysis || analysis.analysisComplete !== true || !selectedRows.length || (unresolvedCount > 0 && !acknowledgeSkips)) return;
    setBusy(true);
    setError('');
    try {
      const batches = sequentialBatches(selectedRows);
      const manifest = analysis.rows.map(({ relativePath, sha256, size }) => ({ relativePath, sha256, size }));
      for (let index = 0; index < batches.length; index += 1) {
        const batch = batches[index];
        setProgress(`Uploading batch ${index + 1} of ${batches.length} (${batch.length} files)`);
        const form = new FormData();
        form.append('ashleyWilde', 'true');
        form.append('folderName', analysis.folderName);
        form.append('folderFingerprint', analysis.folderFingerprint);
        form.append('folderManifest', JSON.stringify(manifest));
        form.append('fileMetadata', JSON.stringify(batch.map(({ relativePath, sha256, size }) => ({ relativePath, sha256, size }))));
        form.append('finalBatch', String(index === batches.length - 1));
        batch.forEach((row) => form.append('files', row.file, row.filename));
        const payload = await adminResponse(post, adminCatalogRoutes.bulkImageUpload, form);
        if (!payload.data) throw new Error(`Batch ${index + 1} failed safely.`);
          setFolderFiles((current) => current.map((row) => {
          const result = payload.data.results.find((item) => item.filename === row.filename);
          return result ? { ...row, uploadResult: result, status: result.status } : row;
        }));
        await refreshHistory();
        if (payload.data.failed > 0) throw new Error(`Batch ${index + 1} reported ${payload.data.failed} failed file(s). Remaining batches were not sent.`);
      }
      setProgress('Folder import complete');
      setSelected(new Set());
      await refreshHistory();
    } catch (uploadError) {
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
      const manifest = hashed.map(({ relativePath, sha256, size }) => ({ relativePath, sha256, size }));
      const folderFingerprint = await fingerprintManifest(manifest);
      const batches = boundedBatches(hashed, 10);
      const summary = { totalFiles: hashed.length, matchedFiles: 0, readyFiles: 0, alreadyCompleteFiles: 0, unresolvedFiles: 0, conflictFiles: 0 };
      const analysedRows = [];
      const analysedBatches = [];
      let lastServerAnalysis = null;
      for (let index = 0; index < batches.length; index += 1) {
        const batch = batches[index];
        setProgress(`Processing ${Math.min((index + 1) * 10, hashed.length)} / ${hashed.length} — batch ${index + 1} of ${batches.length}`);
        const batchManifest = batch.map(({ relativePath, sha256, size }) => ({ relativePath, sha256, size }));
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
          if (!local || !isSupportedFileName(row.filename)) return { file: local?.file, previewUrl: local?.previewUrl, ...row };
          return { file: local?.file, previewUrl: URL.createObjectURL(local.file), ...row };
        });
        analysedRows.push(...rows);
        analysedBatches.push({ rows, analysisToken: serverAnalysis.analysisToken });
        lastServerAnalysis = serverAnalysis;
      }
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
    if (!queuedFolder || analysisState !== 'complete' || !analysisBatches.length || !fileQueueRef.current.length) return;
    setBusy(true);
    setError('');
    try {
      const manifest = fileQueueRef.current.map(({ relativePath, sha256, size }) => ({ relativePath, sha256, size }));
      const folderFingerprint = analysis?.folderFingerprint;
      for (let index = 0; index < analysisBatches.length; index += 1) {
        const batch = analysisBatches[index];
        const ready = batch.rows.filter((row) => READY_STATUSES.has(row.status) && row.size <= 50 * 1024 * 1024);
        if (!ready.length) continue;
        setProgress(`Staging confirmed files from batch ${index + 1} of ${analysisBatches.length}`);
        const form = new FormData();
        form.append('ashleyWilde', 'true');
        form.append('folderName', queuedFolder.folderName);
        form.append('folderFingerprint', folderFingerprint);
        form.append('folderManifest', JSON.stringify(manifest));
        form.append('fileMetadata', JSON.stringify(ready.map(({ relativePath, sha256, size }) => ({ relativePath, sha256, size }))));
        form.append('analysisToken', batch.analysisToken);
        form.append('finalBatch', String(index === analysisBatches.length - 1));
        ready.forEach((row) => form.append('files', row.file, row.filename));
        const upload = await adminResponse(post, adminCatalogRoutes.bulkImageUpload, form);
        if (!upload.data) throw new Error(`Batch ${index + 1} failed safely.`);
        setFolderFiles((current) => current.map((row) => {
          const result = upload.data.results.find((item) => item.filename === row.filename);
          return result ? { ...row, uploadResult: result, status: result.status } : row;
        }));
        if (upload.data.failed > 0) throw new Error(`Batch ${index + 1} reported ${upload.data.failed} failed file(s). Remaining batches were not sent.`);
      }
      fileQueueRef.current = [];
      setQueuedFolder(null);
      setAnalysisBatches([]);
      setProgress('Folder import complete');
      await refreshHistory();
    } catch (stageError) {
      setError(safeErrorMessage(stageError));
    } finally {
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
                    const selectable = READY_STATUSES.has(row.status) && row.size <= 50 * 1024 * 1024;
                    return <tr key={row.relativePath} style={{ borderBottom: `1px solid ${colours.line}`, verticalAlign: 'top' }}>
                      <td style={{ padding: '9px' }}><input type="checkbox" checked={selected.has(row.relativePath)} disabled={!selectable || busy} onChange={() => toggleRow(row)} aria-label={`Select ${row.filename}`} /></td>
                      <td style={{ padding: '9px' }}>{row.previewUrl ? <img src={row.previewUrl} alt="" style={{ width: '42px', height: '42px', objectFit: 'cover', borderRadius: '4px' }} /> : '—'}</td>
                      <td style={{ padding: '9px', maxWidth: '190px', wordBreak: 'break-word', color: colours.text }}>{row.filename}<div style={{ color: colours.muted }}>{row.relativePath}</div></td>
                      <td style={{ padding: '9px' }}>{row.productName || '—'}</td>
                      <td style={{ padding: '9px' }}>{row.supplierColourName || '—'}</td>
                      <td style={{ padding: '9px' }}>{row.supplierColourCode || '—'}</td>
                      <td style={{ padding: '9px' }}>{row.internalColourCode || '—'}</td>
                      <td style={{ padding: '9px', color: statusTone(row.status) }}><strong>{statusLabel(row.status)}</strong>{(row.warning || row.size > 50 * 1024 * 1024) && <div style={{ marginTop: '3px', color: colours.red }}>{row.size > 50 * 1024 * 1024 ? 'Exceeds 50 MB file limit.' : row.warning}</div>}</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
              {queuedFolder ? <>
                <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginTop: '14px', fontSize: '13px', color: colours.text }}><input type="checkbox" checked={acknowledgeSkips} onChange={(event) => setAcknowledgeSkips(event.target.checked)} />Analyse in batches of 10, then stage confirmed files and leave unresolved or conflicting files skipped.</label>
                <button onClick={processQueuedFolder} disabled={busy || !acknowledgeSkips || analysisState === 'complete'} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '14px', padding: '10px 16px', border: 0, borderRadius: '6px', fontWeight: 600, color: '#fff', background: colours.blue, opacity: busy || !acknowledgeSkips || analysisState === 'complete' ? 0.45 : 1, cursor: 'pointer' }}><Upload size={18} />Analyse {queuedFolder.totalFiles} file(s)</button>
                <button onClick={stageQueuedFolder} disabled={busy || analysisState !== 'complete' || !analysisBatches.some((batch) => batch.rows.some((row) => READY_STATUSES.has(row.status) && row.size <= 50 * 1024 * 1024))} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '14px', marginLeft: '8px', padding: '10px 16px', border: 0, borderRadius: '6px', fontWeight: 600, color: '#fff', background: colours.green, opacity: busy || analysisState !== 'complete' || !analysisBatches.some((batch) => batch.rows.some((row) => READY_STATUSES.has(row.status) && row.size <= 50 * 1024 * 1024)) ? 0.45 : 1, cursor: 'pointer' }}><Upload size={18} />Stage {queuedFolder.totalFiles} file(s)</button>
              </> : <>
                {unresolvedCount > 0 && <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginTop: '14px', fontSize: '13px', color: colours.text }}><input type="checkbox" checked={acknowledgeSkips} onChange={(event) => setAcknowledgeSkips(event.target.checked)} />Upload confirmed files and explicitly leave {unresolvedCount} unresolved or conflicting file(s) skipped.</label>}
                <button onClick={uploadFolder} disabled={busy || selectedRows.length === 0 || (unresolvedCount > 0 && !acknowledgeSkips)} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '14px', padding: '10px 16px', border: 0, borderRadius: '6px', fontWeight: 600, color: '#fff', background: colours.blue, opacity: busy || selectedRows.length === 0 || (unresolvedCount > 0 && !acknowledgeSkips) ? 0.45 : 1, cursor: 'pointer' }}><Upload size={18} />Stage {selectedRows.length} confirmed file(s)</button>
              </>}
            </>
          )}
          {queuedFolder && analysis?.analysisComplete !== true && (
            <div style={{ marginTop: '14px' }}>
              {analysisState === 'failed' && <p role="status" style={{ color: colours.red, fontSize: '13px' }}>Filename analysis failed; staging is disabled until the folder is analysed successfully.</p>}
              <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '13px', color: colours.text }}><input type="checkbox" checked={acknowledgeSkips} onChange={(event) => setAcknowledgeSkips(event.target.checked)} />Analyse in batches of 10, then stage confirmed files and leave unresolved or conflicting files skipped.</label>
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
        </aside>
      </div>
      <style>{`.aw-folder-layout{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:24px}.aw-spin{animation:aw-spin 1s linear infinite}@keyframes aw-spin{to{transform:rotate(360deg)}}@media(max-width:900px){.aw-folder-layout{grid-template-columns:minmax(0,1fr)}.aw-folder-layout aside{border-left:0!important;border-top:1px solid #e5e7eb;padding-left:0!important;padding-top:20px}}`}</style>
    </section>
  );
}
