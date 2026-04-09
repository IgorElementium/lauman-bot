import { Bot, Context } from 'grammy';
import { logger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { handleMessage } from '../llm/chat.js';

export type BotContext = Context;

export const bot = new Bot<BotContext>(config.telegram.botToken);

// Middleware: only allow whitelisted chat IDs
bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    logger.warn('Message from unknown chat', { chatId });
    return;
  }

  if (!config.telegram.allowedChatIds.includes(chatId)) {
    logger.warn('Message from unauthorized chat', { chatId });
    return;
  }

  await next();
});

// Middleware: log all messages
bot.use((ctx, next) => {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  const messageType = ctx.message?.text ? 'text' : 'other';

  logger.info('Incoming message', {
    chatId,
    userId,
    messageType,
    text: ctx.message?.text?.substring(0, 100),
  });

  return next();
});

// Phase 3: Claude handler
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  const chatId = ctx.chat.id;
  logger.info('Processing message with Claude', { chatId, textLength: text.length });

  try {
    // Handle message with LLM
    const response = await handleMessage(chatId, text);

    // Send response
    await ctx.reply(response.text);

    logger.info('Message processed successfully', { chatId });
  } catch (error) {
    logger.error('Failed to handle message', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });

    try {
      await ctx.reply('Sorry, er ging iets mis. Probeer opnieuw.');
    } catch (replyError) {
      logger.error('Failed to send error message', { replyError });
    }
  }
});

// Error handler
bot.catch((err) => {
  const { error, ctx } = err;
  logger.error('Bot error', {
    error: error instanceof Error ? error.message : String(error),
    chatId: ctx?.chat?.id,
  });
});

// Health check handler
bot.command('start', async (ctx) => {
  await ctx.reply(
    'Hoi Jorn! 🤖 Lauman bot is online. Stuur een bericht om mee te praten.'
  );
  logger.info('Start command received', { chatId: ctx.chat.id });
});

bot.command('ping', async (ctx) => {
  await ctx.reply('Pong! ✅');
});

export async function startBot(): Promise<void> {
  logger.info('Starting Telegram bot with long polling', {
    botToken: config.telegram.botToken.substring(0, 10) + '...',
    allowedChatIds: config.telegram.allowedChatIds,
  });

  try {
    await bot.start({
      onStart: (botInfo) => {
        logger.info('Bot started successfully', {
          botId: botInfo.id,
          botUsername: botInfo.username,
        });
      },
    });
  } catch (error) {
    logger.error('Failed to start bot', { error });
    throw error;
  }
}

export async function stopBot(): Promise<void> {
  logger.info('Stopping bot');
  bot.stop();
}
