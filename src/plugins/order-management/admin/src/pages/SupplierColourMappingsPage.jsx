import React, { useCallback, useEffect, useState } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import adminCatalogRoutes from '../../../shared/routes';

const card = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 20, marginBottom: 16 };
const button = { border: 0, borderRadius: 6, padding: '9px 14px', cursor: 'pointer', background: '#4945ff', color: '#fff', fontWeight: 600 };

function errorMessage(error) {
  const payload = error?.response?.data || error?.data;
  const value = payload?.error;
  if (typeof value === 'string') return value;
  if (value?.message) return value.message;
  if (payload?.message) return payload.message;
  if (error?.request && !error?.response) return 'The Strapi service could not be reached.';
  return error?.message || 'The supplier mapping request failed.';
}

function Summary({ preview }) {
  if (!preview) return null;
  const summary = preview.validationSummary || {};
  const comparison = preview.comparison || {};
  return <div style={{ marginTop: 16, background: '#f8fafc', padding: 14, borderRadius: 6 }}>
    <strong>Validation preview</strong>
    <p style={{ margin: '8px 0' }}>{summary.valid ? 'Valid and ready to activate.' : `${summary.blockingErrors ?? summary.issueCount ?? 0} issue(s) block activation.`}</p>
    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
      <span>Fabrics: {summary.totalFabrics || 0}</span><span>Rows: {summary.totalRows || 0}</span>
      <span>Resolved: {summary.resolvedFabrics || 0}</span><span>Missing: {summary.missingFabrics || 0}</span>
      <span>Ambiguous: {summary.ambiguousFabrics || 0}</span>
      <span>Unchanged: {(comparison.unchanged || []).length}</span><span>New: {(comparison.added || []).length}</span>
      <span>Changed: {(comparison.changed || []).length}</span><span>Removed: {(comparison.removed || []).length}</span>
      <span>Approved-code reconciliations: {summary.approvedCodeReconciliations ?? (summary.codeReconciliations || []).length}</span>
      <span>Automatically corrected codes: {summary.automaticallyCorrectedInternalCodes || 0}</span>
      <span>Converted conflicts: {summary.convertedBlockingErrors || 0}</span>
    </div>
    {(preview.issues || []).length > 0 && <ul style={{ color: '#b42318', marginBottom: 0 }}>
      {preview.issues.slice(0, 20).map((issue, index) => <li key={`${issue.type}-${index}`}>{issue.message}</li>)}
    </ul>}
  </div>;
}

export default function SupplierColourMappingsPage() {
  const { get, post } = useFetchClient();
  const [file, setFile] = useState(null);
  const [importRecord, setImportRecord] = useState(null);
  const [preview, setPreview] = useState(null);
  const [active, setActive] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [reenrich, setReenrich] = useState({ supplier: 'Ashley Wilde', supplierProductCode: '', fabricName: '' });
  const [reenrichPreview, setReenrichPreview] = useState(null);

  const refresh = useCallback(async () => {
    const response = await get(`${adminCatalogRoutes.supplierMappingsActive}?supplier=${encodeURIComponent('Ashley Wilde')}`);
    setActive(response?.data?.data || response?.data || null);
  }, [get]);

  useEffect(() => { refresh().catch((requestError) => setError(errorMessage(requestError))); }, [refresh]);

  const upload = async (event) => {
    event.preventDefault();
    if (!file) return;
    setBusy(true); setError(''); setMessage(''); setPreview(null); setConfirm(false);
    try {
      const form = new FormData(); form.append('file', file);
      const response = await post(adminCatalogRoutes.supplierMappingsUpload, form);
      const data = response?.data?.data || response?.data || {};
      const importDocumentId = data.import?.documentId || data.preview?.importDocumentId;
      setImportRecord(data.import ? { ...data.import, documentId: importDocumentId } : null);
      setPreview(data.preview ? { ...data.preview, importDocumentId } : null);
      setMessage('Upload validated. Review the preview before applying.');
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  };

  const apply = async () => {
    if (!importRecord || !confirm) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await post(adminCatalogRoutes.supplierMappingsApply, { importDocumentId: importRecord.documentId, confirm: true });
      const data = response?.data?.data || response?.data || {};
      setImportRecord(data.import); setPreview(data.preview); setMessage('Mapping version activated.'); setConfirm(false); await refresh();
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  };

  const exportActive = async () => {
    setBusy(true); setError('');
    try {
      const documentId = active?.version?.documentId;
      const response = await get(`${adminCatalogRoutes.supplierMappingsExport}?documentId=${encodeURIComponent(documentId || '')}`);
      const payload = response?.data || response;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${payload.supplier || 'supplier'}-${payload.mappingVersion || 'mapping'}.json`; anchor.click(); URL.revokeObjectURL(url);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  };

  const exportRepositoryFallback = async () => {
    setBusy(true); setError('');
    try {
      const response = await get(adminCatalogRoutes.supplierMappingsFallbackExport);
      const payload = response?.data || response;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'ashley-wilde-complete-mapping.json'; anchor.click(); URL.revokeObjectURL(url);
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  };

  const runReenrich = async (applyChanges = false) => {
    setBusy(true); setError('');
    try {
      const response = await post(adminCatalogRoutes.supplierMappingsReenrich, { ...reenrich, apply: applyChanges, confirm: applyChanges });
      setReenrichPreview(response?.data?.data || response?.data || null);
      setMessage(applyChanges ? 'Pending identities were re-enriched.' : 'Re-enrichment preview loaded.');
    } catch (requestError) { setError(errorMessage(requestError)); } finally { setBusy(false); }
  };

  return <main style={{ maxWidth: 1100, margin: '0 auto', padding: 32, color: '#1f2937', fontFamily: 'Arial, sans-serif' }}>
    <h1 style={{ marginBottom: 6 }}>Supplier colour mappings</h1>
    <p style={{ color: '#667085', marginTop: 0 }}>Upload, validate, preview, activate and export versioned supplier mappings.</p>
    {error && <div style={{ ...card, borderColor: '#fecdca', color: '#b42318' }}>{error}</div>}
    {message && <div style={{ ...card, borderColor: '#abefc6', color: '#067647' }}>{message}</div>}

    <section style={card}>
      <h2 style={{ marginTop: 0 }}>Upload JSON</h2>
      <form onSubmit={upload} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" accept=".json,application/json" onChange={(event) => setFile(event.target.files?.[0] || null)} />
        <button style={{ ...button, opacity: busy || !file ? 0.55 : 1 }} disabled={busy || !file}>Validate upload</button>
      </form>
      <Summary preview={preview} />
      {importRecord && <div style={{ marginTop: 14 }}>
        <div>Version <strong>{importRecord.version}</strong> · status <strong>{importRecord.status}</strong> · {importRecord.mappingCount} rows</div>
        <label style={{ display: 'block', margin: '12px 0' }}><input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} /> I have reviewed this preview and want to activate it.</label>
        <button style={{ ...button, opacity: busy || !confirm || importRecord.status !== 'ready' ? 0.55 : 1 }} disabled={busy || !confirm || importRecord.status !== 'ready'} onClick={apply}>Apply and activate</button>
      </div>}
    </section>

    <section style={card}>
      <h2 style={{ marginTop: 0 }}>Active version</h2>
      {active?.version ? <><div><strong>{active.version.supplier}</strong> · {active.version.version} · {active.version.mappingCount} rows</div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}><button style={button} disabled={busy} onClick={exportActive}>Export active JSON</button><button style={{ ...button, background: '#344054' }} disabled={busy} onClick={exportRepositoryFallback}>Download approved repository fallback JSON</button></div></> : <><div>No active mapping version.</div><button style={{ ...button, marginTop: 12, background: '#344054' }} disabled={busy} onClick={exportRepositoryFallback}>Download approved repository fallback JSON</button></>}
    </section>

    <section style={card}>
      <h2 style={{ marginTop: 0 }}>Staged identity re-enrichment</h2>
      <p style={{ color: '#667085' }}>Preview first. Pending identities can be verified and verified identities can be reconciled to the approved canonical name/code. Promoted identities are protected.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {['supplier', 'supplierProductCode', 'fabricName'].map((field) => <input key={field} placeholder={field} value={reenrich[field]} onChange={(event) => setReenrich({ ...reenrich, [field]: event.target.value })} />)}
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}><button style={button} disabled={busy} onClick={() => runReenrich(false)}>Preview re-enrichment</button><button style={{ ...button, background: '#b42318' }} disabled={busy || !reenrichPreview || !(reenrichPreview.summary?.wouldVerify || reenrichPreview.summary?.wouldReconcile)} onClick={() => runReenrich(true)}>Apply reviewed updates</button></div>
      {reenrichPreview?.summary && <p>Matched {reenrichPreview.summary.total}; would verify {reenrichPreview.summary.wouldVerify}; would reconcile {reenrichPreview.summary.wouldReconcile || 0}; unchanged {reenrichPreview.summary.unchanged}; conflicts {reenrichPreview.summary.conflicts}.</p>}
    </section>
  </main>;
}
