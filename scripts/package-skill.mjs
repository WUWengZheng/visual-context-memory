// Source-only preview archive. Does not publish, install globally, or read databases.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
export const rootFiles = ['LICENSE', 'SKILL.md', 'README.md', 'package.json', 'package-lock.json', '.gitignore',
  'Install.command', 'Install.cmd'];
export const referenceFiles = ['http-api.md', 'memory-editor.md', 'memory-schema.md', 'memory-lifecycle.md',
  'conflict-rules.md', 'relation-types.md', 'schema-deviations.md', 'context-selection.md', 'release-readiness.md',
  'recall-and-export.md', 'reply-memory-report.md', 'open-source-recall-patterns.md'];
const sourceDirectories = { src: ['.mjs', '.sql'], viewer: ['.mjs', '.css', '.html'], scripts: ['.mjs'], tests: ['.mjs'] };

export function listSourceFiles(base = root) {
  const entries = [...rootFiles, ...referenceFiles.map((file) => path.join('references', file))];
  function walk(relative, extensions) {
    for (const entry of fs.readdirSync(path.join(base, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlink not allowed in release sources: ${name}`);
      if (entry.isDirectory()) walk(name, extensions);
      else if (entry.isFile() && extensions.includes(path.extname(name))) entries.push(name);
    }
  }
  for (const [directory, extensions] of Object.entries(sourceDirectories)) walk(directory, extensions);
  for (const name of entries) {
    if (!fs.lstatSync(path.join(base, name)).isFile()) throw new Error(`Expected regular source file: ${name}`);
  }
  return entries.sort();
}

export function packageSkill(output) {
  const target = path.resolve(output);
  if (fs.existsSync(target)) throw new Error('Refusing to overwrite an existing archive');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-preview-package-'));
  const destination = path.join(stage, 'visual-context-memory');
  const entries = [];
  function copy(relative) {
    const source = path.join(root, relative);
    if (!fs.lstatSync(source).isFile()) throw new Error(`Expected regular source file: ${relative}`);
    const outputPath = path.join(destination, relative);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.copyFileSync(source, outputPath);
    fs.chmodSync(outputPath, relative.endsWith('.command') ? 0o755 : 0o644);
    // Stable contents and timestamps; no local permissions or account names in archive.
    fs.utimesSync(outputPath, 0, 0);
    entries.push(relative);
  }
  try {
    for (const file of listSourceFiles()) copy(file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (target.endsWith('.zip')) {
      const result = spawnSync('zip', ['-X', '-q', target,
        ...entries.map((entry) => `visual-context-memory/${entry}`)], { cwd: stage, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr || 'ZIP packaging requires the zip command');
      return { output: target, files: entries.length, format: 'zip' };
    }
    // Archive only the explicit regular-file list; no directory metadata or databases.
    const version = spawnSync('tar', ['--version'], { encoding: 'utf8' });
    const ownership = version.stdout?.includes('bsdtar')
      ? ['--uid', '0', '--gid', '0', '--uname', 'root', '--gname', 'root']
      : ['--owner=0', '--group=0', '--numeric-owner'];
    const tarPath = path.join(stage, 'sources.tar');
    const result = spawnSync('tar', ['--format=ustar', '-cf', tarPath, ...ownership,
      '-C', stage, ...entries.sort().map((entry) => `visual-context-memory/${entry}`)], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || 'tar failed');
    // Native tar gzip headers can embed wall time; Node gzip uses a zero timestamp.
    fs.writeFileSync(target, gzipSync(fs.readFileSync(tarPath), { level: 9 }), { flag: 'wx' });
    return { output: target, files: entries.length };
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/package-skill.mjs <new-preview.tar.gz>');
  console.log(JSON.stringify(packageSkill(process.argv[2])));
}
