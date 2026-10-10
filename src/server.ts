import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = buildApp({
  maxFileSizeBytes: config.maxFileSizeBytes,
  logger: { level: config.logLevel },
});

// Finish in-flight requests before exiting (e.g. on Ctrl+C or a container stop).
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info(`Received ${signal}, shutting down`);
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error({ err: error }, 'Error during shutdown');
        process.exit(1);
      },
    );
  });
}

await app.listen({ port: config.port, host: config.host });
