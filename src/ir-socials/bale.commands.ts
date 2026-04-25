import { eq } from 'drizzle-orm';

import { BaleAdaptor } from './bale.adaptor.js';
import { type BaleUpdate } from '../types/index.js';
import { db, cache } from '../db/index.js';
import { usersTable } from '../db/schema.js';
import { bot as tgBot } from '../telegram/index.js';

const bot = BaleAdaptor.getInstance();

export function registerBaleCommands() {
  bot.on('message', async (update: BaleUpdate) => {
    if (!update.message?.text?.startsWith('/link ')) return;

    const linkId = update.message.text.substring(6);
    if (!linkId) return;

    const tgId = await cache.get<number>(`baleLinkId:${linkId}`);
    if (!tgId) return;

    await cache.del(`baleLinkReq:${tgId}`);
    await cache.del(`baleLinkId:${linkId}`);

    await db
      .update(usersTable)
      .set({ irSocialId: update.message.chat.id.toString() })
      .where(eq(usersTable.telegramId, tgId));

    const res = 'Your accounts are now linked together! 🌟';
    await bot.sendMessage({
      chat_id: update.message.chat.id,
      text: res,
      reply_to_message_id: update.message.message_id,
    });
    await tgBot.api.sendMessage(tgId, res);
  });
}
