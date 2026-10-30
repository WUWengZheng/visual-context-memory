// Installed launcher resolves paths independently of the caller's working directory.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const configPath = path.join(root, 'vcm-install.json');
try {
  const [command = 'help', ...flags] = process.argv.slice(2);
  if (!['help', 'doctor', 'start'].includes(command) || flags.some((flag) => flag !== '--open')) {
    throw new Error('INVALID_COMMAND: use help, doctor, or start [--open]');
  }
  if (command === 'help') {
    console.log('node scripts/vcm.mjs doctor | start [--open]\nRuns in foreground. Ctrl+C stops it. No background daemon or automatic updates.');
  } else {
    if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('NODE_REQUIRED: Node.js 24+ is required');
    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {
      schemaVersion: 1, dbPath: path.join(root, '.visual-context-memory', 'memory.db'), port: 4173,
    };
    if (config.schemaVersion !== 1 || !path.isAbsolute(config.dbPath)) throw new Error('INVALID_CONFIG: database must be an absolute path in vcm-install.json');
    const dbPath = process.env.VCM_DB_PATH ? path.resolve(process.env.VCM_DB_PATH) : config.dbPath;
    const port = process.env.VCM_PORT === undefined ? config.port : Number(process.env.VCM_PORT);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('INVALID_CONFIG: port must be 0–65535');
    createRequire(path.join(root, 'package.json')).resolve('cytoscape');
    await import('node:sqlite');
    if (command === 'doctor') {
      console.log(`READY: Node ${process.versions.node}, SQLite and Cytoscape available\nApp: ${root}\nDatabase: ${dbPath}\nDatabase exists: ${fs.existsSync(dbPath)}\nPort: ${port}\nLocal configuration only; no database opened or service started.`);
    } else {
      const { createLocalServer } = await import('../src/server/server.mjs');
      const app = createLocalServer({ dbPath, port });
      try {
        const { url } = await app.start();
        console.log(`Visual Context Memory\n${url}\nDatabase: ${dbPath}\nStop with Ctrl+C.\nCodex: use $visual-context-memory with this exact server URL and project.`);
        if (flags.includes('--open')) {
          const opener = process.platform === 'darwin' ? ['open', [url]]
            : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
          const child = spawn(opener[0], opener[1], { stdio: 'ignore' });
          child.on('error', () => console.error(`Browser could not open automatically; open ${url} manually.`));
          child.on('exit', (code) => { if (code) console.error(`Browser opener exited ${code}; open ${url} manually.`); });
        }
        for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.stop().finally(() => process.exit(0)));
      } catch (error) { await app.stop(); throw error; }
    }
  }
} catch (error) {
  console.error(`VCM: ${error.message}\nFor missing dependencies run npm ci --ignore-scripts in the application folder. Existing data is not replaced.`);
  process.exitCode = 1;
}
