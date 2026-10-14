import { createLocalServer, DEFAULT_PORT } from './server.mjs';

const portValue = process.env.VCM_PORT;
const port = portValue === undefined ? DEFAULT_PORT : Number(portValue);
const app = createLocalServer({ dbPath: process.env.VCM_DB_PATH, port });

try {
  const address = await app.start();
  console.log('Visual Context Memory');
  console.log(address.url);
} catch (error) {
  console.error(`Unable to start Visual Context Memory: ${error.message}`);
  process.exitCode = 1;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => app.stop().finally(() => process.exit(0)));
}
