import { RubikaAdaptor } from "./adaptor.js";
import { UpdateTypeEnum, type Update } from "./types.js";
import { db, cache } from "../db/index.js";
import { usersTable } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { bot as tgBot } from "../telegram/index.js";

const bot = await RubikaAdaptor.getInstance();

export function registerCommands() {
  bot.on("message", async (update: Update) => {
    if (
      update.type != UpdateTypeEnum.NewMessage ||
      !update?.new_message?.text?.startsWith("/link ")
    )
      return;

    const linkId = update.new_message.text.substring(6);
    if (!linkId) return;

    const tgId = await cache.get<number>(`link_id:${linkId}`);
    if (!tgId) return;

    await cache.del(`link_req:${tgId}`);
    await cache.del(`link_id:${linkId}`);

    await db
      .update(usersTable)
      .set({ rubikaId: update.chat_id })
      .where(eq(usersTable.telegramId, tgId));

    const res = "Your accounts are now linked together! 🌟";
    await bot.sendMessage({
      chat_id: update.chat_id,
      text: res,
    });
    await tgBot.api.sendMessage(tgId, res);
  });
}
