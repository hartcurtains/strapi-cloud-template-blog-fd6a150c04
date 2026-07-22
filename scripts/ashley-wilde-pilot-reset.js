'use strict';

const fs = require('node:fs');
const path = require('node:path');

function pilotTargets(rootDir = path.resolve(__dirname, '..')) {
  const root = path.resolve(rootDir);
  const tmp = path.join(root, '.tmp');
  return [
    path.join(tmp, 'ashley-wilde-pilot.db'),
    path.join(tmp, 'ashley-wilde-pilot-uploads'),
    path.join(tmp, 'ashley-wilde-pilot-reports'),
    path.join(tmp, 'ashley-wilde-pilot-images'),
  ];
}

function assertPilotTarget(target, rootDir) {
  const root = path.resolve(rootDir);
  const tmp = path.join(root, '.tmp') + path.sep;
  const resolved = path.resolve(target);
  if (!resolved.startsWith(tmp) || path.basename(resolved) === 'data.db') throw new Error(`Refusing to delete non-pilot path: ${resolved}`);
}

async function resetPilotArtifacts(options = {}) {
  const rootDir = path.resolve(options.rootDir || path.resolve(__dirname, '..'));
  const targets = pilotTargets(rootDir);
  if (!options.confirm) return { confirmed: false, targets };
  for (const target of targets) {
    assertPilotTarget(target, rootDir);
    await fs.promises.rm(target, { recursive: true, force: true });
  }
  return { confirmed: true, targets };
}

if (require.main === module) {
  resetPilotArtifacts({ confirm: process.argv.includes('--confirm') })
    .then((result) => {
      if (!result.confirmed) {
        console.log('Nothing deleted. Re-run with --confirm to remove only the isolated Ashley Wilde pilot artifacts.');
        return;
      }
      console.log(JSON.stringify({ reset: true, targets: result.targets }, null, 2));
    })
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { pilotTargets, resetPilotArtifacts };
