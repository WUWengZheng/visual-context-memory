import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listSourceFiles } from '../../scripts/package-skill.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-setup-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, destination: path.join(dir, "skills with spaces & 'quote'", 'visual-context-memory'),
    dbPath: path.join(dir, 'private data', 'memory.db') };
}
function setup(args) {
  return spawnSync(process.execPath, ['scripts/setup.mjs', ...args], { cwd: root, encoding: 'utf8' });
}

test('setup installs a source-only Skill without creating a database and refuses to overwrite it', (t) => {
  const c = fixture(t);
  const result = setup(['--dest', c.destination, '--db', c.dbPath, '--skip-deps']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(c.destination, 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(c.destination, 'scripts/vcm.mjs')));
  assert.ok(!fs.existsSync(c.dbPath));
  assert.ok(!fs.existsSync(path.join(c.destination, '.visual-context-memory')));
  const config = JSON.parse(fs.readFileSync(path.join(c.destination, 'vcm-install.json'), 'utf8'));
  assert.equal(config.dbPath, c.dbPath);
  assert.equal(config.port, 4173);
  const before = fs.readFileSync(path.join(c.destination, 'SKILL.md'));
  const again = setup(['--dest', c.destination, '--db', c.dbPath]);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /INSTALL_EXISTS/);
  assert.deepEqual(fs.readFileSync(path.join(c.destination, 'SKILL.md')), before);
});

test('setup validates options before creating files and never accepts a database inside the installation', (t) => {
  const c = fixture(t);
  for (const extra of [['--port', 'bad'], ['--port', '65536'], ['--unknown'], ['--db']]) {
    const result = setup(['--dest', c.destination, ...extra]);
    assert.notEqual(result.status, 0);
    assert.ok(!fs.existsSync(c.destination));
  }
  const badData = setup(['--dest', c.destination, '--db', path.join(c.destination, 'memory.db'), '--skip-deps']);
  assert.notEqual(badData.status, 0);
  assert.match(badData.stderr, /DATA_IN_INSTALL/);
  const insideSource = setup(['--dest', path.join(root, 'src', 'bad-install'), '--skip-deps']);
  assert.match(insideSource.stderr, /INSTALL_IN_SOURCE/);
});

test('doctor is read-only, reports missing dependencies and rejects corrupt install configuration', (t) => {
  const c = fixture(t);
  assert.equal(setup(['--dest', c.destination, '--db', c.dbPath, '--skip-deps']).status, 0);
  const doctor = () => spawnSync(process.execPath, [path.join(c.destination, 'scripts/vcm.mjs'), 'doctor'],
    { cwd: c.dir, encoding: 'utf8' });
  const missing = doctor();
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /npm ci --ignore-scripts/);
  assert.ok(!fs.existsSync(c.dbPath));
  fs.writeFileSync(path.join(c.destination, 'vcm-install.json'), '{broken');
  assert.notEqual(doctor().status, 0);
  assert.ok(!fs.existsSync(c.dbPath));
});

test('actual dependency installation, doctor and launcher work from an unrelated cwd with private data preserved', async (t) => {
  const c = fixture(t);
  fs.mkdirSync(path.dirname(c.dbPath), { recursive: true });
  // An untouched sibling sentinel demonstrates setup does not recursively replace data folders.
  fs.writeFileSync(path.join(path.dirname(c.dbPath), 'keep.txt'), 'PRIVATE_DEMO_SENTINEL');
  const installed = setup(['--dest', c.destination, '--db', c.dbPath, '--port', '0']);
  assert.equal(installed.status, 0, installed.stderr + installed.stdout);
  const launcher = path.join(c.destination, 'scripts/vcm.mjs');
  const doctor = spawnSync(process.execPath, [launcher, 'doctor'], { cwd: c.dir, encoding: 'utf8' });
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /READY/);
  const clickable = spawnSync('bash', [path.join(c.destination, 'Check Setup.command')],
    { cwd: c.dir, encoding: 'utf8', input: '' });
  assert.equal(clickable.status, 0, clickable.stderr);
  assert.match(clickable.stdout, /READY/);
  assert.ok(!fs.existsSync(c.dbPath));
  const child = spawn(process.execPath, [launcher, 'start'], { cwd: c.dir, stdio: ['ignore', 'pipe', 'pipe'] });
  const stopped = new Promise((resolve) => child.once('exit', resolve));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await stopped; });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Launcher readiness timeout')), 10000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Launcher exited ${code}`)); });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/u);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  assert.equal((await (await fetch(url + '/api/health')).json()).status, 'ok');
  assert.deepEqual(await (await fetch(url + '/api/projects')).json(), []);
  assert.equal((await fetch(url + '/viewer/vendor/cytoscape.esm.min.mjs')).status, 200);
  const configPath = path.join(c.destination, 'vcm-install.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.port = Number(new URL(url).port);
  fs.writeFileSync(configPath, JSON.stringify(config));
  const occupied = spawnSync(process.execPath, [launcher, 'start'], { cwd: c.dir, encoding: 'utf8', timeout: 10000 });
  assert.notEqual(occupied.status, 0);
  assert.match(occupied.stderr, /EADDRINUSE|address already in use/);
  assert.equal((await (await fetch(url + '/api/health')).json()).status, 'ok');
  assert.ok(fs.existsSync(c.dbPath));
  assert.ok(!fs.existsSync(path.join(c.dir, '.visual-context-memory')));
  assert.equal(fs.readFileSync(path.join(path.dirname(c.dbPath), 'keep.txt'), 'utf8'), 'PRIVATE_DEMO_SENTINEL');
  child.kill('SIGTERM');
  await stopped;
});

test('an existing source database is reused by path, not copied, opened or moved by setup', (t) => {
  const c = fixture(t);
  const source = path.join(c.dir, 'downloaded source');
  for (const relative of listSourceFiles(root)) {
    fs.mkdirSync(path.dirname(path.join(source, relative)), { recursive: true });
    fs.copyFileSync(path.join(root, relative), path.join(source, relative));
  }
  const legacyDb = path.join(source, '.visual-context-memory', 'memory.db');
  fs.mkdirSync(path.dirname(legacyDb), { recursive: true });
  const sentinel = Buffer.from('PRIVATE_DEMO_DATABASE_SENTINEL_NOT_SQLITE');
  fs.writeFileSync(legacyDb, sentinel);
  // macOS /var and /private/var aliases must not bypass the source-folder guard.
  const inside = path.join(source, 'src', 'nested-install');
  const refused = spawnSync(process.execPath, [path.join(source, 'scripts/setup.mjs'),
    '--dest', inside, '--skip-deps'], { cwd: c.dir, encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /INSTALL_IN_SOURCE/);
  assert.ok(!fs.existsSync(inside));
  const result = spawnSync(process.execPath, [path.join(source, 'scripts/setup.mjs'),
    '--dest', c.destination, '--skip-deps'], { cwd: c.dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(c.destination, 'vcm-install.json'), 'utf8'));
  assert.equal(fs.realpathSync(config.dbPath), fs.realpathSync(legacyDb));
  assert.deepEqual(fs.readFileSync(legacyDb), sentinel);
  assert.ok(!fs.existsSync(path.join(c.destination, '.visual-context-memory')));
  assert.match(result.stdout, /Existing source database reused/);
});

test('dependency failure is explicit and leaves installation/data available for manual repair, without blind retry', (t) => {
  const c = fixture(t);
  const fakeBin = path.join(c.dir, 'fake npm boundary');
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, 'npm'), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 11; exit 0; fi\nexit 23\n', { mode: 0o755 });
  const result = spawnSync(process.execPath, ['scripts/setup.mjs', '--dest', c.destination, '--db', c.dbPath],
    { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: fakeBin } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DEPENDENCIES_FAILED/);
  assert.ok(fs.existsSync(path.join(c.destination, 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(c.destination, 'vcm-install.json')));
  assert.ok(!fs.existsSync(c.dbPath));
  assert.match(setup(['--dest', c.destination, '--db', c.dbPath]).stderr, /INSTALL_EXISTS/);
});

test('clickable installer forwards explicit paths and preserves failure exit status without touching default installation', (t) => {
  const c = fixture(t);
  const args = [path.join(root, 'Install.command'), '--dest', c.destination, '--db', c.dbPath, '--skip-deps'];
  const first = spawnSync('bash', args, { cwd: c.dir, encoding: 'utf8', input: '' });
  assert.equal(first.status, 0, first.stderr);
  const second = spawnSync('bash', args, { cwd: c.dir, encoding: 'utf8', input: '' });
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /INSTALL_EXISTS/);
});
