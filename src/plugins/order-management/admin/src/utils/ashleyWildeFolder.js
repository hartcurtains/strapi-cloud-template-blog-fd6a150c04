export const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
import uploadPolicy from '../../../shared/ashley-wilde-upload-policy.json';

export const MAX_BATCH_FILES = uploadPolicy.maxBatchFiles;
export const EFFECTIVE_BULK_PATH_LIMIT_BYTES = uploadPolicy.effectivePathLimitBytes;
export const MULTIPART_OVERHEAD_BYTES = uploadPolicy.multipartOverheadBytes;
export const MAX_BATCH_BYTES = uploadPolicy.normalBatchTargetBytes;
export const MAX_FILE_BYTES = uploadPolicy.maxFileBytes;
export const STAGING_REQUEST_TIMEOUT_MS = uploadPolicy.requestTimeoutMs;
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

export async function fingerprintManifest(manifest, supplier = 'Ashley Wilde') {
  const normalizedSupplier = String(supplier || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  if (!normalizedSupplier) throw new Error('Supplier is required to fingerprint a folder manifest.');
  const canonicalManifest = manifest
    .map((item) => `${item.relativePath}\0${item.sha256.toLowerCase()}`)
    .sort((left, right) => left.localeCompare(right))
    .join('\n');
  const canonical = `${normalizedSupplier}\0${canonicalManifest}`;
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
    const maxSingleFileBytes = MAX_FILE_BYTES;
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

export function assertUploadBatch(rows, maxFiles = MAX_BATCH_FILES, maxBytes = MAX_BATCH_BYTES) {
  const stats = rows.reduce((result, row) => {
    const size = Number(row.file?.size ?? row.size ?? 0);
    result.totalBytes += size;
    result.largestFileBytes = Math.max(result.largestFileBytes, size);
    return result;
  }, { totalBytes: 0, largestFileBytes: 0 });
  if (rows.length < 1 || rows.length > maxFiles) throw new Error('Invalid Ashley Wilde staging batch file count.');
  if (stats.largestFileBytes > MAX_FILE_BYTES) throw new Error('Invalid Ashley Wilde staging batch contains an oversized file.');
  const permittedSingleFile = rows.length === 1 && stats.totalBytes > maxBytes;
  if (stats.totalBytes > maxBytes && !permittedSingleFile) {
    throw new Error(`Invalid Ashley Wilde staging batch: ${stats.totalBytes} bytes exceeds the ${maxBytes} byte target.`);
  }
  return stats;
}

export function sequentialBatches(rows, maxFiles = MAX_BATCH_FILES, maxBytes = MAX_BATCH_BYTES) {
  return partitionUploadRows(rows, maxFiles, maxBytes).batches;
}
