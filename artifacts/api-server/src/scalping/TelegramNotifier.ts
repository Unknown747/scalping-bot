import { logger } from "../lib/logger.js";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
}

export class TelegramNotifier {
  private botToken: string;
  private chatId: string;
  private enabled: boolean;
  private baseUrl: string;

  constructor(config: TelegramConfig) {
    this.botToken = config.botToken;
    this.chatId = config.chatId;
    this.enabled = config.enabled && !!config.botToken && !!config.chatId;
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  updateConfig(config: TelegramConfig): void {
    this.botToken = config.botToken;
    this.chatId = config.chatId;
    this.enabled = config.enabled && !!config.botToken && !!config.chatId;
    this.baseUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  async sendBuyAlert(params: {
    symbol: string;
    tokenAddress: string;
    priceUsd: number;
    amountEth: number;
    safetyScore: number;
    memeScore?: number;
    dex?: string;
    dexUrl?: string | null;
  }): Promise<void> {
    const lines = [
      `🟢 *BUY — ${this.esc(params.symbol)}*`,
      `💰 Price: $${params.priceUsd.toFixed(8)}`,
      `📦 Size: ${params.amountEth.toFixed(4)} ETH`,
      `🛡 Safety: ${params.safetyScore}/100`,
      params.memeScore !== undefined ? `🎯 Meme Score: ${params.memeScore}/100` : null,
      params.dex ? `🔀 DEX: ${this.esc(params.dex)}` : null,
      `📍 \`${params.tokenAddress}\``,
      params.dexUrl ? `[View Chart](${params.dexUrl})` : null,
    ]
      .filter(Boolean)
      .join("\n");

    await this.send(lines);
  }

  async sendSellAlert(params: {
    symbol: string;
    profitPercent: number;
    profitEth: number;
    reason: string;
    txHash?: string | null;
  }): Promise<void> {
    const isProfit = params.profitPercent > 0;
    const emoji = isProfit ? "🟢" : "🔴";
    const sign = isProfit ? "+" : "";
    const reasonMap: Record<string, string> = {
      tp1: "TP1",
      tp2: "TP2",
      tp3: "TP3",
      trailing_stop: "Trailing Stop",
      stop_loss: "Stop Loss",
      max_hold: "Max Hold Time",
      emergency: "Emergency Stop",
      force_exit: "Force Exit (Peak Drop)",
    };

    const lines = [
      `${emoji} *SELL — ${this.esc(params.symbol)}*`,
      `📊 Reason: ${reasonMap[params.reason] || params.reason}`,
      `${isProfit ? "💚" : "🔴"} PnL: ${sign}${params.profitPercent.toFixed(2)}% (${sign}${params.profitEth.toFixed(6)} ETH)`,
      params.txHash ? `🔗 [TX](https://basescan.org/tx/${params.txHash})` : null,
    ]
      .filter(Boolean)
      .join("\n");

    await this.send(lines);
  }

  async sendForceExitAlert(params: {
    symbol: string;
    profitPercent: number;
    peakProfitPercent: number;
    profitEth: number;
  }): Promise<void> {
    const lines = [
      `⚠️ *FORCE EXIT — ${this.esc(params.symbol)}*`,
      `📉 Peak profit dropped: ${params.peakProfitPercent.toFixed(2)}% → ${params.profitPercent.toFixed(2)}%`,
      `💰 Secured: +${params.profitEth.toFixed(6)} ETH`,
    ].join("\n");

    await this.send(lines);
  }

  async sendStopLossAlert(params: {
    symbol: string;
    profitPercent: number;
    profitEth: number;
  }): Promise<void> {
    const lines = [
      `🛑 *STOP LOSS — ${this.esc(params.symbol)}*`,
      `📉 Loss: ${params.profitPercent.toFixed(2)}% (${params.profitEth.toFixed(6)} ETH)`,
    ].join("\n");

    await this.send(lines);
  }

  async sendDailySummary(params: {
    totalPnlEth: number;
    totalPnlIdr: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    ethPrice: number;
  }): Promise<void> {
    const isProfit = params.totalPnlEth >= 0;
    const sign = isProfit ? "+" : "";
    const lines = [
      `📊 *Daily Summary*`,
      `${isProfit ? "💚" : "🔴"} PnL: ${sign}${params.totalPnlEth.toFixed(6)} ETH (~${sign}Rp ${params.totalPnlIdr.toLocaleString("id-ID", { maximumFractionDigits: 0 })})`,
      `📈 Trades: ${params.totalTrades} total | ${params.winningTrades}W / ${params.losingTrades}L`,
      `🎯 Win Rate: ${params.winRate.toFixed(1)}%`,
      `💎 ETH Price: $${params.ethPrice.toFixed(0)}`,
    ].join("\n");

    await this.send(lines);
  }

  async sendRawMessage(text: string): Promise<void> {
    await this.send(text);
  }

  private esc(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
  }

  private async send(text: string): Promise<void> {
    if (!this.enabled) return;

    try {
      const url = `${this.baseUrl}/sendMessage`;
      const body = JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      });

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        const err = await res.text();
        logger.warn({ err, status: res.status }, "Telegram send failed");
      }
    } catch (err) {
      logger.warn({ err }, "Telegram notification failed (non-critical)");
    }
  }
}
