import { ScalpingBot } from "./scalping/ScalpingBot.js";
import { BotWatchdog } from "./scalping/BotWatchdog.js";
import { broadcastEvent } from "./websocket.js";

let botInstance: ScalpingBot | null = null;
let watchdogInstance: BotWatchdog | null = null;

export function initBot(): ScalpingBot {
  if (!botInstance) {
    botInstance = new ScalpingBot((event, data) => broadcastEvent(event, data));
    watchdogInstance = new BotWatchdog(botInstance);
    watchdogInstance.start();
  }
  return botInstance;
}

export function getBot(): ScalpingBot {
  if (!botInstance) {
    return initBot();
  }
  return botInstance;
}

export function getWatchdog(): BotWatchdog | null {
  return watchdogInstance;
}
