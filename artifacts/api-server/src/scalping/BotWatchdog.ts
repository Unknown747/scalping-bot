import { logger } from "../lib/logger.js";
import type { ScalpingBot } from "./ScalpingBot.js";

const STALL_THRESHOLD_MS = 5 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;
const RESTART_COOLDOWN_MS = 30 * 1000;

export class BotWatchdog {
  private bot: ScalpingBot;
  private watchInterval: NodeJS.Timeout | null = null;
  private lastScanCycle = -1;
  private lastScanTime = Date.now();
  private lastRestartTime = 0;
  private restartCount = 0;
  private handlersRegistered = false;

  constructor(bot: ScalpingBot) {
    this.bot = bot;
  }

  start(): void {
    if (this.watchInterval) return;
    this.setupProcessHandlers();
    this.watchInterval = setInterval(() => {
      this.check().catch((err) => logger.error({ err }, "BotWatchdog check error"));
    }, CHECK_INTERVAL_MS);
    logger.info("BotWatchdog started — checking every 60s, restart threshold 5m stall");
  }

  stop(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
    logger.info("BotWatchdog stopped");
  }

  getStats() {
    return {
      restartCount: this.restartCount,
      lastScanTime: new Date(this.lastScanTime).toISOString(),
      lastScanCycle: this.lastScanCycle,
      lastRestartTime: this.lastRestartTime > 0 ? new Date(this.lastRestartTime).toISOString() : null,
    };
  }

  private async check(): Promise<void> {
    const status = this.bot.getStatus();

    if (!status.running) {
      this.lastScanTime = Date.now();
      this.lastScanCycle = status.scanCycle;
      return;
    }

    const currentCycle = status.scanCycle;
    if (currentCycle !== this.lastScanCycle) {
      this.lastScanCycle = currentCycle;
      this.lastScanTime = Date.now();
      return;
    }

    const stalledMs = Date.now() - this.lastScanTime;
    if (stalledMs > STALL_THRESHOLD_MS) {
      logger.warn(
        { stalledMs: Math.round(stalledMs / 1000) + "s", restartCount: this.restartCount },
        "BotWatchdog: scan cycle stalled — restarting bot"
      );
      await this.restartBot("scan_stall");
    }
  }

  private async restartBot(reason: string): Promise<void> {
    const now = Date.now();
    if (now - this.lastRestartTime < RESTART_COOLDOWN_MS) {
      logger.warn({ reason }, "BotWatchdog: restart skipped — cooldown active");
      return;
    }

    this.restartCount++;
    this.lastRestartTime = now;
    logger.warn({ reason, restartCount: this.restartCount }, "BotWatchdog: initiating bot restart");

    try {
      this.bot.stop();
      await sleep(2000);
      await this.bot.start();
      const newStatus = this.bot.getStatus();
      this.lastScanCycle = newStatus.scanCycle;
      this.lastScanTime = Date.now();
      logger.info(
        { reason, restartCount: this.restartCount },
        "BotWatchdog: bot restarted successfully"
      );
    } catch (err) {
      logger.error({ err, reason, restartCount: this.restartCount }, "BotWatchdog: restart failed");
    }
  }

  private setupProcessHandlers(): void {
    if (this.handlersRegistered) return;
    this.handlersRegistered = true;

    process.on("uncaughtException", (err) => {
      logger.error({ err }, "BotWatchdog: uncaughtException caught — attempting bot restart");
      this.restartBot("uncaughtException").catch(() => {});
    });

    process.on("unhandledRejection", (reason) => {
      logger.error({ reason }, "BotWatchdog: unhandledRejection caught — attempting bot restart");
      this.restartBot("unhandledRejection").catch(() => {});
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
