import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp();

let closing = false;
const close = async (signal: NodeJS.Signals): Promise<void> => {
  if (closing) {
    return;
  }
  closing = true;
  app.log.info({ signal }, 'shutdown requested');
  try {
    await app.close();
  } catch (error) {
    app.log.error({ error }, 'shutdown failed');
    process.exitCode = 1;
  }
};

process.once('SIGINT', () => void close('SIGINT'));
process.once('SIGTERM', () => void close('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ error }, 'server startup failed');
  process.exitCode = 1;
}
