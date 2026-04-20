import { Bot, webhookCallback } from "grammy";
import { cache } from "../db/index.js";
import { registerCommands } from "./commands.js";
import type { UserFromGetMe } from "grammy/types";
import { Hono } from "hono";
import axios from "axios";

if (process.env.LOCAL_MODE == "true") {
  const result = await axios.get(
    `https://api.telegram.org/bot${process.env.TG_TOKEN}/logOut`,
  );
  if (!result.data.data.ok) throw new Error(result.data.data);
}

export const bot = new Bot(process.env.TG_TOKEN!, {
  client: {
    apiRoot:
      process.env.LOCAL_MODE == "true"
        ? "http://localhost:8081"
        : "https://api.telegram.org",
    canUseWebhookReply: () => false,
  },
});

cache.set("allowedUsers", process.env.ALLOWED_USERS?.split(","));

registerCommands();

export function startTGBot(
  onStart: (botInfo: UserFromGetMe) => void | Promise<void>,
) {
  bot.start({
    onStart,
  });
}

export function startTGBotWithWebhook(app: Hono, webhookEndpoint: string) {
  app.use(webhookCallback(bot, "hono"));
  return bot.api.setWebhook(webhookEndpoint);
}
