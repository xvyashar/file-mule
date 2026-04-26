import { startTelegramBot } from './telegram/index.js';
import { startIRBots } from './ir-socials/index.js';
import logger from './logger.js';
import { startQueueCleanupCron } from './schedule.js';
import { inspect } from 'node:util';
const logLabel = { label: 'bot.ts' };

await startTelegramBot();
logger.info('🚀 Telegram bot has been launched', logLabel);
await startIRBots();
logger.info('🚀 Bale & Rubika bot has been launched', logLabel);

startQueueCleanupCron();

process.on('unhandledRejection', (reason) => {
  logger.error(inspect(reason), { label: 'unhandled' });
});
process.on('uncaughtException', (reason) => {
  logger.error(inspect(reason), { label: 'uncaught' });
});
