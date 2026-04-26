import { Bot, webhookCallback } from 'grammy';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

import config from '../config.js';
import { logOut } from './utils.js';
import { registerHandlers } from './handlers.js';
import logger from '../logger/logger.js';

export const bot = new Bot(config.env.TELEGRAM_BOT_TOKEN, {
  client: {
    apiRoot: config.telegram.botApi.baseUrl,
    canUseWebhookReply: () => false,
  },
});

export async function startTelegramBot() {
  if (config.telegram.botApi.localMode)
    await logOut(config.env.TELEGRAM_BOT_TOKEN); //! consideration: if you were using another telegram bot api server previously, you need to log out from it manually.

  registerHandlers(bot);

  if (!config.telegram.webhook.enabled) {
    return bot.start({
      drop_pending_updates: true,
    });
  }

  const app = new Hono();
  app.use(webhookCallback(bot, 'hono'));

  const server = serve({
    fetch: app.fetch,
    port: config.telegram.webhook.port,
  });

  process.on('SIGINT', () => {
    server.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    server.close((err) => {
      if (err) {
        logger.error(err.stack ?? err.message, { label: 'telegram/index.ts' });
        process.exit(1);
      }
      process.exit(0);
    });
  });

  await bot.api.setWebhook(config.telegram.webhook.endpoint, {
    drop_pending_updates: true,
  });
}
