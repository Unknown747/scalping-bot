import { logger } from "../lib/logger.js";
import { TokenScanner, type TokenData } from "./TokenScanner.js";
import { SafetyChecker } from "./SafetyChecker.js";
import { PriceMonitor } from "./PriceMonitor.js";
import { SwapExecutor } from "./SwapExecutor.js";
import type { ScalpingConfigData } from "./config.js";
import { DEFAULT_CONFIG } from "./config.js";
import * as db from "./database.js";

export interface PositionState {
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  entryPrice: number;
  currentPrice: number;
  amountEth: number;
  amountTokens: number;
  entryTime: Date;
  tp1Hit: boolean;
  tp2Hit: boolean;
  trailingStopActive: boolean;
  trailingStopPrice: number | null;
  safetyScore: number;
  liquidityUsd: number;
  status: "open" | "closing";
}

type EventEmitter = (event: string, data: unknown) => void;

export class ScalpingBot {
  private config: ScalpingConfigData;
  private running = false;
  private startedAt: Date | null = null;
  private positions = new Map<string, PositionState>();
  private dailyLossEth = 0;
  private cooldownUntil: Date | null = null;
  private scanInterval: NodeJS.Timeout | null = null;
  private priceInterval: NodeJS.Timeout | null = null;

  private tokenScanner: TokenScanner;
  private safetyChecker: SafetyChecker;
  private priceMonitor: PriceMonitor;
  private swapExecutor: SwapExecutor;

  private emit: EventEmitter;

  constructor(emit: EventEmitter) {
    this.config = this.loadConfig();
    this.emit = emit;
    this.tokenScanner = new TokenScanner(this.config);
    this.safetyChecker = new SafetyChecker(this.config.minSafetyScore, this.config.maxSellTaxPercent);
    this.priceMonitor = new PriceMonitor();
    this.swapExecutor = new SwapExecutor(this.config);
  }

  private loadConfig(): ScalpingConfigData {
    try {
      const row = db.getDb().prepare("SELECT config_json FROM bot_config WHERE id = 1").get() as any;
      if (row?.config_json) {
        return { ...DEFAULT_CONFIG, ...JSON.parse(row.config_json) };
      }
    } catch {
      // Use defaults
    }
    return { ...DEFAULT_CONFIG };
  }

  saveConfig(updates: Partial<ScalpingConfigData>): ScalpingConfigData {
    this.config = { ...this.config, ...updates };
    db.getDb().prepare(`
      INSERT INTO bot_config (id, config_json) VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, updated_at = datetime('now')
    `).run(JSON.stringify(this.config));
    this.tokenScanner.updateConfig(this.config);
    this.swapExecutor.updateConfig(this.config);
    return this.config;
  }

  getConfig(): ScalpingConfigData {
    return this.config;
  }

  async getWalletBalance(): Promise<{ ethBalance: number; address: string | null }> {
    return this.swapExecutor.getWalletBalance();
  }

  getStatus() {
    const today = db.getTodayStats();
    return {
      running: this.running,
      mode: this.config.mode,
      startedAt: this.startedAt?.toISOString() || null,
      dailyLossHit: this.isDailyLossHit(),
      cooldownUntil: this.cooldownUntil?.toISOString() || null,
      activePositions: this.positions.size,
      totalTradesDay: today.totalTrades,
      winRateDay: today.totalTrades > 0 ? (today.winningTrades / today.totalTrades) * 100 : 0,
      walletAddress: this.swapExecutor.getWalletAddress(),
    };
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.startedAt = new Date();
    this.log("info", "Scalping bot started", null);
    this.emit("bot-status", this.getStatus());

    // Restore positions from DB
    const savedPositions = db.getPositions();
    for (const p of savedPositions) {
      this.positions.set(p.tokenAddress.toLowerCase(), {
        tokenAddress: p.tokenAddress,
        tokenSymbol: p.tokenSymbol,
        tokenName: p.tokenName,
        entryPrice: p.entryPrice,
        currentPrice: p.currentPrice,
        amountEth: p.amountEth,
        amountTokens: p.amountTokens || 0,
        entryTime: new Date(p.entryTime),
        tp1Hit: p.tp1Hit === 1,
        tp2Hit: p.tp2Hit === 1,
        trailingStopActive: p.trailingStopActive === 1,
        trailingStopPrice: null,
        safetyScore: p.safetyScore,
        liquidityUsd: p.liquidityUsd,
        status: p.status,
      });
      this.priceMonitor.addToken(p.tokenAddress);
    }

    // Start intervals
    this.scanInterval = setInterval(
      () => this.runScanCycle().catch((e) => logger.error({ e }, "Scan cycle error")),
      this.config.scanIntervalSeconds * 1000
    );

    this.priceInterval = setInterval(
      () => this.runPriceCycle().catch((e) => logger.error({ e }, "Price cycle error")),
      this.config.priceCheckIntervalSeconds * 1000
    );

    // Run immediately
    this.runScanCycle().catch(() => {});
    this.runPriceCycle().catch(() => {});
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.startedAt = null;
    if (this.scanInterval) clearInterval(this.scanInterval);
    if (this.priceInterval) clearInterval(this.priceInterval);
    this.scanInterval = null;
    this.priceInterval = null;
    this.log("info", "Scalping bot stopped", null);
    this.emit("bot-status", this.getStatus());
  }

  async emergencyStop(): Promise<void> {
    this.log("warn", "EMERGENCY STOP triggered — closing all positions", null);
    const addresses = Array.from(this.positions.keys());
    for (const address of addresses) {
      await this.closePosition(address, 100, "emergency").catch((e) =>
        logger.error({ e, address }, "Emergency close failed")
      );
    }
    this.stop();
  }

  private async runScanCycle(): Promise<void> {
    if (!this.running) return;
    if (this.isDailyLossHit()) {
      this.log("warn", "Daily loss limit hit — not scanning for new tokens", null);
      return;
    }
    if (this.isInCooldown()) return;
    if (this.positions.size >= this.config.maxConcurrentPositions) return;

    try {
      const allTokens = await this.tokenScanner.scanNewTokens();
      const filtered = this.tokenScanner.filterTokens(allTokens);

      // Save all scanned tokens to DB
      for (const token of allTokens.slice(0, 30)) {
        const passed = filtered.some((f) => f.address.toLowerCase() === token.address.toLowerCase());
        db.insertScannedToken({
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          priceUsd: token.priceUsd,
          priceChange5m: token.priceChange5m,
          priceChange1h: token.priceChange1h,
          volume5mUsd: token.volume5mUsd,
          liquidityUsd: token.liquidityUsd,
          ageMinutes: token.ageMinutes,
          safetyScore: 0,
          passedFilters: passed,
          dexUrl: token.dexUrl,
        });

        this.emit("new-token", {
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          priceUsd: token.priceUsd,
          priceChangePercent5m: token.priceChange5m,
          priceChangePercent1h: token.priceChange1h,
          volumeUsd5m: token.volume5mUsd,
          liquidityUsd: token.liquidityUsd,
          ageMinutes: token.ageMinutes,
          safetyScore: 0,
          passedFilters: passed,
          scannedAt: new Date().toISOString(),
          dexUrl: token.dexUrl,
        });
      }

      // Try to enter positions for filtered tokens
      for (const token of filtered) {
        if (this.positions.size >= this.config.maxConcurrentPositions) break;
        if (this.positions.has(token.address.toLowerCase())) continue;

        await this.tryEnter(token);
      }

      // Emit stats update
      this.emit("stats-update", await this.buildStats());
    } catch (err) {
      logger.error({ err }, "Scan cycle error");
    }
  }

  private async runPriceCycle(): Promise<void> {
    if (!this.running || this.positions.size === 0) return;

    const addresses = Array.from(this.positions.keys());
    const prices = await this.priceMonitor.getPrices(addresses);

    for (const [address, position] of this.positions) {
      const priceData = prices.get(address);
      if (!priceData || priceData.priceUsd <= 0) continue;

      position.currentPrice = priceData.priceUsd;
      const profitPercent = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
      const holdSeconds = Math.floor((Date.now() - position.entryTime.getTime()) / 1000);

      // Check exit conditions
      const exitReason = this.checkExitConditions(position, profitPercent, holdSeconds);

      // Save updated position
      db.upsertPosition({
        tokenAddress: position.tokenAddress,
        tokenSymbol: position.tokenSymbol,
        tokenName: position.tokenName,
        entryPrice: position.entryPrice,
        currentPrice: position.currentPrice,
        amountEth: position.amountEth,
        amountTokens: position.amountTokens,
        profitPercent,
        profitEth: position.amountEth * (profitPercent / 100),
        entryTime: position.entryTime.toISOString(),
        holdSeconds,
        tp1Hit: position.tp1Hit,
        tp2Hit: position.tp2Hit,
        trailingStopActive: position.trailingStopActive,
        trailingStopPrice: position.trailingStopPrice,
        safetyScore: position.safetyScore,
        liquidityUsd: priceData.liquidityUsd,
        status: position.status,
      });

      this.emit("position-update", this.serializePosition(position, profitPercent, holdSeconds));

      if (exitReason) {
        const sellPercent = this.getSellPercent(exitReason, position);
        await this.closePosition(address, sellPercent, exitReason);
      }
    }
  }

  private checkExitConditions(pos: PositionState, profitPercent: number, holdSeconds: number): string | null {
    const holdMinutes = holdSeconds / 60;

    // Max hold time
    if (holdMinutes >= this.config.maxHoldMinutes) return "max_hold";

    // Stop loss
    if (profitPercent <= -this.config.stopLossPercent) return "stop_loss";

    // Trailing stop
    if (pos.trailingStopActive && pos.trailingStopPrice && pos.currentPrice <= pos.trailingStopPrice) {
      return "trailing_stop";
    }

    // Activate trailing stop
    if (!pos.trailingStopActive && profitPercent >= this.config.trailingStopActivatePercent) {
      pos.trailingStopActive = true;
      pos.trailingStopPrice = pos.currentPrice * (1 - this.config.trailingStopDistancePercent / 100);
      this.log("info", `Trailing stop activated for ${pos.tokenSymbol} at ${pos.trailingStopPrice?.toFixed(8)}`, pos.tokenSymbol);
    }

    // Update trailing stop price
    if (pos.trailingStopActive && pos.trailingStopPrice) {
      const newStop = pos.currentPrice * (1 - this.config.trailingStopDistancePercent / 100);
      if (newStop > pos.trailingStopPrice) {
        pos.trailingStopPrice = newStop;
      }
    }

    // Take profits
    if (!pos.tp1Hit && profitPercent >= this.config.tp1Percent) return "tp1";
    if (pos.tp1Hit && !pos.tp2Hit && profitPercent >= this.config.tp2Percent) return "tp2";
    if (pos.tp1Hit && pos.tp2Hit && profitPercent >= this.config.tp3Percent) return "tp3";

    return null;
  }

  private getSellPercent(reason: string, pos: PositionState): number {
    switch (reason) {
      case "tp1": return this.config.tp1SellPercent;
      case "tp2": return this.config.tp2SellPercent;
      case "tp3": return this.config.tp3SellPercent;
      default: return 100; // stop_loss, trailing_stop, max_hold, emergency
    }
  }

  private async tryEnter(token: TokenData): Promise<void> {
    this.log("info", `Evaluating ${token.symbol} — 5m: ${token.priceChange5m.toFixed(1)}%, liq: $${token.liquidityUsd.toFixed(0)}`, token.symbol);

    // Safety check
    const safety = await this.safetyChecker.check(token.address);
    if (!safety.passed) {
      this.log("warn", `${token.symbol} failed safety check (score: ${safety.score}): ${safety.warnings.join(", ")}`, token.symbol);
      return;
    }

    // Execute buy
    const amountEth = this.config.maxTradeAmountEth;
    const buyResult = await this.swapExecutor.buyToken(token.address, amountEth);

    if (!buyResult.success) {
      this.log("error", `Buy failed for ${token.symbol}: ${buyResult.error}`, token.symbol);
      return;
    }

    // Record position
    const position: PositionState = {
      tokenAddress: token.address,
      tokenSymbol: token.symbol,
      tokenName: token.name,
      entryPrice: token.priceUsd,
      currentPrice: token.priceUsd,
      amountEth,
      amountTokens: Number(buyResult.amountOut),
      entryTime: new Date(),
      tp1Hit: false,
      tp2Hit: false,
      trailingStopActive: false,
      trailingStopPrice: null,
      safetyScore: safety.score,
      liquidityUsd: token.liquidityUsd,
      status: "open",
    };

    this.positions.set(token.address.toLowerCase(), position);
    this.priceMonitor.addToken(token.address);

    db.upsertPosition({
      tokenAddress: token.address,
      tokenSymbol: token.symbol,
      tokenName: token.name,
      entryPrice: token.priceUsd,
      currentPrice: token.priceUsd,
      amountEth,
      amountTokens: Number(buyResult.amountOut),
      profitPercent: 0,
      profitEth: 0,
      entryTime: new Date().toISOString(),
      holdSeconds: 0,
      tp1Hit: false,
      tp2Hit: false,
      trailingStopActive: false,
      safetyScore: safety.score,
      liquidityUsd: token.liquidityUsd,
      status: "open",
    });

    this.log("buy", `Bought ${token.symbol} @ $${token.priceUsd.toFixed(8)} | ${amountEth} ETH | Safety: ${safety.score}/100`, token.symbol);
    this.emit("scalp-alert", { type: "buy", message: `Bought ${token.symbol}` });
    this.emit("position-update", this.serializePosition(position, 0, 0));
  }

  async closePosition(tokenAddress: string, sellPercent: number, reason: string): Promise<void> {
    const pos = this.positions.get(tokenAddress.toLowerCase());
    if (!pos || pos.status === "closing") return;

    pos.status = "closing";
    const holdSeconds = Math.floor((Date.now() - pos.entryTime.getTime()) / 1000);
    const profitPercent = ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
    const profitEth = pos.amountEth * (profitPercent / 100) * (sellPercent / 100);

    // Mark TP hits
    if (reason === "tp1") pos.tp1Hit = true;
    if (reason === "tp2") pos.tp2Hit = true;

    if (sellPercent < 100) {
      // Partial sell — keep position open
      pos.amountEth -= pos.amountEth * (sellPercent / 100);
      pos.amountTokens -= pos.amountTokens * (sellPercent / 100);
      pos.status = "open";
    } else {
      // Full close
      this.positions.delete(tokenAddress.toLowerCase());
      this.priceMonitor.removeToken(tokenAddress);
      db.deletePosition(tokenAddress);
    }

    // Execute sell
    const sellResult = await this.swapExecutor.sellToken(
      tokenAddress,
      BigInt(Math.floor(pos.amountTokens * (sellPercent / 100))),
      pos.amountEth * (sellPercent / 100)
    );

    // Record trade
    const exitTime = new Date().toISOString();
    db.insertTrade({
      tokenAddress,
      tokenSymbol: pos.tokenSymbol,
      tokenName: pos.tokenName,
      entryPrice: pos.entryPrice,
      exitPrice: pos.currentPrice,
      amountEth: pos.amountEth * (sellPercent / 100),
      profitPercent,
      profitEth,
      entryTime: pos.entryTime.toISOString(),
      exitTime,
      holdSeconds,
      exitReason: reason,
      txHash: sellResult.txHash,
    });

    // Track daily loss
    if (profitEth < 0) {
      this.dailyLossEth += Math.abs(profitEth);
    }

    const logLevel = profitPercent > 0 ? "sell" : "stop_loss";
    const sign = profitPercent > 0 ? "+" : "";
    this.log(logLevel, `${reason.toUpperCase()} ${pos.tokenSymbol} | ${sign}${profitPercent.toFixed(2)}% | ${sign}${profitEth.toFixed(6)} ETH`, pos.tokenSymbol);

    this.emit("trade-executed", {
      tokenSymbol: pos.tokenSymbol,
      profitPercent,
      profitEth,
      reason,
      exitTime,
    });

    this.emit("stats-update", await this.buildStats());
  }

  async buildStats() {
    const today = db.getTodayStats();
    const allTime = db.getAllTimeStats();
    const ethPrice = await this.priceMonitor.getEthPrice();
    const usdToIdr = 16000;

    return {
      todayPnlEth: today.pnlEth,
      todayPnlIdr: today.pnlEth * ethPrice * usdToIdr,
      totalTradesDay: today.totalTrades,
      winningTradesDay: today.winningTrades,
      losingTradesDay: today.losingTrades,
      winRateDay: today.totalTrades > 0 ? (today.winningTrades / today.totalTrades) * 100 : 0,
      avgHoldSeconds: allTime.avgHoldSeconds,
      avgProfitPercent: allTime.avgProfitPercent,
      largestWin: allTime.largestWin,
      largestLoss: allTime.largestLoss,
      totalPnlAllTime: allTime.totalPnlEth,
      ethPriceUsd: ethPrice,
      capitalEth: this.config.totalCapitalEth,
      capitalIdr: this.config.totalCapitalEth * ethPrice * usdToIdr,
    };
  }

  private isDailyLossHit(): boolean {
    return this.dailyLossEth >= this.config.maxDailyLossEth;
  }

  private isInCooldown(): boolean {
    if (!this.cooldownUntil) return false;
    if (new Date() >= this.cooldownUntil) {
      this.cooldownUntil = null;
      return false;
    }
    return true;
  }

  private log(level: string, message: string, tokenSymbol: string | null): void {
    db.insertLog({ level, message, tokenSymbol });
    this.emit("log", {
      level,
      message,
      tokenSymbol,
      timestamp: new Date().toISOString(),
    });
    logger.info({ level, message, tokenSymbol }, "ScalpingBot");
  }

  private serializePosition(pos: PositionState, profitPercent: number, holdSeconds: number) {
    return {
      id: Date.now(),
      tokenAddress: pos.tokenAddress,
      tokenSymbol: pos.tokenSymbol,
      tokenName: pos.tokenName,
      entryPrice: pos.entryPrice,
      currentPrice: pos.currentPrice,
      amountEth: pos.amountEth,
      amountTokens: pos.amountTokens,
      profitPercent,
      profitEth: pos.amountEth * (profitPercent / 100),
      entryTime: pos.entryTime.toISOString(),
      holdSeconds,
      tp1Hit: pos.tp1Hit,
      tp2Hit: pos.tp2Hit,
      trailingStopActive: pos.trailingStopActive,
      safetyScore: pos.safetyScore,
      liquidityUsd: pos.liquidityUsd,
      status: pos.status,
    };
  }
}
