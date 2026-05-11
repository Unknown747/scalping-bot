import { ScalpingBot } from "./scalping/ScalpingBot.js";
import { broadcastEvent } from "./websocket.js";

let botInstance: ScalpingBot | null = null;

export function initBot(): ScalpingBot {
  if (!botInstance) {
    botInstance = new ScalpingBot((event, data) => broadcastEvent(event, data));
  }
  return botInstance;
}

export function getBot(): ScalpingBot {
  if (!botInstance) {
    return initBot();
  }
  return botInstance;
}
