import { Bot, webhookCallback } from "grammy";
import { cache } from "../db/index.js";
import { registerCommands } from "./commands.js";
import type { UserFromGetMe } from "grammy/types";
import { Hono } from "hono";
import axios, { AxiosError } from "axios";
import { sequentialize } from "@grammyjs/runner";

if (process.env.LOCAL_MODE == "true") {
  try {
    const result = await axios.get(
      `https://api.telegram.org/bot${process.env.TG_TOKEN}/logOut`,
    );

    if (!result.data.ok) throw new Error(result.data);
  } catch (error) {
    if (error instanceof AxiosError) {
      if (error.response?.data.description !== "Logged out") throw error;
    }
  }
}

export const bot = new Bot(process.env.TG_TOKEN!, {
  client: {
    apiRoot:
      process.env.LOCAL_MODE == "true"
        ? "http://telegram-bot-api:8081"
        : "https://api.telegram.org",
    canUseWebhookReply: (method) =>
      method === "answerCallbackQuery" || method === "sendChatAction",
  },
});

cache.set("allowedUsers", process.env.ALLOWED_USERS?.split(","));

export function startTGBot(
  onStart: (botInfo: UserFromGetMe) => void | Promise<void>,
) {
  registerCommands();

  bot.start({
    onStart,
  });
}

export function startTGBotWithWebhook(app: Hono, webhookEndpoint: string) {
  app.use(webhookCallback(bot, "hono")); // temp
  bot.use(sequentialize((ctx) => ctx.chatId?.toString() ?? "global"));

  registerCommands();

  return bot.api.setWebhook(webhookEndpoint);
}
