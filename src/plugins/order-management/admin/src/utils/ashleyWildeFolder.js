export const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
export const MAX_BATCH_FILES = 10;
// Use the smallest end-to-end ceiling observed for the deployed bulk path.
// Keep 5 MiB for multipart boundaries and signed-folder metadata.
export const EFFECTIVE_BULK_PATH_LIMIT_BYTES = 50 * 1024 * 1024;
export const MULTIPART_OVERHEAD_BYTES = 5 * 1024 * 1024;
export const MAX_BATCH_BYTES = EFFECTIVE_BULK_PATH_LIMIT_BYTES - MULTIPART_OVERHEAD_BYTES;
export const MAX_FILE_BYTES = MAX_BATCH_BYTES;
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

export function boundedBatches(items, size = MAX_BATCH_FILES) {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('Batch size must be a positive integer.');
  const batches = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

export function partitionUploadRows(rows, maxFiles = MAX_BATCH_FILES, maxBytes = MAX_BATCH_BYTES) {
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) throw new Error('Batch file limit must be a positive integer.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Batch byte limit must be a positive integer.');
  const batches = [];
  const oversized = [];
  let current = [];
  let bytes = 0;
  for (const row of rows) {
    const fileSize = Number(row.file?.size ?? row.size ?? 0);
    if (!Number.isSafeInteger(fileSize) || fileSize < 0) throw new Error(`${row.filename} has an invalid file size.`);
    const maxSingleFileBytes = Math.min(MAX_FILE_BYTES, maxBytes);
    if (fileSize > maxSingleFileBytes) {
      oversized.push({
        ...row,
        status: 'unsupported_file',
        warning: `${row.filename} is larger than the supported ${maxSingleFileBytes / 1024 / 1024} MB upload limit.`,
      });
      continue;
    }
    if (current.length === maxFiles || bytes + fileSize > maxBytes) {
      if (current.length) batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += fileSize;
  }
  if (current.length) batches.push(current);
  return { batches, oversized };
}

export function sequentialBatches(rows, maxFiles = MAX_BATCH_FILES, maxBytes = MAX_BATCH_BYTES) {
  return partitionUploadRows(rows, maxFiles, maxBytes).batches;
}
