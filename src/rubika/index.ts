import { RubikaAdaptor } from "./adaptor.js";
import { registerCommands } from "./commands.js";

const bot = await RubikaAdaptor.getInstance();

registerCommands();

export function startRKBot(onStart: () => void | Promise<void>) {
  bot.startPolling();
  onStart();
}
