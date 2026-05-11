import { createServer } from "http";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { initWebSocket } from "./websocket.js";
import { initBot } from "./botInstance.js";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

const httpServer = createServer(app);

// Initialize WebSocket and bot
const bot = initBot();
initWebSocket(httpServer, bot);

httpServer.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port, mode: bot.getConfig().mode }, "Scalping server listening");
});
