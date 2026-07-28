#!/usr/bin/env node

import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

// Large supplier folders should not retain decoded image buffers between files.
sharp.cache({ memory: 0, files: 0, items: 0 });

export const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp']);
export const IMAGE_LIKE_EXTENSIONS = new Set(['.avif', '.bmp', '.gif', '.heic', '.heif', '.ico', '.jxl', '.svg']);
export const IGNORED_FILENAMES = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);
export const DIMENSION_LIMITS = [4000, 3500, 3000, 2500];
export const FIRST_PASS_QUALITIES = [90, 86, 82, 78, 74];
export const FOLLOWUP_QUALITIES = [86, 82, 78, 74];
export const TARGET_BYTES = 18 * 1024 * 1024;
export const ABSOLUTE_OUTPUT_BYTES = 20 * 1024 * 1024;
export const DEFAULT_CONCURRENCY = 2;
export const SETTINGS_VERSION = 'ashley-wilde-preparation-v1';

const SETTINGS = Object.freeze({
  settingsVersion: SETTINGS_VERSION,
  outputFormat: 'jpeg',
  maxDimension: 4000,
  fallbackDimensions: DIMENSION_LIMITS,
  targetBytes: TARGET_BYTES,
  absoluteOutputBytes: ABSOLUTE_OUTPUT_BYTES,
  firstPassQualities: FIRST_PASS_QUALITIES,
  followupQualities: FOLLOWUP_QUALITIES,
  progressive: true,
  colourspace: 'srgb',
  preserveAspectRatio: true,
  withoutEnlargement: true,
});

function usage() {
  return `Ashley Wilde local image preparation\n\nUsage:\n  node scripts/prepare-ashley-wilde-images.mjs --input <folder> --output <folder>\n\nOptions:\n  --input <folder>       Source folder containing original images\n  --output <folder>      Separate folder for upload-ready copies\n  --concurrency <1-4>   Bounded processing concurrency (default: 2)\n  --dry-run              Scan and inspect without writing any output\n  --validate-output      Validate an existing prepared output folder\n  --help                 Show this help\n`;
}

function parseArgs(argv) {
  const options = { concurrency: DEFAULT_CONCURRENCY, dryRun: false, validateOutput: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--validate-output') options.validateOutput = true;
    else if (argument === '--input') options.input = argv[++index];
    else if (argument === '--output') options.output = argv[++index];
    else if (argument === '--concurrency') options.concurrency = Number(argv[++index]);
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (options.help) return options;
  if (!options.validateOutput && !options.input) throw new Error('--input is required.');
  if (!options.output) throw new Error('--output is required.');
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 4) {
    throw new Error('--concurrency must be an integer from 1 to 4.');
  }
  return options;
}

function normaliseRelative(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isIgnoredName(name) {
  return IGNORED_FILENAMES.has(name.toLowerCase()) || name.startsWith('.');
}

function extensionOf(filePath) {
  return path.extname(filePath).toLowerCase();
}

function isSupported(filePath) {
  return SUPPORTED_EXTENSIONS.has(extensionOf(filePath));
}

function isImageLike(filePath) {
  return IMAGE_LIKE_EXTENSIONS.has(extensionOf(filePath));
}

function canonicalOutputName(filePath) {
  return `${path.basename(filePath, path.extname(filePath))}.jpg`;
}

function isWithin(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function walkFiles(root, { includeHidden = false } = {}) {
  const files = [];
  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!includeHidden && isIgnoredName(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

async function fingerprintFile(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

async function inspectSource(filePath, inputRoot) {
  if (!isSupported(filePath) && !isImageLike(filePath)) return null;
  const stat = await fs.stat(filePath);
  const relativePath = normaliseRelative(path.relative(inputRoot, filePath));
  const record = {
    relativeSourcePath: relativePath,
    sourceFilename: path.basename(filePath),
    sourceBytes: stat.size,
    sourceFormat: extensionOf(filePath).slice(1).toLowerCase(),
    sourceFingerprint: await fingerprintFile(filePath),
    canonicalOutputFilename: canonicalOutputName(filePath),
    sourcePath: filePath,
  };
  if (!isSupported(filePath)) {
    return isImageLike(filePath) ? { ...record, status: 'unsupported', error: `Unsupported image format: .${record.sourceFormat}` } : null;
  }
  try {
    const metadata = await sharp(filePath).metadata();
    return {
      ...record,
      sourceWidth: metadata.width || null,
      sourceHeight: metadata.height || null,
      sourceFormat: metadata.format || record.sourceFormat,
      hasAlpha: Boolean(metadata.hasAlpha),
      status: 'pending',
    };
  } catch (error) {
    return {
      ...record,
      sourceWidth: null,
      sourceHeight: null,
      hasAlpha: false,
      status: 'corrupt',
      error: safeError(error),
    };
  }
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function sourceToManifest(record, extra = {}) {
  const {
    sourcePath: _sourcePath,
    status: _status,
    ...base
  } = record;
  return {
    ...base,
    ...extra,
    status: extra.status ?? record.status,
    processingTimestamp: extra.processingTimestamp ?? null,
    processingSettingsVersion: SETTINGS_VERSION,
  };
}

function collisionGroups(records) {
  const groups = new Map();
  for (const record of records.filter((item) => item.status === 'pending' || item.status === 'completed' || item.status === 'skipped_unchanged')) {
    const key = record.canonicalOutputFilename.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return groups;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'n/a';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : 'n/a';
}

async function readManifest(outputRoot) {
  try {
    return JSON.parse(await fs.readFile(path.join(outputRoot, 'ashley-wilde-preparation-manifest.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { settings: SETTINGS, records: [] };
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    await fs.rename(temporary, filePath);
  } catch (error) {
    if (!['EEXIST', 'EPERM', 'ENOTEMPTY'].includes(error.code)) throw error;
    await fs.rm(filePath, { force: true });
    await fs.rename(temporary, filePath);
  }
}

async function replaceOutputAtomically(temporary, outputPath) {
  try {
    await fs.rename(temporary, outputPath);
  } catch (error) {
    if (!['EEXIST', 'EPERM', 'ENOTEMPTY'].includes(error.code)) throw error;
    await fs.rm(outputPath, { force: true });
    await fs.rename(temporary, outputPath);
  }
}

async function encodeCandidate(sourcePath, outputRoot, outputName, maxDimension, quality) {
  const temporary = path.join(outputRoot, `.${outputName}.ashley-wilde-tmp-${process.pid}-${crypto.randomUUID()}`);
  try {
    const result = await sharp(sourcePath)
      .rotate()
      .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
      .toColorspace('srgb')
      .jpeg({ quality, progressive: true, chromaSubsampling: '4:4:4' })
      .toFile(temporary);
    return { temporary, ...result };
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function prepareImage(record, outputRoot) {
  if (record.hasAlpha) return { status: 'needs_review', error: 'Meaningful transparency was detected; JPEG flattening was not performed.' };
  const dimensionAttempts = DIMENSION_LIMITS.flatMap((dimension, dimensionIndex) => {
    const qualities = dimensionIndex === 0 ? FIRST_PASS_QUALITIES : FOLLOWUP_QUALITIES;
    return qualities.map((quality) => ({ dimension, quality }));
  });
  let lastResult = null;
  for (const attempt of dimensionAttempts) {
    if (attempt.dimension < 2500) continue;
    if (lastResult?.temporary) await fs.rm(lastResult.temporary, { force: true }).catch(() => undefined);
    const result = await encodeCandidate(record.sourcePath, outputRoot, record.canonicalOutputFilename, attempt.dimension, attempt.quality);
    lastResult = result;
    if (result.size <= TARGET_BYTES) {
      const outputPath = path.join(outputRoot, record.canonicalOutputFilename);
      await replaceOutputAtomically(result.temporary, outputPath);
      const outputMetadata = await sharp(outputPath).metadata();
      return {
        status: 'completed',
        outputBytes: result.size,
        outputWidth: outputMetadata.width || null,
        outputHeight: outputMetadata.height || null,
        finalJpegQuality: attempt.quality,
        finalDimensionLimit: attempt.dimension,
      };
    }
  }
  if (lastResult?.temporary) await fs.rm(lastResult.temporary, { force: true }).catch(() => undefined);
  return {
    status: 'needs_review',
    error: `Could not reach ${formatBytes(TARGET_BYTES)} at ${DIMENSION_LIMITS.at(-1)} px and JPEG quality 74 without further quality loss.`,
  };
}

function recordForResume(previous, current, outputRoot) {
  if (!previous || previous.sourceFingerprint !== current.sourceFingerprint || previous.processingSettingsVersion !== SETTINGS_VERSION || !['completed', 'skipped_unchanged'].includes(previous.status)) return null;
  const outputPath = path.join(outputRoot, current.canonicalOutputFilename);
  return fs.stat(outputPath).then(() => previous).catch(() => null);
}

function progressLine(index, total, record, status, extra = '', counters = {}) {
  const label = `${index}/${total} ${status.padEnd(17)} ${record.relativeSourcePath}`;
  console.log(`${label} (${formatBytes(record.sourceBytes)}${extra ? ` → ${extra}` : ''}; skipped ${counters.skipped || 0}; failed ${counters.failed || 0}; remaining ${Math.max(0, total - index)})`);
}

async function buildReport(records, inputRoot, outputRoot, startedAt) {
  const sourceBytes = records.reduce((total, record) => total + Number(record.sourceBytes || 0), 0);
  const outputBytes = records.reduce((total, record) => total + Number(record.outputBytes || 0), 0);
  const completed = records.filter((record) => record.status === 'completed');
  const sourceLargest = records.reduce((largest, record) => record.sourceBytes > (largest?.sourceBytes || 0) ? record : largest, null);
  const outputLargest = completed.reduce((largest, record) => record.outputBytes > (largest?.outputBytes || 0) ? record : largest, null);
  const lines = [
    'Ashley Wilde image preparation report',
    `Generated: ${new Date().toISOString()}`,
    `Input: ${inputRoot}`,
    `Output: ${outputRoot}`,
    `Settings: ${SETTINGS_VERSION}`,
    `Duration: ${((Date.now() - startedAt) / 1000).toFixed(1)} seconds`,
    '',
    `Total source files: ${records.length}`,
    `Total source folder size: ${formatBytes(sourceBytes)}`,
    `Completed outputs: ${completed.length}`,
    `Total output folder size: ${formatBytes(outputBytes)}`,
    `Total bytes saved: ${formatBytes(Math.max(0, sourceBytes - outputBytes))}`,
    `Percentage size reduction: ${formatPercent(sourceBytes ? ((sourceBytes - outputBytes) / sourceBytes) * 100 : 0)}`,
    `Largest source file: ${sourceLargest ? `${sourceLargest.relativeSourcePath} (${formatBytes(sourceLargest.sourceBytes)})` : 'n/a'}`,
    `Largest prepared output: ${outputLargest ? `${outputLargest.canonicalOutputFilename} (${formatBytes(outputLargest.outputBytes)})` : 'n/a'}`,
    `Files above 20 MiB after processing: ${records.filter((record) => Number(record.outputBytes || 0) >= ABSOLUTE_OUTPUT_BYTES).length}`,
    '',
  ];
  const sections = [
    ['Unsupported files', records.filter((record) => record.status === 'unsupported')],
    ['Corrupt files', records.filter((record) => record.status === 'corrupt')],
    ['Naming conflicts', records.filter((record) => record.status === 'name_conflict')],
    ['Files requiring review', records.filter((record) => record.status === 'needs_review')],
  ];
  for (const [title, items] of sections) {
    lines.push(`${title}: ${items.length}`);
    for (const item of items.slice(0, 100)) lines.push(`- ${item.relativeSourcePath}: ${item.error || item.reviewReason || 'review required'}`);
    if (items.length > 100) lines.push(`- ... ${items.length - 100} more`);
    lines.push('');
  }
  return lines.join('\n');
}

async function persistState(outputRoot, manifest) {
  await writeJsonAtomic(path.join(outputRoot, 'ashley-wilde-preparation-manifest.json'), manifest);
}

async function inspectInput(inputRoot) {
  const sourceFiles = await walkFiles(inputRoot);
  const records = [];
  for (const filePath of sourceFiles) {
    const record = await inspectSource(filePath, inputRoot);
    if (record) records.push(record);
  }
  return records;
}

function applyCollisions(records) {
  for (const group of collisionGroups(records).values()) {
    if (group.length < 2) continue;
    const fingerprints = new Set(group.map((record) => record.sourceFingerprint));
    if (fingerprints.size === 1) {
      group.slice(1).forEach((record) => {
        record.status = 'duplicate_source';
        record.error = `Byte-identical source; prepared once as ${group[0].relativeSourcePath}.`;
      });
    } else {
      group.forEach((record) => {
        record.status = 'name_conflict';
        record.error = `Different source content maps to ${record.canonicalOutputFilename}; no output was selected automatically.`;
      });
    }
  }
}

async function prepareRecords(records, options, inputRoot, outputRoot) {
  const manifest = await readManifest(outputRoot);
  manifest.settings = SETTINGS;
  const previousByPath = new Map((manifest.records || []).map((record) => [record.relativeSourcePath, record]));
  manifest.records = records.map((record) => {
    const previous = previousByPath.get(record.relativeSourcePath);
    return sourceToManifest(record, previous && previous.sourceFingerprint === record.sourceFingerprint ? {
      outputBytes: previous.outputBytes,
      outputWidth: previous.outputWidth,
      outputHeight: previous.outputHeight,
      finalJpegQuality: previous.finalJpegQuality,
      finalDimensionLimit: previous.finalDimensionLimit,
      status: ['completed', 'skipped_unchanged'].includes(previous.status) ? 'pending_resume_check' : record.status,
    } : {});
  });
  await persistState(outputRoot, manifest);
  const byPath = new Map(manifest.records.map((record, index) => [record.relativeSourcePath, { record, source: records[index] }]));
  let completed = 0;
  let skipped = 0;
  let failed = 0;
  const total = records.length;
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= total) return;
      const source = records[index];
      const record = manifest.records[index];
      if (source.status === 'duplicate_source' || source.status === 'name_conflict' || source.status === 'unsupported' || source.status === 'corrupt') {
        if (source.status !== 'duplicate_source') await fs.rm(path.join(outputRoot, source.canonicalOutputFilename), { force: true }).catch(() => undefined);
        record.status = source.status;
        record.error = source.error;
        record.processingTimestamp = new Date().toISOString();
        progressLine(index + 1, total, record, record.status, '', { skipped, failed });
        continue;
      }
      const previous = previousByPath.get(record.relativeSourcePath);
      const resume = await recordForResume(previous, source, outputRoot);
      if (resume) {
        Object.assign(record, resume, { status: 'skipped_unchanged', processingTimestamp: new Date().toISOString() });
        skipped += 1;
        progressLine(index + 1, total, record, 'skipped_unchanged', formatBytes(record.outputBytes), { skipped, failed });
        await persistState(outputRoot, manifest);
        continue;
      }
      try {
        await fs.rm(path.join(outputRoot, source.canonicalOutputFilename), { force: true });
        const result = await prepareImage(source, outputRoot);
        Object.assign(record, result, { processingTimestamp: new Date().toISOString() });
        if (result.status === 'completed') completed += 1;
        else if (result.status === 'needs_review') failed += 1;
        progressLine(index + 1, total, record, result.status, result.outputBytes ? formatBytes(result.outputBytes) : '', { skipped, failed });
      } catch (error) {
        Object.assign(record, { status: 'failed', error: safeError(error), processingTimestamp: new Date().toISOString() });
        failed += 1;
        progressLine(index + 1, total, record, 'failed', '', { skipped, failed });
      }
      await persistState(outputRoot, manifest);
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, Math.max(1, total)) }, () => worker()));
  manifest.records = manifest.records.map((record) => {
    if (record.status === 'pending_resume_check') return { ...record, status: 'failed', error: 'Preparation did not complete; rerun to retry.' };
    return record;
  });
  await persistState(outputRoot, manifest);
  const report = await buildReport(manifest.records, inputRoot, outputRoot, options.startedAt);
  await fs.writeFile(path.join(outputRoot, 'ashley-wilde-preparation-report.txt'), report, 'utf8');
  return { manifest, completed, skipped, failed, report };
}

function printSummary(manifest, outputRoot) {
  const counts = manifest.records.reduce((result, record) => {
    result[record.status] = (result[record.status] || 0) + 1;
    return result;
  }, {});
  console.log('\nAshley Wilde preparation complete');
  console.log(`Records: ${manifest.records.length}`);
  console.log(Object.entries(counts).map(([status, count]) => `${status}: ${count}`).join(' | '));
  console.log(`Manifest: ${path.join(outputRoot, 'ashley-wilde-preparation-manifest.json')}`);
}

async function validateOutput(outputRoot) {
  const manifestPath = path.join(outputRoot, 'ashley-wilde-preparation-manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const errors = [];
  if (manifest.settings?.settingsVersion !== SETTINGS_VERSION) errors.push('Manifest processing settings version is not current.');
  const outputFiles = (await walkFiles(outputRoot, { includeHidden: true })).filter((filePath) => !['ashley-wilde-preparation-manifest.json', 'ashley-wilde-preparation-report.txt'].includes(path.basename(filePath)));
  const seenNames = new Set();
  const outputRecords = new Map();
  for (const filePath of outputFiles) {
    const name = path.basename(filePath);
    if (name.includes('.ashley-wilde-tmp-') || name.includes('.tmp-')) errors.push(`Temporary file remains: ${name}`);
    if (extensionOf(filePath) !== '.jpg') {
      if (isSupported(filePath) || isImageLike(filePath)) errors.push(`Unsupported output format: ${name}`);
      continue;
    }
    const lower = name.toLowerCase();
    if (seenNames.has(lower)) errors.push(`Duplicate output name: ${name}`);
    seenNames.add(lower);
    const stat = await fs.stat(filePath);
    if (stat.size >= ABSOLUTE_OUTPUT_BYTES) errors.push(`${name} is ${formatBytes(stat.size)}, at or above the 20 MiB absolute limit.`);
    try {
      const metadata = await sharp(filePath).metadata();
      if (!metadata.width || !metadata.height || metadata.width > 4000 || metadata.height > 4000) errors.push(`Dimensions are not sensible: ${name}`);
      outputRecords.set(name.toLowerCase(), { bytes: stat.size, width: metadata.width, height: metadata.height });
    } catch (error) {
      errors.push(`Cannot decode ${name}: ${safeError(error)}`);
    }
  }
  const completed = new Set();
  for (const record of manifest.records || []) {
    if (record.status === 'completed' || record.status === 'skipped_unchanged') {
      const key = String(record.canonicalOutputFilename || '').toLowerCase();
      completed.add(key);
      const output = outputRecords.get(key);
      if (!output) errors.push(`Manifest output is missing: ${record.canonicalOutputFilename}`);
      else if (record.outputBytes && record.outputBytes !== output.bytes) errors.push(`Manifest size mismatch: ${record.canonicalOutputFilename}`);
    }
  }
  for (const key of outputRecords.keys()) if (!completed.has(key)) errors.push(`Untracked output file: ${key}`);
  console.log(`Validated ${outputRecords.size} JPEG output(s) in ${outputRoot}.`);
  if (errors.length) {
    console.error(`Validation failed with ${errors.length} issue(s):`);
    errors.slice(0, 100).forEach((error) => console.error(`- ${error}`));
    return false;
  }
  console.log('Validation passed.');
  return true;
}

export async function run(options) {
  const outputRoot = path.resolve(options.output);
  if (options.validateOutput) return validateOutput(outputRoot);
  const inputRoot = path.resolve(options.input);
  if (isWithin(outputRoot, inputRoot)) throw new Error('The output folder must be separate from, not inside, the source folder.');
  const inputStat = await fs.stat(inputRoot);
  if (!inputStat.isDirectory()) throw new Error(`Input is not a folder: ${inputRoot}`);
  if (!options.dryRun) await fs.mkdir(outputRoot, { recursive: true });
  const records = await inspectInput(inputRoot);
  applyCollisions(records);
  if (options.dryRun) {
    console.log(`Dry run: ${records.length} candidate record(s) found in ${inputRoot}.`);
    records.forEach((record, index) => progressLine(index + 1, records.length, record, record.status === 'pending' ? 'would_process' : record.status));
    return true;
  }
  const result = await prepareRecords(records, { ...options, startedAt: Date.now() }, inputRoot, outputRoot);
  printSummary(result.manifest, outputRoot);
  return result.failed === 0 && result.manifest.records.every((record) => !['failed', 'needs_review', 'name_conflict', 'corrupt'].includes(record.status));
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(usage());
    else {
      const success = await run(options);
      process.exitCode = success ? 0 : 1;
    }
  } catch (error) {
    console.error(`Error: ${safeError(error)}\n\n${usage()}`);
    process.exitCode = 1;
  }
}
