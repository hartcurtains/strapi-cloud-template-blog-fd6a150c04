'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { promises: fs } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { test } = require('node:test');

let tool;

async function fixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ashley-wilde-preparation-test-'));
  return { root, input: path.join(root, 'input'), output: path.join(root, 'output') };
}

async function writeFixture(filePath, options = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const image = sharp({
    create: {
      width: options.width || 320,
      height: options.height || 200,
      channels: 3,
      background: options.background || { r: 145, g: 118, b: 92 },
    },
  });
  let pipeline = image;
  if (options.orientation) pipeline = pipeline.withMetadata({ orientation: options.orientation });
  await pipeline.toFormat(options.format || path.extname(filePath).slice(1) || 'jpeg', { quality: options.quality || 95 }).toFile(filePath);
}

async function writeNoiseJpeg(filePath, width, height) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const pixels = crypto.randomBytes(width * height * 3);
  await sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 100, progressive: true, chromaSubsampling: '4:4:4' })
    .toFile(filePath);
}

async function readManifest(output) {
  return JSON.parse(await fs.readFile(path.join(output, 'ashley-wilde-preparation-manifest.json'), 'utf8'));
}

async function removeTree(root) {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}

test.before(async () => {
  tool = await import('../scripts/prepare-ashley-wilde-images.mjs');
});

test('prepares TIFF/JPEG inputs without changing originals and preserves exact stems', async () => {
  const { root, input, output } = await fixtureRoot();
  try {
    const source = path.join(input, 'AUSTENLI.tif');
    await writeFixture(source, { format: 'tiff', width: 5000, height: 3500 });
    const original = await fs.readFile(source);
    assert.equal(await tool.run({ input, output, concurrency: 1 }), true);
    assert.deepEqual(await fs.readFile(source), original);
    const prepared = await sharp(path.join(output, 'AUSTENLI.jpg')).metadata();
    assert.equal(prepared.format, 'jpeg');
    assert.equal(prepared.space, 'srgb');
    assert.ok(Math.max(prepared.width, prepared.height) <= 4000);
    const manifest = await readManifest(output);
    assert.equal(manifest.records[0].canonicalOutputFilename, 'AUSTENLI.jpg');
    assert.equal(manifest.records[0].status, 'completed');
    assert.ok(await fs.stat(path.join(output, 'ashley-wilde-preparation-report.txt')));
  } finally { await removeTree(root); }
});

test('applies EXIF orientation, preserves aspect ratio, does not crop, and never upscales', async () => {
  const { root, input, output } = await fixtureRoot();
  try {
    await writeFixture(path.join(input, 'ORIENT.jpg'), { format: 'jpeg', width: 120, height: 80, orientation: 6 });
    await writeFixture(path.join(input, 'SMALL.png'), { format: 'png', width: 60, height: 40 });
    assert.equal(await tool.run({ input, output, concurrency: 1 }), true);
    const oriented = await sharp(path.join(output, 'ORIENT.jpg')).metadata();
    assert.equal(oriented.width, 80);
    assert.equal(oriented.height, 120);
    assert.equal(oriented.orientation, undefined);
    assert.equal(oriented.width / oriented.height, 80 / 120);
    const small = await sharp(path.join(output, 'SMALL.jpg')).metadata();
    assert.equal(small.width, 60);
    assert.equal(small.height, 40);
  } finally { await removeTree(root); }
});

test('large JPEGs use bounded dimensions and iterative JPEG compression below 20 MiB', async () => {
  const { root, input, output } = await fixtureRoot();
  try {
    await writeNoiseJpeg(path.join(input, 'LARGE.jpg'), 4500, 3200);
    assert.equal(await tool.run({ input, output, concurrency: 1 }), true);
    const manifest = await readManifest(output);
    const record = manifest.records[0];
    assert.equal(record.status, 'completed');
    assert.ok(record.outputBytes < 20 * 1024 * 1024);
    assert.ok(record.outputBytes <= 18 * 1024 * 1024);
    assert.ok(record.finalJpegQuality >= 74);
    assert.ok(record.finalDimensionLimit >= 2500 && record.finalDimensionLimit <= 4000);
    const metadata = await sharp(path.join(output, 'LARGE.jpg')).metadata();
    assert.ok(Math.max(metadata.width, metadata.height) <= 4000);
  } finally { await removeTree(root); }
});

test('blocks different-content output collisions and records byte-identical duplicates safely', async () => {
  const conflict = await fixtureRoot();
  try {
    await writeFixture(path.join(conflict.input, 'AUSTENLI.tif'), { format: 'tiff', background: { r: 10, g: 20, b: 30 } });
    await writeFixture(path.join(conflict.input, 'AUSTENLI.png'), { format: 'png', background: { r: 220, g: 210, b: 200 } });
    assert.equal(await tool.run({ input: conflict.input, output: conflict.output, concurrency: 1 }), false);
    const conflictManifest = await readManifest(conflict.output);
    assert.ok(conflictManifest.records.every((record) => record.status === 'name_conflict'));
    await assert.rejects(() => fs.stat(path.join(conflict.output, 'AUSTENLI.jpg')));
  } finally { await removeTree(conflict.root); }

  const duplicate = await fixtureRoot();
  try {
    const source = path.join(duplicate.input, 'DUPLICATE.jpg');
    await writeFixture(source, { format: 'jpeg' });
    await fs.copyFile(source, path.join(duplicate.input, 'DUPLICATE.jpeg'));
    assert.equal(await tool.run({ input: duplicate.input, output: duplicate.output, concurrency: 1 }), true);
    const records = (await readManifest(duplicate.output)).records;
    assert.equal(records.filter((record) => record.status === 'completed').length, 1);
    assert.equal(records.filter((record) => record.status === 'duplicate_source').length, 1);
  } finally { await removeTree(duplicate.root); }
});

test('continues after corrupt files and resumes unchanged output without recompressing it', async () => {
  const { root, input, output } = await fixtureRoot();
  try {
    await fs.mkdir(input, { recursive: true });
    await fs.writeFile(path.join(input, 'BROKEN.jpg'), Buffer.from('not-an-image'));
    await writeFixture(path.join(input, 'VALID.webp'), { format: 'webp' });
    assert.equal(await tool.run({ input, output, concurrency: 1 }), false);
    const first = await readManifest(output);
    assert.equal(first.records.find((record) => record.sourceFilename === 'BROKEN.jpg').status, 'corrupt');
    assert.equal(first.records.find((record) => record.sourceFilename === 'VALID.webp').status, 'completed');
    const outputStat = await fs.stat(path.join(output, 'VALID.jpg'));
    assert.equal(await tool.run({ input, output, concurrency: 1 }), false);
    const second = await readManifest(output);
    assert.equal(second.records.find((record) => record.sourceFilename === 'VALID.webp').status, 'skipped_unchanged');
    assert.equal((await fs.stat(path.join(output, 'VALID.jpg'))).size, outputStat.size);
    second.records.find((record) => record.sourceFilename === 'VALID.webp').processingSettingsVersion = 'old-settings';
    await fs.writeFile(path.join(output, 'ashley-wilde-preparation-manifest.json'), `${JSON.stringify(second, null, 2)}\n`);
    assert.equal(await tool.run({ input, output, concurrency: 1 }), false);
    const third = await readManifest(output);
    assert.equal(third.records.find((record) => record.sourceFilename === 'VALID.webp').status, 'completed');
  } finally { await removeTree(root); }
});

test('dry-run writes no images and validation rejects oversized or untracked output', async () => {
  const { root, input, output } = await fixtureRoot();
  try {
    await writeFixture(path.join(input, 'DRYRUN.jpg'), { format: 'jpeg' });
    assert.equal(await tool.run({ input, output, concurrency: 1, dryRun: true }), true);
    await assert.rejects(() => fs.stat(output));
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'ashley-wilde-preparation-manifest.json'), JSON.stringify({ settings: { settingsVersion: tool.SETTINGS_VERSION }, records: [] }));
    await fs.writeFile(path.join(output, 'UNTRACKED.jpg'), Buffer.alloc(20 * 1024 * 1024));
    assert.equal(await tool.run({ output, validateOutput: true }), false);
  } finally { await removeTree(root); }
});
