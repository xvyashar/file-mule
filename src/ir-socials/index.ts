import { RubikaAdaptor } from "./rk.adaptor.js";
import { BaleAdaptor } from "./bale.adaptor.js";
import { registerRKCommands } from "./rk.commands.js";
import { registerBaleCommands } from "./bale.commands.js";

const baleBot = await BaleAdaptor.getInstance();
const rkBot = await RubikaAdaptor.getInstance();

registerRKCommands();
registerBaleCommands();

export async function startIRBots(onStart: () => void | Promise<void>) {
  await baleBot.startPolling();
  await rkBot.startPolling();
  onStart();
}
