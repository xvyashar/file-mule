import { startTelegramBot } from './telegram/index.js';
import { startIRBots } from './ir-socials/index.js';
import logger from './logger/logger.js';
import { startQueueCleanupCron } from './schedule.js';
const logLabel = { label: 'bot.ts' };

await startTelegramBot();
logger.info('🚀 Telegram bot has been launched', logLabel);
await startIRBots();
logger.info('🚀 Bale & Rubika bot has been launched', logLabel);

startQueueCleanupCron();

process.on('unhandledRejection', (reason) => {
  logger.error(reason);
});
process.on('uncaughtException', (reason) => {
  logger.error(reason);
});
