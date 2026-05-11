import axios from "axios";
import { logger } from "../lib/logger.js";
import type { ScalpingConfigData } from "./config.js";

export interface TokenData {
  address: string;
  symbol: string;
  name: string;
  priceUsd: number;
  priceChange5m: number;
  priceChange1h: number;
  priceChange24h: number;
  volume5mUsd: number;
  volume1hUsd: number;
  liquidityUsd: number;
  marketCapUsd: number | null;
  ageMinutes: number;
  holderCount: number | null;
  dexUrl: string | null;
  pairAddress: string;
  txns5m: { buys: number; sells: number };
}

const DEXSCREENER_URL = "https://api.dexscreener.com/latest/dex";
const GECKO_URL = "https://api.geckoterminal.com/api/v2";

// Simple in-memory cache to avoid rate limits
const tokenCache = new Map<string, { data: TokenData[]; timestamp: number }>();
const CACHE_TTL_MS = 5000;

export class TokenScanner {
  private config: ScalpingConfigData;
  private seenAddresses = new Set<string>();

  constructor(config: ScalpingConfigData) {
    this.config = config;
  }

  updateConfig(config: ScalpingConfigData): void {
    this.config = config;
  }

  async scanNewTokens(): Promise<TokenData[]> {
    const results: TokenData[] = [];
    
    try {
      const dexScreenerTokens = await this.scanDexScreener();
      results.push(...dexScreenerTokens);
    } catch (err) {
      logger.warn({ err }, "DexScreener scan failed");
    }

    try {
      const geckoTokens = await this.scanGeckoTerminal();
      // Deduplicate by address
      for (const token of geckoTokens) {
        if (!results.find(r => r.address.toLowerCase() === token.address.toLowerCase())) {
          results.push(token);
        }
      }
    } catch (err) {
      logger.warn({ err }, "GeckoTerminal scan failed");
    }

    return results;
  }

  private async scanDexScreener(): Promise<TokenData[]> {
    const cacheKey = "dexscreener_base_new";
    const cached = tokenCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      // Get new/trending pairs on Base network
      const response = await axios.get(`${DEXSCREENER_URL}/pairs/base`, {
        params: { q: "meme" },
        timeout: 8000,
      });

      const pairs = response.data?.pairs || [];
      const tokens: TokenData[] = [];

      for (const pair of pairs) {
        if (!pair?.baseToken?.address) continue;

        const ageMinutes = this.calcAgeMinutes(pair.pairCreatedAt);
        if (ageMinutes > this.config.maxTokenAgeMinutes * 2) continue;

        const token: TokenData = {
          address: pair.baseToken.address,
          symbol: pair.baseToken.symbol || "UNKNOWN",
          name: pair.baseToken.name || pair.baseToken.symbol || "UNKNOWN",
          priceUsd: parseFloat(pair.priceUsd) || 0,
          priceChange5m: pair.priceChange?.m5 || 0,
          priceChange1h: pair.priceChange?.h1 || 0,
          priceChange24h: pair.priceChange?.h24 || 0,
          volume5mUsd: pair.volume?.m5 || 0,
          volume1hUsd: pair.volume?.h1 || 0,
          liquidityUsd: pair.liquidity?.usd || 0,
          marketCapUsd: pair.marketCap ? parseFloat(pair.marketCap) : null,
          ageMinutes,
          holderCount: null,
          dexUrl: pair.url || null,
          pairAddress: pair.pairAddress || "",
          txns5m: {
            buys: pair.txns?.m5?.buys || 0,
            sells: pair.txns?.m5?.sells || 0,
          },
        };

        tokens.push(token);
      }

      tokenCache.set(cacheKey, { data: tokens, timestamp: Date.now() });
      return tokens;
    } catch (err) {
      logger.warn({ err }, "DexScreener API error");
      return [];
    }
  }

  private async scanGeckoTerminal(): Promise<TokenData[]> {
    const cacheKey = "gecko_base_new";
    const cached = tokenCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const response = await axios.get(
        `${GECKO_URL}/networks/base/new_pools`,
        {
          params: { page: 1 },
          timeout: 8000,
          headers: { Accept: "application/json" },
        }
      );

      const pools = response.data?.data || [];
      const tokens: TokenData[] = [];

      for (const pool of pools) {
        const attrs = pool.attributes;
        if (!attrs) continue;

        const baseToken = pool.relationships?.base_token?.data;
        if (!baseToken) continue;

        const ageMinutes = this.calcAgeFromStr(attrs.pool_created_at);

        const token: TokenData = {
          address: baseToken.id?.split("_")[1] || "",
          symbol: attrs.name?.split(" / ")[0] || "UNKNOWN",
          name: attrs.name?.split(" / ")[0] || "UNKNOWN",
          priceUsd: parseFloat(attrs.base_token_price_usd) || 0,
          priceChange5m: parseFloat(attrs.price_change_percentage?.m5) || 0,
          priceChange1h: parseFloat(attrs.price_change_percentage?.h1) || 0,
          priceChange24h: parseFloat(attrs.price_change_percentage?.h24) || 0,
          volume5mUsd: parseFloat(attrs.volume_usd?.m5) || 0,
          volume1hUsd: parseFloat(attrs.volume_usd?.h1) || 0,
          liquidityUsd: parseFloat(attrs.reserve_in_usd) || 0,
          marketCapUsd: null,
          ageMinutes,
          holderCount: null,
          dexUrl: `https://www.geckoterminal.com/base/pools/${pool.id?.split("_")[1]}`,
          pairAddress: pool.id?.split("_")[1] || "",
          txns5m: {
            buys: parseInt(attrs.transactions?.m5?.buys) || 0,
            sells: parseInt(attrs.transactions?.m5?.sells) || 0,
          },
        };

        if (token.address) {
          tokens.push(token);
        }
      }

      tokenCache.set(cacheKey, { data: tokens, timestamp: Date.now() });
      return tokens;
    } catch (err) {
      logger.warn({ err }, "GeckoTerminal API error");
      return [];
    }
  }

  filterTokens(tokens: TokenData[]): TokenData[] {
    return tokens.filter((token) => {
      if (token.ageMinutes > this.config.maxTokenAgeMinutes) return false;
      if (token.liquidityUsd < this.config.minLiquidityUsd) return false;
      if (token.volume5mUsd < this.config.min5mVolumeUsd) return false;
      if (token.priceChange5m < this.config.minMomentumPercent) return false;
      if (token.priceUsd <= 0) return false;
      return true;
    });
  }

  private calcAgeMinutes(pairCreatedAt: number | null): number {
    if (!pairCreatedAt) return 9999;
    return (Date.now() - pairCreatedAt) / 60000;
  }

  private calcAgeFromStr(createdAt: string | null): number {
    if (!createdAt) return 9999;
    return (Date.now() - new Date(createdAt).getTime()) / 60000;
  }
}
