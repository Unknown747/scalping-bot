import { ScalpingBot } from "./scalping/ScalpingBot.js";
import { BotWatchdog } from "./scalping/BotWatchdog.js";
import { broadcastEvent } from "./websocket.js";
import { cleanOldLogs } from "./scalping/database.js";

let botInstance: ScalpingBot | null = null;
let watchdogInstance: BotWatchdog | null = null;

const CLEAN_LOGS_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function initBot(): ScalpingBot {
  if (!botInstance) {
    botInstance = new ScalpingBot((event, data) => broadcastEvent(event, data));
    watchdogInstance = new BotWatchdog(botInstance);
    watchdogInstance.start();
    cleanOldLogs();
    setInterval(() => cleanOldLogs(), CLEAN_LOGS_INTERVAL_MS);
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
