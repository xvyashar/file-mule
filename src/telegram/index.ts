import { Bot } from "grammy";
import { cache } from "../db/index.js";
import { registerCommands } from "./commands.js";
import type { UserFromGetMe } from "grammy/types";

export const bot = new Bot(process.env.TG_TOKEN!);

cache.set("allowedUsers", process.env.ALLOWED_USERS?.split(","));

registerCommands();

export function startTGBot(
  onStart: (botInfo: UserFromGetMe) => void | Promise<void>,
) {
  bot.start({
    onStart,
  });
}
