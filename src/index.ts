import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig, ConfigError } from './config.ts';
import { LtaClient } from './lta/client.ts';
import { Poller } from './poller/poller.ts';
import { buildServer } from './server/server.ts';

async function main(): Promise<void> {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\n[config] ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const here = dirname(fileURLToPath(import.meta.url));
  // In dev, src/index.ts -> ../public; in the built dist/index.js -> ../public too.
  const publicDir = join(here, '..', 'public');

  const client = new LtaClient({ accountKey: cfg.ltaAccountKey });
  const poller = new Poller({
    client,
    stops: cfg.stops,
    intervalMs: cfg.pollIntervalMs,
  });

  const { server } = buildServer({ poller, publicDir });

  await poller.start();
  server.listen(cfg.port, cfg.host, () => {
    console.log(
      `[sgbus-arrival] listening on http://${cfg.host}:${cfg.port} ` +
        `(${cfg.stops.length} stop(s), poll ${cfg.pollIntervalMs / 1000}s)`,
    );
  });

  const shutdown = (sig: string): void => {
    console.log(`\n[sgbus-arrival] ${sig} received, shutting down.`);
    poller.stop();
    server.close(() => process.exit(0));
    // Force-exit if close hangs.
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void main();
