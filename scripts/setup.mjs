// Explicit local installation only. No database copy, overwrite, background service or global config edits.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { listSourceFiles } from './package-skill.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
function physicalPath(value) {
  let existing = path.resolve(value);
  const suffix = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error('INVALID_PATH: no accessible parent directory');
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(fs.realpathSync(existing), ...suffix);
}
const help = `Visual Context Memory setup (Node 24+)
  node scripts/setup.mjs [--dest ABSOLUTE_FOLDER] [--db DATABASE_PATH] [--port 4173]
  --skip-deps  Advanced: copy only; not ready until npm ci --ignore-scripts succeeds.
Default: ~/.agents/skills/visual-context-memory. Existing folders are never overwritten.
Requires network only for the locked npm dependency install. No database is created by setup.`;

try {
  const options = {};
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log(help); process.exit(0); }
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('NODE_REQUIRED: install Node.js 24+ from https://nodejs.org');
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === '--skip-deps') { options.skipDeps = true; continue; }
    if (!['--dest', '--db', '--port'].includes(key) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error(`INVALID_OPTION: ${key}. Use --help`);
    }
    if (Object.hasOwn(options, key)) throw new Error(`INVALID_OPTION: duplicate ${key}`);
    options[key] = args[++index];
  }
  const destination = physicalPath(options['--dest'] ?? path.join(os.homedir(), '.agents', 'skills', 'visual-context-memory'));
  if (destination === root.replace(/[\\/]$/u, '') || destination.startsWith(root)) {
    throw new Error('INSTALL_IN_SOURCE: choose an installation outside the source application');
  }
  const port = Number(options['--port'] ?? 4173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('INVALID_PORT: use 0–65535');
  if (fs.existsSync(destination)) throw new Error(`INSTALL_EXISTS: ${destination}. Nothing overwritten. Review/backup an existing install separately.`);
  if (!options['--dest'] && fs.existsSync(path.join(os.homedir(), '.codex', 'skills', 'visual-context-memory'))) {
    throw new Error('LEGACY_INSTALL_EXISTS: review the old ~/.codex/skills install first; refusing duplicate installation');
  }
  const legacyDb = path.join(root, '.visual-context-memory', 'memory.db');
  const reuseLegacy = !options['--db'] && fs.existsSync(legacyDb);
  const dbPath = path.resolve(options['--db'] ?? (reuseLegacy ? legacyDb
    : path.join(os.homedir(), '.local', 'share', 'visual-context-memory', 'memory.db')));
  const physicalDb = physicalPath(dbPath);
  if (physicalDb === destination || physicalDb.startsWith(destination + path.sep)) {
    throw new Error('DATA_IN_INSTALL: choose a database outside the replaceable Skill folder');
  }
  const entries = listSourceFiles(); // Validate before creating any installation folder.
  if (!options.skipDeps) {
    const npm = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'],
      { encoding: 'utf8', shell: process.platform === 'win32', timeout: 10000 });
    if (npm.status !== 0) throw new Error('NPM_REQUIRED: npm must be on PATH; install Node.js 24+ with npm');
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.mkdirSync(destination); // Exclusive creation; no overwrite, even if another install raced us.
  for (const relative of entries) {
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, relative), target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, relative.endsWith('.command') ? 0o755 : 0o644);
  }
  fs.writeFileSync(path.join(destination, 'vcm-install.json'), JSON.stringify({
    schemaVersion: 1, dbPath, port,
  }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const launcher = path.join(destination, 'scripts', 'vcm.mjs');
  for (const [file, command] of [['Start Viewer.command', 'start --open'], ['Check Setup.command', 'doctor']]) {
    fs.writeFileSync(path.join(destination, file),
      `#!/bin/bash\n${quote(process.execPath)} ${quote(launcher)} ${command}\nvcm_status=$?\necho 'Press Enter to close.'\nread -r || true\nexit "$vcm_status"\n`,
      { flag: 'wx', mode: 0o755 });
  }
  fs.writeFileSync(path.join(destination, 'Check Setup.cmd'), '@echo off\r\ncd /d "%~dp0"\r\nnode scripts\\vcm.mjs doctor\r\npause\r\n', { flag: 'wx' });
  // %~dp0 resolves the script directory without inserting arbitrary paths in a batch command.
  fs.writeFileSync(path.join(destination, 'Start Viewer.cmd'), '@echo off\r\ncd /d "%~dp0"\r\nnode scripts\\vcm.mjs start --open\r\npause\r\n', { flag: 'wx' });
  console.log(`Installed files: ${destination}\nDatabase: ${dbPath} (not copied or modified)`);
  if (reuseLegacy) console.log('Existing source database reused at its original path; retain that file/directory. No migration or duplicate database.');
  if (options.skipDeps) console.log('Dependencies skipped: run npm ci --ignore-scripts in the installed folder before use.');
  else {
    console.log('Installing locked dependencies (lifecycle scripts disabled)…');
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: destination, stdio: 'inherit', shell: process.platform === 'win32', timeout: 120000 });
    if (result.status !== 0) throw new Error(`DEPENDENCIES_FAILED: files preserved at ${destination}. Run npm ci --ignore-scripts there, then node scripts/vcm.mjs doctor. Setup will not overwrite/retry automatically.`);
    const checked = spawnSync(process.execPath, [launcher, 'doctor'], { cwd: destination, stdio: 'inherit' });
    if (checked.status !== 0) throw new Error('READINESS_FAILED: installed files preserved; review Check Setup before launching');
  }
  console.log(`Next: ${process.platform === 'win32' ? 'Start Viewer.cmd' : 'Start Viewer.command'} in the installed folder, or:\n  ${quote(process.execPath)} ${quote(launcher)} start --open\nCodex: $visual-context-memory. If not discovered, restart Codex.\nStop Viewer with Ctrl+C. No auto-start service was installed.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
