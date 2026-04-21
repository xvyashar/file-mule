import { startIRBots } from "./ir-socials/index.js";
import { startTGBot, startTGBotWithWebhook } from "./telegram/index.js";
import { Hono } from "hono";
import { serve } from "@hono/node-server";

if (process.env.TG_WEBHOOK_ENDPOINT) {
  const app = new Hono();

  await startTGBotWithWebhook(app, process.env.TG_WEBHOOK_ENDPOINT);

  const server = serve({
    fetch: app.fetch,
    port: parseInt(process.env.TG_WEBHOOK_PORT!) || 3000,
  });

  process.on("SIGINT", () => {
    server.close();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    server.close((err) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      process.exit(0);
    });
  });

  console.log("🚀 Telegram bot has been launched in webhook mode");
} else {
  startTGBot(() =>
    console.log("🚀 Telegram bot has been launched in long polling mode"),
  );
}

startIRBots(() => console.log("🚀 Bale & Rubika bot has been launched"));

process.on("unhandledRejection", (reason) => {
  console.error(reason);
});

process.on("uncaughtException", (reason) => {
  console.error(reason);
});
