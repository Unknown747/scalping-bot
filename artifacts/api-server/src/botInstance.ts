import { ScalpingBot } from "./scalping/ScalpingBot.js";
import { BotWatchdog } from "./scalping/BotWatchdog.js";
import { broadcastEvent } from "./websocket.js";
import { cleanOldLogs, clearHoneypotBlacklist } from "./scalping/database.js";
import { logger } from "./lib/logger.js";

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

    // Clear honeypot blacklist on startup — a previous bug (WETH approval simulation
    // misclassified as honeypot) may have permanently blacklisted legitimate tokens.
    // This is safe: the real GoPlus safety check still runs on every token before entry.
    const cleared = clearHoneypotBlacklist();
    if (cleared > 0) {
      logger.warn({ cleared }, `Startup: cleared ${cleared} entries from honeypot blacklist (may have been wrongly blacklisted by WETH simulation bug — fixed in this version)`);
    }
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
