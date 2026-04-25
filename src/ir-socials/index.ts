import { BaleAdaptor } from './bale.adaptor.js';
import { registerBaleCommands } from './bale.commands.js';
import { RubikaAdaptor } from './rk.adaptor.js';
import { registerRKCommands } from './rk.commands.js';

const baleBot = BaleAdaptor.getInstance();
const rkBot = RubikaAdaptor.getInstance();

registerRKCommands();
registerBaleCommands();

export function startIRBots() {
  return Promise.all([baleBot.startPolling(), rkBot.startPolling()]);
}
