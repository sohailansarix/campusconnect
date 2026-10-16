import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/prisma.js';
import { initialiseStorage } from './services/storage/index.js';
import { verifyMailer, closeMailer } from './services/mailer/index.js';

/**
 * Server entrypoint.
 *
 * Boot order matters:
 *   1. Connect to Postgres — if this fails there is no point starting.
 *   2. Ensure the storage root exists (local driver only).
 *   3. Verify the mail transport — a warning, not a fatal, because email is not
 *      required to serve requests.
 *   4. Listen.
 *
 * Shutdown is graceful: stop accepting new connections, let in-flight requests
 * finish, then close the pool and any open SMTP sockets. Without this, a deploy
 * drops in-flight attendance scans and, in the worst case, orphans a transaction.
 */

async function bootstrap(): Promise<void> {
  logger.info('Starting CampusConnect API', {
    environment: env.NODE_ENV,
    nodeVersion: process.version,
    port: env.API_PORT,
  });

  // 1. Database.
  try {
    await connectDatabase();
    logger.info('Database connected');
  } catch (error) {
    logger.error('Could not connect to the database — refusing to start', error, {
      // The URL is not logged; only whether one was configured.
      hasDatabaseUrl: Boolean(env.DATABASE_URL),
    });
    process.exit(1);
  }

  // 2. Storage.
  try {
    await initialiseStorage();
  } catch (error) {
    // Storage is required for uploads but not for reading events, so this warns.
    logger.error('Storage initialisation failed — uploads will not work', error);
  }

  // 3. Mail. Deliberately not awaited as a hard gate.
  void verifyMailer().catch((error: unknown) => {
    logger.error('Mail verification threw', error);
  });

  // 4. Listen.
  const app = createApp();

  const server = app.listen(env.API_PORT, () => {
    logger.info(`API listening on ${env.API_URL}`, {
      api: `${env.API_URL}/api/v1`,
      docs: env.isProduction ? 'disabled' : `${env.API_URL}/api/docs`,
      storageDriver: env.STORAGE_DRIVER,
      mailDriver: env.MAIL_DRIVER,
      aiDriver: env.AI_DRIVER,
    });

    if (env.STORAGE_DRIVER === 'local' && env.isProduction) {
      logger.error('STORAGE_DRIVER=local in production — uploads will be lost on redeploy');
    }
  });

  /**
   * Keep-alive is slightly longer than the common 60s proxy idle timeout, so the
   * proxy does not close a connection the server still considers live.
   */
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  /* ---------------------------------------------------------------------- */
  /* Graceful shutdown                                                      */
  /* ---------------------------------------------------------------------- */

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      logger.warn(`Received ${signal} again while shutting down — exiting immediately`);
      process.exit(1);
    }
    shuttingDown = true;

    logger.info(`Received ${signal} — shutting down gracefully`);

    // Force-exit if a request hangs. Ten seconds is generous for this API and far
    // inside a typical orchestrator's SIGKILL window.
    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close(async (error) => {
      if (error) logger.error('Error while closing the HTTP server', error);

      try {
        closeMailer();
        await disconnectDatabase();
        logger.info('Shutdown complete');
      } catch (closeError) {
        logger.error('Error during cleanup', closeError);
      }

      clearTimeout(forceExit);
      process.exit(error ? 1 : 0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  /* ---------------------------------------------------------------------- */
  /* Last-resort handlers                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * A rejected promise nobody awaited. Logging rather than exiting: the API is
   * mostly fire-and-forget notification work, and taking the whole process down
   * because one non-critical promise rejected would be worse than the leak.
   */
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', reason);
  });

  /**
   * An uncaught exception leaves the process in an unknown state, so this one does
   * exit — after giving the logger a chance to flush.
   */
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception — exiting', error);
    process.exit(1);
  });
}

void bootstrap();
