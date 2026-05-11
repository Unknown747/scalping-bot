import { logger } from "../lib/logger.js";
import { TokenScanner, type TokenData } from "./TokenScanner.js";
import { SafetyChecker } from "./SafetyChecker.js";
import { PriceMonitor } from "./PriceMonitor.js";
import { SwapExecutor } from "./SwapExecutor.js";
import { DEXAggregator } from "./DEXAggregator.js";
import { TelegramNotifier } from "./TelegramNotifier.js";
import { calculateMemeScore } from "./MemeScorer.js";
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
  memeScore: number;
  liquidityUsd: number;
  status: "open" | "closing";
  peakProfitPercent: number;
  dexUsed?: string;
  dexUrl?: string | null;
  marketData?: {
    volume5mUsd: number;
    liquidityUsd: number;
    priceChange5m: number;
  };
}

// CooldownManager: tracks per-close cooldown and buy-rate limiting
class CooldownManager {
  private lastCloseTime: number | null = null;
  private recentBuyTimes: number[] = [];

  recordClose(): void {
    this.lastCloseTime = Date.now();
  }

  recordBuy(): void {
    this.recentBuyTimes.push(Date.now());
    // Keep only last 10 entries to prevent unbounded growth
    if (this.recentBuyTimes.length > 10) {
      this.recentBuyTimes = this.recentBuyTimes.slice(-10);
    }
  }

  isInPostCloseCooldown(cooldownSeconds: number): boolean {
    if (!this.lastCloseTime) return false;
    return Date.now() - this.lastCloseTime < cooldownSeconds * 1000;
  }

  getRemainingCooldown(cooldownSeconds: number): number {
    if (!this.lastCloseTime) return 0;
    const elapsed = Date.now() - this.lastCloseTime;
    const remaining = cooldownSeconds * 1000 - elapsed;
    return Math.max(0, Math.ceil(remaining / 1000));
  }

  getBuysInWindow(windowMs = 300000): number {
    const cutoff = Date.now() - windowMs;
    this.recentBuyTimes = this.recentBuyTimes.filter((t) => t > cutoff);
    return this.recentBuyTimes.length;
  }

  isOverBuyRate(maxBuys: number, windowMs = 300000): boolean {
    return this.getBuysInWindow(windowMs) >= maxBuys;
  }
}

type EventEmitter = (event: string, data: unknown) => void;

export class ScalpingBot {
  private config: ScalpingConfigData;
  private running = false;
  private startedAt: Date | null = null;
  private positions = new Map<string, PositionState>();
  private dailyLossEth = 0;
  private cooldownUntil: Date | null = null;
  private tokenBlacklist = new Map<string, Date>();
  private scanInterval: NodeJS.Timeout | null = null;
  private priceInterval: NodeJS.Timeout | null = null;
  private dailySummaryInterval: NodeJS.Timeout | null = null;

  private tokenScanner: TokenScanner;
  private safetyChecker: SafetyChecker;
  private priceMonitor: PriceMonitor;
  private swapExecutor: SwapExecutor;
  private dexAggregator: DEXAggregator;
  private telegram: TelegramNotifier;
  private cooldownManager: CooldownManager;

  private accumulatedProfitEth = 0;

  private emit: EventEmitter;

  constructor(emit: EventEmitter) {
    this.config = this.loadConfig();
    this.emit = emit;
    this.tokenScanner = new TokenScanner(this.config);
    this.safetyChecker = new SafetyChecker(
      this.config.minSafetyScore,
      this.config.maxSellTaxPercent,
      this.config.enableDeployerCheck,
      this.config.maxDeployerTokens24h
    );
    this.priceMonitor = new PriceMonitor();
    this.swapExecutor = new SwapExecutor(this.config);
    this.dexAggregator = new DEXAggregator(this.config.enableMultiDEX);
    this.telegram = new TelegramNotifier({
      botToken: this.config.telegramBotToken,
      chatId: this.config.telegramChatId,
      enabled: this.config.enableTelegram,
    });
    this.cooldownManager = new CooldownManager();
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
    this.dexAggregator.setEnabled(this.config.enableMultiDEX);
    this.safetyChecker.updateSettings(
      this.config.minSafetyScore,
      this.config.maxSellTaxPercent,
      this.config.enableDeployerCheck,
      this.config.maxDeployerTokens24h
    );
    this.telegram.updateConfig({
      botToken: this.config.telegramBotToken,
      chatId: this.config.telegramChatId,
      enabled: this.config.enableTelegram,
    });
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
    const buysInWindow = this.cooldownManager.getBuysInWindow();
    const postCloseCooldown = this.cooldownManager.getRemainingCooldown(this.config.cooldownAfterCloseSeconds);

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
      buysInLastFiveMin: buysInWindow,
      postCloseCooldownSeconds: postCloseCooldown,
      accumulatedProfitEth: this.accumulatedProfitEth,
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
        memeScore: 0,
        liquidityUsd: p.liquidityUsd,
        status: p.status,
        peakProfitPercent: 0,
      });
      this.priceMonitor.addToken(p.tokenAddress);
    }

    this.scanInterval = setInterval(
      () => this.runScanCycle().catch((e) => logger.error({ e }, "Scan cycle error")),
      this.config.scanIntervalSeconds * 1000
    );

    this.priceInterval = setInterval(
      () => this.runPriceCycle().catch((e) => logger.error({ e }, "Price cycle error")),
      this.config.priceCheckIntervalSeconds * 1000
    );

    // Daily summary at midnight
    this.scheduleDailySummary();

    this.runScanCycle().catch(() => {});
    this.runPriceCycle().catch(() => {});
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.startedAt = null;
    if (this.scanInterval) clearInterval(this.scanInterval);
    if (this.priceInterval) clearInterval(this.priceInterval);
    if (this.dailySummaryInterval) clearInterval(this.dailySummaryInterval);
    this.scanInterval = null;
    this.priceInterval = null;
    this.dailySummaryInterval = null;
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

  private scheduleDailySummary(): void {
    // Send daily summary every 24 hours
    this.dailySummaryInterval = setInterval(async () => {
      try {
        const today = db.getTodayStats();
        const ethPrice = await this.priceMonitor.getEthPrice();
        const usdToIdr = 16000;

        await this.telegram.sendDailySummary({
          totalPnlEth: today.pnlEth,
          totalPnlIdr: today.pnlEth * ethPrice * usdToIdr,
          totalTrades: today.totalTrades,
          winningTrades: today.winningTrades,
          losingTrades: today.losingTrades,
          winRate: today.totalTrades > 0 ? (today.winningTrades / today.totalTrades) * 100 : 0,
          ethPrice,
        });
      } catch (err) {
        logger.warn({ err }, "Daily summary failed");
      }
    }, 24 * 60 * 60 * 1000);
  }

  private async runScanCycle(): Promise<void> {
    if (!this.running) return;
    if (this.isDailyLossHit()) {
      this.log("warn", "Daily loss limit hit — not scanning for new tokens", null);
      return;
    }
    if (this.isInCooldown()) return;
    if (this.positions.size >= this.config.maxConcurrentPositions) return;

    // Anti-FOMO: post-close cooldown
    if (this.cooldownManager.isInPostCloseCooldown(this.config.cooldownAfterCloseSeconds)) {
      const remaining = this.cooldownManager.getRemainingCooldown(this.config.cooldownAfterCloseSeconds);
      this.log("info", `Post-close cooldown active — ${remaining}s remaining`, null);
      return;
    }

    // Anti-FOMO: max buys per 5 min
    if (this.cooldownManager.isOverBuyRate(this.config.maxBuysPerFiveMinutes)) {
      const buys = this.cooldownManager.getBuysInWindow();
      this.log("info", `Buy rate limit reached (${buys}/${this.config.maxBuysPerFiveMinutes} per 5m)`, null);
      return;
    }

    try {
      const allTokens = await this.tokenScanner.scanNewTokens();
      const filtered = this.tokenScanner.filterTokens(allTokens);

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

        // Calculate meme score for display
        const buySellRatio =
          token.txns5m.sells > 0
            ? token.txns5m.buys / token.txns5m.sells
            : token.txns5m.buys > 0
            ? 3
            : 1;
        const memeScoreResult = calculateMemeScore(
          {
            ageMinutes: token.ageMinutes,
            liquidityUSD: token.liquidityUsd,
            volume5mUSD: token.volume5mUsd,
            priceChange5m: token.priceChange5m,
            buySellRatio5m: buySellRatio,
          },
          this.config.minMemeScore
        );

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
          memeScore: memeScoreResult.score,
          passedFilters: passed,
          scannedAt: new Date().toISOString(),
          dexUrl: token.dexUrl,
        });
      }

      for (const token of filtered) {
        if (this.positions.size >= this.config.maxConcurrentPositions) break;
        if (this.positions.has(token.address.toLowerCase())) continue;

        await this.tryEnter(token);
      }

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

      // Peak profit tracking
      if (profitPercent > position.peakProfitPercent) {
        position.peakProfitPercent = profitPercent;
      }

      const exitReason = this.checkExitConditions(position, profitPercent, holdSeconds);

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
        // Send force-exit specific Telegram alert
        if (exitReason === "force_exit") {
          await this.telegram.sendForceExitAlert({
            symbol: position.tokenSymbol,
            profitPercent,
            peakProfitPercent: position.peakProfitPercent,
            profitEth: position.amountEth * (profitPercent / 100),
          });
        }

        const sellPercent = this.getSellPercent(exitReason, position);
        await this.closePosition(address, sellPercent, exitReason);
      }
    }
  }

  private checkExitConditions(pos: PositionState, profitPercent: number, holdSeconds: number): string | null {
    const holdMinutes = holdSeconds / 60;

    if (holdMinutes >= this.config.maxHoldMinutes) return "max_hold";

    if (profitPercent <= -this.config.stopLossPercent) return "stop_loss";

    // Break-even stop: after TP1 is hit, exit if price drops back to entry
    if (this.config.enableBreakEvenAfterTP1 && pos.tp1Hit && profitPercent <= 0) {
      this.log("info", `Break-even exit ${pos.tokenSymbol}: price returned to entry after TP1`, pos.tokenSymbol);
      return "stop_loss";
    }

    // Force exit: profit dropped more than X% from peak
    if (
      this.config.enablePeakProfitExit &&
      pos.peakProfitPercent > 0 &&
      profitPercent > 0
    ) {
      const dropFromPeak = pos.peakProfitPercent - profitPercent;
      const dropPercent = (dropFromPeak / pos.peakProfitPercent) * 100;
      if (dropPercent >= this.config.peakProfitDropPercent) {
        this.log(
          "warn",
          `Force exit ${pos.tokenSymbol}: peak ${pos.peakProfitPercent.toFixed(2)}% → now ${profitPercent.toFixed(2)}% (drop: ${dropPercent.toFixed(0)}%)`,
          pos.tokenSymbol
        );
        return "force_exit";
      }
    }

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
      default: return 100;
    }
  }

  private async tryEnter(token: TokenData): Promise<void> {
    // Meme Score Filter
    const buySellRatio =
      token.txns5m.sells > 0
        ? token.txns5m.buys / token.txns5m.sells
        : token.txns5m.buys > 0
        ? 3
        : 1;

    const memeScore = calculateMemeScore(
      {
        ageMinutes: token.ageMinutes,
        liquidityUSD: token.liquidityUsd,
        volume5mUSD: token.volume5mUsd,
        priceChange5m: token.priceChange5m,
        buySellRatio5m: buySellRatio,
      },
      this.config.minMemeScore
    );

    if (this.config.enableMemeScore && !memeScore.passed) {
      this.log(
        "info",
        `${token.symbol} meme score too low: ${memeScore.score}/100 (min: ${this.config.minMemeScore})`,
        token.symbol
      );
      return;
    }

    // 1h Momentum Confirmation
    if (this.config.require1hMomentum && token.priceChange1h <= 0) {
      this.log("info", `${token.symbol} rejected: 1h momentum negative (${token.priceChange1h.toFixed(1)}%)`, token.symbol);
      return;
    }

    // Token Blacklist: skip recent stop-loss tokens
    if (this.isBlacklisted(token.address)) {
      this.log("info", `${token.symbol} blacklisted — cooling off after recent stop-loss`, token.symbol);
      return;
    }

    this.log(
      "info",
      `Evaluating ${token.symbol} — MemeScore: ${memeScore.score}/100 | 5m: ${token.priceChange5m.toFixed(1)}% | liq: $${token.liquidityUsd.toFixed(0)}`,
      token.symbol
    );

    // Safety check
    const safety = await this.safetyChecker.check(token.address);
    if (!safety.passed) {
      this.log("warn", `${token.symbol} failed safety check (score: ${safety.score}): ${safety.warnings.join(", ")}`, token.symbol);
      return;
    }

    // DEX Aggregator: find best route
    const marketData = {
      volume5mUsd: token.volume5mUsd,
      liquidityUsd: token.liquidityUsd,
      priceChange5m: token.priceChange5m,
    };
    const bestRoute = await this.dexAggregator.getBestRoute(token.address, this.config.maxTradeAmountEth);

    const amountEth = this.getDynamicPositionSize(safety.score, memeScore.score);
    let buyResult;

    // TWAP vs single buy
    if (this.config.enableTWAP) {
      const twapResult = await this.swapExecutor.executeTWAP(
        token.address,
        amountEth,
        bestRoute.routerAddress,
        marketData
      );
      if (twapResult.successfulSlices === 0) {
        this.log("error", `TWAP buy failed for ${token.symbol}: all slices failed`, token.symbol);
        return;
      }
      // Aggregate results into a single SwapResult
      const totalAmountOut = twapResult.results
        .filter((r) => r.success)
        .reduce((sum, r) => sum + r.amountOut, 0n);
      buyResult = {
        success: true,
        txHash: twapResult.results.find((r) => r.success)?.txHash || null,
        amountIn: BigInt(Math.floor(amountEth * 1e18)),
        amountOut: totalAmountOut,
        gasUsed: 0n,
      };
      this.log(
        "info",
        `TWAP completed for ${token.symbol}: ${twapResult.successfulSlices}/${twapResult.totalSlices} slices via ${bestRoute.dex}`,
        token.symbol
      );
    } else {
      buyResult = await this.swapExecutor.buyToken(
        token.address,
        amountEth,
        bestRoute.routerAddress,
        marketData
      );
    }

    if (!buyResult.success) {
      this.log("error", `Buy failed for ${token.symbol}: ${buyResult.error}`, token.symbol);
      return;
    }

    // Track buy for rate limiting
    this.cooldownManager.recordBuy();

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
      memeScore: memeScore.score,
      liquidityUsd: token.liquidityUsd,
      status: "open",
      peakProfitPercent: 0,
      dexUsed: bestRoute.dex,
      dexUrl: token.dexUrl,
      marketData,
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

    const logMsg = `Bought ${token.symbol} @ $${token.priceUsd.toFixed(8)} | ${amountEth} ETH | Safety: ${safety.score}/100 | Meme: ${memeScore.score}/100 | DEX: ${bestRoute.dex}`;
    this.log("buy", logMsg, token.symbol);
    this.emit("scalp-alert", { type: "buy", message: `Bought ${token.symbol}` });
    this.emit("position-update", this.serializePosition(position, 0, 0));

    // Telegram buy alert
    await this.telegram.sendBuyAlert({
      symbol: token.symbol,
      tokenAddress: token.address,
      priceUsd: token.priceUsd,
      amountEth,
      safetyScore: safety.score,
      memeScore: memeScore.score,
      dex: bestRoute.dex,
      dexUrl: token.dexUrl,
    });
  }

  async closePosition(tokenAddress: string, sellPercent: number, reason: string): Promise<void> {
    const pos = this.positions.get(tokenAddress.toLowerCase());
    if (!pos || pos.status === "closing") return;

    pos.status = "closing";
    const holdSeconds = Math.floor((Date.now() - pos.entryTime.getTime()) / 1000);
    const profitPercent = ((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
    const profitEth = pos.amountEth * (profitPercent / 100) * (sellPercent / 100);

    if (reason === "tp1") pos.tp1Hit = true;
    if (reason === "tp2") pos.tp2Hit = true;

    if (sellPercent < 100) {
      pos.amountEth -= pos.amountEth * (sellPercent / 100);
      pos.amountTokens -= pos.amountTokens * (sellPercent / 100);
      pos.status = "open";
    } else {
      this.positions.delete(tokenAddress.toLowerCase());
      this.priceMonitor.removeToken(tokenAddress);
      db.deletePosition(tokenAddress);
      // Record close for cooldown
      this.cooldownManager.recordClose();
      // Blacklist token if it hit stop-loss to avoid re-entering
      if ((reason === "stop_loss" || reason === "emergency") && this.config.enableTokenBlacklist && this.config.tokenBlacklistMinutes > 0) {
        this.addToBlacklist(tokenAddress);
      }
    }

    const sellResult = await this.swapExecutor.sellToken(
      tokenAddress,
      BigInt(Math.floor(pos.amountTokens * (sellPercent / 100))),
      pos.amountEth * (sellPercent / 100)
    );

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

    if (profitEth < 0) {
      this.dailyLossEth += Math.abs(profitEth);
    }

    // Auto-compounding: accumulate profits and grow trade size
    if (this.config.enableAutoCompound && profitEth > 0) {
      this.accumulatedProfitEth += profitEth;
      if (this.accumulatedProfitEth >= this.config.compoundThresholdEth) {
        this.compoundProfit();
      }
    }

    const logLevel = profitPercent > 0 ? "sell" : "stop_loss";
    const sign = profitPercent > 0 ? "+" : "";
    this.log(
      logLevel,
      `${reason.toUpperCase()} ${pos.tokenSymbol} | ${sign}${profitPercent.toFixed(2)}% | ${sign}${profitEth.toFixed(6)} ETH`,
      pos.tokenSymbol
    );

    // Telegram sell alert (only for full closes, not partial)
    if (sellPercent === 100) {
      if (reason === "stop_loss") {
        await this.telegram.sendStopLossAlert({
          symbol: pos.tokenSymbol,
          profitPercent,
          profitEth,
        });
      } else if (reason !== "force_exit") {
        // force_exit alert sent before close
        await this.telegram.sendSellAlert({
          symbol: pos.tokenSymbol,
          profitPercent,
          profitEth,
          reason,
          txHash: sellResult.txHash,
        });
      }
    }

    this.emit("trade-executed", {
      tokenSymbol: pos.tokenSymbol,
      profitPercent,
      profitEth,
      reason,
      exitTime,
    });

    this.emit("stats-update", await this.buildStats());
  }

  private compoundProfit(): void {
    const addedEth = this.accumulatedProfitEth;
    const newTradeSize = Math.min(
      this.config.maxTradeAmountEth + addedEth,
      this.config.totalCapitalEth * 0.1 // cap at 10% of capital per trade
    );
    this.accumulatedProfitEth = 0;

    this.log(
      "info",
      `Auto-compound: +${addedEth.toFixed(6)} ETH profit → new trade size: ${newTradeSize.toFixed(6)} ETH`,
      null
    );

    this.saveConfig({ maxTradeAmountEth: newTradeSize });

    this.telegram
      .sendRawMessage(
        `🔄 *Auto-Compound*\nProfit compounded: +${addedEth.toFixed(6)} ETH\nNew trade size: ${newTradeSize.toFixed(6)} ETH`
      )
      .catch(() => {});
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
      accumulatedProfitEth: this.accumulatedProfitEth,
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

  private isBlacklisted(tokenAddress: string): boolean {
    const until = this.tokenBlacklist.get(tokenAddress.toLowerCase());
    if (!until) return false;
    if (new Date() >= until) {
      this.tokenBlacklist.delete(tokenAddress.toLowerCase());
      return false;
    }
    return true;
  }

  private addToBlacklist(tokenAddress: string): void {
    if (this.config.tokenBlacklistMinutes <= 0) return;
    const until = new Date(Date.now() + this.config.tokenBlacklistMinutes * 60 * 1000);
    this.tokenBlacklist.set(tokenAddress.toLowerCase(), until);
    this.log("info", `${tokenAddress.slice(0, 8)}… blacklisted for ${this.config.tokenBlacklistMinutes}m`, null);
  }

  private getDynamicPositionSize(safetyScore: number, memeScore: number): number {
    if (!this.config.enableDynamicPositionSizing) return this.config.maxTradeAmountEth;
    // Combined confidence: 0.0 (both 0) → 1.0 (both 100)
    const confidence = (safetyScore + memeScore) / 200;
    // Scale linearly: base × (1 + confidence × (multiplier - 1))
    const boost = confidence * (this.config.maxPositionSizeMultiplier - 1);
    const amount = this.config.maxTradeAmountEth * (1 + boost);
    // Hard cap: 10% of total capital per trade
    const capped = Math.min(amount, this.config.totalCapitalEth * 0.1);
    return Math.round(capped * 1e6) / 1e6;
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
      memeScore: pos.memeScore,
      peakProfitPercent: pos.peakProfitPercent,
      liquidityUsd: pos.liquidityUsd,
      dexUsed: pos.dexUsed,
      status: pos.status,
    };
  }
}
