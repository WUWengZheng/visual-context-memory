import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { packageSkill } from '../../scripts/package-skill.mjs';

test('Skill archive includes lockfile/runtime and excludes private databases, node_modules and reports', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-archive-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const archive = path.join(directory, 'preview.tar.gz');
  packageSkill(archive);
  const result = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const files = result.stdout.trim().split('\n');
  for (const file of ['LICENSE', 'SKILL.md', 'package-lock.json', 'src/server/main.mjs', 'viewer/app.mjs', 'references/memory-editor.md',
    'references/recall-and-export.md', 'src/services/recall-service.mjs', 'src/services/markdown-export.mjs', 'viewer/export-controller.mjs',
    'references/reply-memory-report.md', 'src/client/reply-memory-session.mjs',
    'references/open-source-recall-patterns.md', 'scripts/evaluate-recall.mjs',
    'Install.command', 'Install.cmd', 'scripts/setup.mjs', 'scripts/vcm.mjs']) {
    assert.ok(files.includes(`visual-context-memory/${file}`));
  }
  const license = spawnSync('tar', ['-xOf', archive, 'visual-context-memory/LICENSE'], { encoding: 'utf8' });
  assert.equal(license.status, 0);
  assert.equal(license.stdout, fs.readFileSync(new URL('../../LICENSE', import.meta.url), 'utf8'));
  assert.ok(!files.some((file) => /node_modules|\.db(?:-|$)|\.visual-context-memory|phase7-test-output|phase7-report/.test(file)));
  assert.throws(() => packageSkill(archive), /overwrite/);
  const repeated = path.join(directory, 'repeated.tar.gz');
  packageSkill(repeated);
  const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(fs.readFileSync(archive).readUInt32LE(4), 0, 'gzip header must not include wall-clock time');
  assert.equal(hash(archive), hash(repeated));
});

test('source-only ZIP unpacks executable installer and installs without private data', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-zip-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const archive = path.join(directory, 'preview.zip');
  packageSkill(archive);
  const unpack = spawnSync('unzip', ['-q', archive, '-d', directory], { encoding: 'utf8' });
  assert.equal(unpack.status, 0, unpack.stderr);
  const source = path.join(directory, 'visual-context-memory');
  assert.ok(fs.statSync(path.join(source, 'Install.command')).mode & 0o100);
  assert.ok(!fs.existsSync(path.join(source, 'vcm-install.json')));
  assert.ok(!fs.existsSync(path.join(source, '.visual-context-memory')));
  const destination = path.join(directory, 'installed Skill');
  const install = spawnSync(process.execPath, [path.join(source, 'scripts/setup.mjs'),
    '--dest', destination, '--db', path.join(directory, 'private', 'demo.db'), '--skip-deps'], { encoding: 'utf8' });
  assert.equal(install.status, 0, install.stderr);
  assert.ok(fs.existsSync(path.join(destination, 'SKILL.md')));
  assert.throws(() => packageSkill(archive), /overwrite/);
});
