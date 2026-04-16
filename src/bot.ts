import { Bot } from "grammy";
import db from "./db/index.js";

const bot = new Bot(process.env.TG_TOKEN!);

bot.command("start", (ctx) => ctx.reply("Welcome! Up and running."));
bot.on("message", (ctx) => ctx.reply("Got another message!"));

bot.start({
  onStart: () => {
    console.log("🚀 Bot is launched!");
  },
});
