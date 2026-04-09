import { logger } from './utils/logger.js';
import { config, validateConfig } from './utils/config.js';
import { startBot } from './telegram/bot.js';
import { initDb, closeDb } from './db/sqlite.js';
import { startOdooPoller } from './cron/odoo-poller.js';

let pollerInterval: NodeJS.Timeout | null = null;

async function main(): Promise<void> {
  try {
    logger.info('Lauman bot starting', {
      mode: config.bot.mode,
      nodeEnv: process.env.NODE_ENV || 'development',
    });

    // Validate configuration
    validateConfig();
    logger.info('Configuration validated');

    // Initialize database
    initDb();
    logger.info('Database initialized');

    // Start Odoo poller (if credentials are configured)
    // Do this before the bot because bot.start() runs indefinitely
    if (config.odoo.username && config.odoo.apiKey) {
      pollerInterval = startOdooPoller();
    } else {
      logger.warn('Odoo credentials not configured, skipping poller');
    }

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      logger.info('Received SIGINT, shutting down');
      shutdown();
    });

    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, shutting down');
      shutdown();
    });

    // Start Telegram bot (this runs indefinitely)
    await startBot();
  } catch (error) {
    logger.error('Failed to start bot', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

function shutdown(): void {
  if (pollerInterval) {
    clearInterval(pollerInterval);
    logger.info('Poller stopped');
  }
  closeDb();
  logger.info('Database closed');
  process.exit(0);
}

main();
