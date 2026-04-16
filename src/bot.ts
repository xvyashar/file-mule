import { startRKBot } from "./rubika/index.js";
import { startTGBot } from "./telegram/index.js";

startTGBot(() => console.log("🚀 Telegram bot has been launched!"));
startRKBot(() => console.log("🚀 Rubika bot has been launched!"));
