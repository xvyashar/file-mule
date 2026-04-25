import { RubikaAdaptor } from './rk.adaptor.js';
import { RKUpdateTypeEnum, type RKUpdate } from '../types/index.js';
import { db, cache } from '../db/index.js';
import { usersTable } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { bot as tgBot } from '../telegram/index.js';

const bot = RubikaAdaptor.getInstance();

export function registerRKCommands() {
  bot.on('message', async (update: RKUpdate) => {
    if (
      update.type != RKUpdateTypeEnum.NewMessage ||
      !update.new_message?.text?.startsWith('/link ')
    )
      return;

    const linkId = update.new_message.text.substring(6);
    if (!linkId) return;

    const tgId = await cache.get<number>(`rkLinkId:${linkId}`);
    if (!tgId) return;

    await cache.del(`rkLinkReq:${tgId}`);
    await cache.del(`rkLinkId:${linkId}`);

    await db
      .update(usersTable)
      .set({ irSocialId: update.chat_id })
      .where(eq(usersTable.telegramId, tgId));

    const res = 'Your accounts are now linked together! 🌟';
    await bot.sendMessage({
      chat_id: update.chat_id,
      text: res,
      reply_to_message_id: update.new_message.message_id,
    });
    await tgBot.api.sendMessage(tgId, res);
  });
}
