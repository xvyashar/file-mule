import { startIRBots } from "./ir-socials/index.js";
import { startTGBot } from "./telegram/index.js";

startTGBot(() => console.log("🚀 Telegram bot has been launched!"));
startIRBots(() => console.log("🚀 Bale & Rubika bot has been launched!"));
