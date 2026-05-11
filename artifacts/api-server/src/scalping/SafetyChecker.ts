import axios from "axios";
import { logger } from "../lib/logger.js";

export interface SafetyResult {
  score: number; // 0-100
  isHoneypot: boolean;
  sellTax: number;
  buyTax: number;
  liquidityLocked: boolean;
  ownershipRenounced: boolean;
  isProxyContract: boolean;
  mintingEnabled: boolean;
  warnings: string[];
  passed: boolean;
}

const GOPLUS_URL = "https://api.gopluslabs.io/api/v1";
const BASE_CHAIN_ID = "8453";
const safetyCache = new Map<string, { result: SafetyResult; timestamp: number }>();
const CACHE_TTL = 60000; // 1 minute

export class SafetyChecker {
  private minScore: number;
  private maxSellTax: number;

  constructor(minScore: number, maxSellTax: number) {
    this.minScore = minScore;
    this.maxSellTax = maxSellTax;
  }

  async check(tokenAddress: string): Promise<SafetyResult> {
    const cached = safetyCache.get(tokenAddress.toLowerCase());
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.result;
    }

    const result = await this.checkGoPlus(tokenAddress);
    safetyCache.set(tokenAddress.toLowerCase(), { result, timestamp: Date.now() });
    return result;
  }

  private async checkGoPlus(tokenAddress: string): Promise<SafetyResult> {
    const warnings: string[] = [];
    let score = 100;

    try {
      const response = await axios.get(
        `${GOPLUS_URL}/token_security/${BASE_CHAIN_ID}`,
        {
          params: { contract_addresses: tokenAddress },
          timeout: 6000,
        }
      );

      const result = response.data?.result?.[tokenAddress.toLowerCase()];

      if (!result) {
        logger.warn({ tokenAddress }, "GoPlus returned no data");
        return this.fallbackResult(tokenAddress);
      }

      const isHoneypot = result.is_honeypot === "1";
      const sellTax = parseFloat(result.sell_tax) * 100 || 0;
      const buyTax = parseFloat(result.buy_tax) * 100 || 0;
      const ownershipRenounced = result.owner_address === "0x0000000000000000000000000000000000000000" || result.can_take_back_ownership === "0";
      const mintingEnabled = result.hidden_owner === "1" || result.can_take_back_ownership === "1";
      const isProxyContract = result.is_proxy === "1";
      const liquidityLocked = result.lp_holders?.some((h: any) => h.is_locked === 1) || false;

      // Deductions
      if (isHoneypot) { score -= 60; warnings.push("HONEYPOT DETECTED"); }
      if (sellTax > this.maxSellTax) { score -= 30; warnings.push(`High sell tax: ${sellTax}%`); }
      if (sellTax > 5) { score -= 10; warnings.push(`Sell tax: ${sellTax}%`); }
      if (buyTax > 5) { score -= 10; warnings.push(`Buy tax: ${buyTax}%`); }
      if (!ownershipRenounced) { score -= 15; warnings.push("Ownership not renounced"); }
      if (mintingEnabled) { score -= 20; warnings.push("Minting possible"); }
      if (isProxyContract) { score -= 10; warnings.push("Proxy contract"); }
      if (!liquidityLocked) { score -= 15; warnings.push("Liquidity not locked"); }
      if (result.is_anti_whale === "1") { score += 5; } // Positive signal

      // Holder concentration check
      const holders = result.holders || [];
      const topHolderPercent = parseFloat(holders[0]?.percent) * 100 || 0;
      if (topHolderPercent > 10) { score -= 10; warnings.push(`Top holder owns ${topHolderPercent.toFixed(1)}%`); }
      if (topHolderPercent > 20) { score -= 10; warnings.push("High holder concentration"); }

      score = Math.max(0, Math.min(100, score));
      const passed = score >= this.minScore && !isHoneypot && sellTax <= this.maxSellTax;

      return {
        score,
        isHoneypot,
        sellTax,
        buyTax,
        liquidityLocked,
        ownershipRenounced,
        isProxyContract,
        mintingEnabled,
        warnings,
        passed,
      };
    } catch (err) {
      logger.warn({ err, tokenAddress }, "GoPlus check failed, using fallback");
      return this.fallbackResult(tokenAddress);
    }
  }

  private fallbackResult(tokenAddress: string): SafetyResult {
    // Conservative fallback when API is unavailable
    return {
      score: 50,
      isHoneypot: false,
      sellTax: 0,
      buyTax: 0,
      liquidityLocked: false,
      ownershipRenounced: false,
      isProxyContract: false,
      mintingEnabled: false,
      warnings: ["Safety check unavailable - using conservative score"],
      passed: false, // Fail-safe: don't trade if we can't verify
    };
  }
}
