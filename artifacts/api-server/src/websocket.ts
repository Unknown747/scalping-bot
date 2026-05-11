import { Server as SocketIOServer } from "socket.io";
import type { Server as HTTPServer } from "http";
import { logger } from "./lib/logger.js";
import type { ScalpingBot } from "./scalping/ScalpingBot.js";

let io: SocketIOServer | null = null;
let bot: ScalpingBot | null = null;

export function initWebSocket(httpServer: HTTPServer, scalpingBot: ScalpingBot): SocketIOServer {
  bot = scalpingBot;

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "Client connected");

    // Send current state immediately on connect
    if (bot) {
      socket.emit("bot-status", bot.getStatus());
      bot.buildStats().then((stats) => socket.emit("stats-update", stats)).catch(() => {});
    }

    socket.on("start-scalping", async () => {
      if (bot && !bot.getStatus().running) {
        await bot.start();
        io?.emit("bot-status", bot.getStatus());
      }
    });

    socket.on("stop-scalping", () => {
      if (bot) {
        bot.stop();
        io?.emit("bot-status", bot.getStatus());
      }
    });

    socket.on("manual-sell", async ({ tokenAddress, percent }: { tokenAddress: string; percent: number }) => {
      if (bot) {
        await bot.closePosition(tokenAddress, percent, "manual").catch((e) =>
          logger.error({ e }, "Manual sell failed")
        );
      }
    });

    socket.on("disconnect", () => {
      logger.info({ socketId: socket.id }, "Client disconnected");
    });
  });

  return io;
}

export function getSocketIO(): SocketIOServer | null {
  return io;
}

export function broadcastEvent(event: string, data: unknown): void {
  if (io) {
    io.emit(event, data);
  }
}
