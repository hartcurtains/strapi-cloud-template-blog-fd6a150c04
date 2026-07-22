export const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
export const READY_STATUSES = new Set([
  'matched', 'would_create_colour', 'would_create_internal_code',
  'would_create_relation', 'would_upload_and_link', 'previously_uploaded',
  'would_stage_identity', 'would_stage_asset', 'pending_manual_mapping', 'already_staged', 'staged',
]);

export function isSupportedFileName(filename) {
  const extension = `.${String(filename || '').split('.').pop().toLowerCase()}`;
  return SUPPORTED_EXTENSIONS.includes(extension);
}

export function relativePathOf(file) {
  return String(file.webkitRelativePath || file.name).normalize('NFKC').replace(/\\/g, '/').replace(/^\.\//, '');
}

export function folderNameFromFiles(files) {
  const roots = [...new Set(files.map((file) => relativePathOf(file).split('/')[0]).filter(Boolean))];
  return roots.length === 1 ? roots[0] : 'Selected folder';
}

export async function sha256File(file) {
  const digest = await window.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function fingerprintManifest(manifest) {
  const canonical = manifest
    .map((item) => `${item.relativePath}\0${item.sha256.toLowerCase()}`)
    .sort((left, right) => left.localeCompare(right))
    .join('\n');
  const bytes = new TextEncoder().encode(canonical);
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function boundedBatches(items, size = 10) {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('Batch size must be a positive integer.');
  const batches = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

export function sequentialBatches(rows, maxFiles = 10, maxBytes = 100 * 1024 * 1024) {
  const batches = [];
  let current = [];
  let bytes = 0;
  for (const row of rows) {
    if (row.file.size > 50 * 1024 * 1024) throw new Error(`${row.filename} exceeds the 50 MB file limit.`);
    if (current.length === maxFiles || bytes + row.file.size > maxBytes) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += row.file.size;
  }
  if (current.length) batches.push(current);
  return batches;
}
