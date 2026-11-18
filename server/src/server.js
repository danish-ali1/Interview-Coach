import dotenv from 'dotenv';
import { createApp } from './app.js';
import { buildContainer } from './container.js';
import { connectDb, disconnectDb, isDbReady } from './config/db.js';
import { loadConfig } from './config/env.js';
import { createLogger } from './config/logger.js';

dotenv.config({ quiet: true });

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const logger = createLogger({ level: config.logLevel, pretty: config.env === 'development' });

async function main() {
  await connectDb({ uri: config.mongo.uri, autoIndex: config.mongo.autoIndex, logger });

  const app = createApp({ config, logger, isReady: isDbReady, ...buildContainer({ config, logger }) });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env, vectorStore: config.vector.store }, 'API listening');
  });

  let shuttingDown = false;
  const shutdown = async (reason, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ reason }, 'shutting down');

    // Hard stop if connections refuse to drain.
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();

    server.close(async () => {
      await disconnectDb().catch((err) => logger.error({ err }, 'error closing MongoDB'));
      process.exit(exitCode);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => {
    logger.fatal({ err }, 'unhandled rejection');
    shutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    shutdown('uncaughtException', 1);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
