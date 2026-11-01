import './config/env.js'; // Validate env first
import app from './app.js';
import { connectDB } from './config/database.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

async function start() {
  await connectDB();

  const server = app.listen(env.PORT, () => {
    logger.info(`ReelFlow server running on port ${env.PORT} [${env.NODE_ENV}]`);
    logger.info(`Client URL: ${env.CLIENT_URL}`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down server`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: String(reason) });
  });
}

start();
