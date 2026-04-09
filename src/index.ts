import { logger } from './utils/logger.js';
import { config, validateConfig } from './utils/config.js';
import { startBot } from './telegram/bot.js';

async function main(): Promise<void> {
  try {
    logger.info('Lauman bot starting', {
      mode: config.bot.mode,
      nodeEnv: process.env.NODE_ENV || 'development',
    });

    // Validate configuration
    validateConfig();
    logger.info('Configuration validated');

    // Start Telegram bot
    await startBot();

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      logger.info('Received SIGINT, shutting down');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, shutting down');
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to start bot', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

main();
