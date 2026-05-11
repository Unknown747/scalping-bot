import axios from "axios";
import { logger } from "../lib/logger.js";

export interface SafetyResult {
  score: number;
  isHoneypot: boolean;
  sellTax: number;
  buyTax: number;
  liquidityLocked: boolean;
  ownershipRenounced: boolean;
  isProxyContract: boolean;
  mintingEnabled: boolean;
  warnings: string[];
  passed: boolean;
  deployerReputation?: DeployerReputationResult;
}

export interface DeployerReputationResult {
  deployer: string;
  tokensIn24h: number;
  suspicious: boolean;
  reason?: string;
}

const GOPLUS_URL = "https://api.gopluslabs.io/api/v1";
const BLOCKSCOUT_URL = "https://base.blockscout.com/api/v2";
const BASE_CHAIN_ID = "8453";
const safetyCache = new Map<string, { result: SafetyResult; timestamp: number }>();
const deployerCache = new Map<string, { result: DeployerReputationResult; timestamp: number }>();
const CACHE_TTL = 60000;
const DEPLOYER_CACHE_TTL = 300000; // 5 min

export class SafetyChecker {
  private minScore: number;
  private maxSellTax: number;
  private enableDeployerCheck: boolean;
  private maxDeployerTokens24h: number;

  constructor(
    minScore: number,
    maxSellTax: number,
    enableDeployerCheck = true,
    maxDeployerTokens24h = 3
  ) {
    this.minScore = minScore;
    this.maxSellTax = maxSellTax;
    this.enableDeployerCheck = enableDeployerCheck;
    this.maxDeployerTokens24h = maxDeployerTokens24h;
  }

  updateSettings(
    minScore: number,
    maxSellTax: number,
    enableDeployerCheck: boolean,
    maxDeployerTokens24h: number
  ): void {
    this.minScore = minScore;
    this.maxSellTax = maxSellTax;
    this.enableDeployerCheck = enableDeployerCheck;
    this.maxDeployerTokens24h = maxDeployerTokens24h;
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
      const ownershipRenounced =
        result.owner_address === "0x0000000000000000000000000000000000000000" ||
        result.can_take_back_ownership === "0";
      const mintingEnabled =
        result.hidden_owner === "1" || result.can_take_back_ownership === "1";
      const isProxyContract = result.is_proxy === "1";
      const liquidityLocked =
        result.lp_holders?.some((h: any) => h.is_locked === 1) || false;
      const deployerAddress: string = result.creator_address || "";

      // Deductions
      if (isHoneypot) { score -= 60; warnings.push("HONEYPOT DETECTED"); }
      if (sellTax > this.maxSellTax) { score -= 30; warnings.push(`High sell tax: ${sellTax}%`); }
      if (sellTax > 5) { score -= 10; warnings.push(`Sell tax: ${sellTax}%`); }
      if (buyTax > 5) { score -= 10; warnings.push(`Buy tax: ${buyTax}%`); }
      if (!ownershipRenounced) { score -= 15; warnings.push("Ownership not renounced"); }
      if (mintingEnabled) { score -= 20; warnings.push("Minting possible"); }
      if (isProxyContract) { score -= 10; warnings.push("Proxy contract"); }
      if (!liquidityLocked) { score -= 15; warnings.push("Liquidity not locked"); }
      if (result.is_anti_whale === "1") { score += 5; }

      // Holder concentration check
      const holders = result.holders || [];
      const topHolderPercent = parseFloat(holders[0]?.percent) * 100 || 0;
      if (topHolderPercent > 10) { score -= 10; warnings.push(`Top holder owns ${topHolderPercent.toFixed(1)}%`); }
      if (topHolderPercent > 20) { score -= 10; warnings.push("High holder concentration"); }

      // Deployer reputation check
      let deployerReputation: DeployerReputationResult | undefined;
      if (this.enableDeployerCheck && deployerAddress) {
        deployerReputation = await this.checkDeployerReputation(deployerAddress);
        if (deployerReputation.suspicious) {
          score -= 25;
          warnings.push(`Suspicious deployer: ${deployerReputation.reason}`);
        }
      }

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
        deployerReputation,
      };
    } catch (err) {
      logger.warn({ err, tokenAddress }, "GoPlus check failed, using fallback");
      return this.fallbackResult(tokenAddress);
    }
  }

  async checkDeployerReputation(deployerAddress: string): Promise<DeployerReputationResult> {
    const cacheKey = deployerAddress.toLowerCase();
    const cached = deployerCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < DEPLOYER_CACHE_TTL) {
      return cached.result;
    }

    const defaultResult: DeployerReputationResult = {
      deployer: deployerAddress,
      tokensIn24h: 0,
      suspicious: false,
    };

    try {
      // Query Blockscout for contracts deployed by this address in last 24 hours
      const response = await axios.get(
        `${BLOCKSCOUT_URL}/addresses/${deployerAddress}/transactions`,
        {
          params: {
            filter: "to | from",
            type: "contract_creation",
          },
          timeout: 5000,
        }
      );

      const txs: any[] = response.data?.items || [];
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;

      const recentDeployments = txs.filter((tx: any) => {
        const ts = new Date(tx.timestamp).getTime();
        return ts > cutoff && tx.created_contract;
      });

      const tokensIn24h = recentDeployments.length;
      const suspicious = tokensIn24h > this.maxDeployerTokens24h;

      const result: DeployerReputationResult = {
        deployer: deployerAddress,
        tokensIn24h,
        suspicious,
        reason: suspicious
          ? `Deployer launched ${tokensIn24h} tokens in last 24h (max: ${this.maxDeployerTokens24h})`
          : undefined,
      };

      deployerCache.set(cacheKey, { result, timestamp: Date.now() });

      if (suspicious) {
        logger.warn({ deployerAddress, tokensIn24h }, "Suspicious deployer detected");
      }

      return result;
    } catch (err) {
      logger.debug({ err, deployerAddress }, "Deployer check failed — skipping");
      const result = { ...defaultResult };
      deployerCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }
  }

  private fallbackResult(tokenAddress: string): SafetyResult {
    // When GoPlus is unavailable, give a neutral score that lets the bot proceed
    // with caution rather than blocking all trades. The other filters (liquidity,
    // momentum, meme score) still provide protection.
    const fallbackScore = Math.max(this.minScore, 60);
    return {
      score: fallbackScore,
      isHoneypot: false,
      sellTax: 0,
      buyTax: 0,
      liquidityLocked: false,
      ownershipRenounced: false,
      isProxyContract: false,
      mintingEnabled: false,
      warnings: ["Safety API unavailable — proceeding with fallback score"],
      passed: true,
    };
  }
}
