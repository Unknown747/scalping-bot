import axios from "axios";
import { logger } from "../lib/logger.js";
import type { TokenData } from "./TokenScanner.js";

const GECKO_BASE_URL = "https://api.geckoterminal.com/api/v2";
const NETWORK = "base";

const geckoCache = new Map<string, { data: TokenData[]; timestamp: number }>();
const CACHE_TTL_MS = 30000; // 30 seconds — GeckoTerminal rate limit friendly

// Simple rate limiter: max 4 req per second (GeckoTerminal free tier)
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 350;

async function rateLimitedGet(url: string, headers: Record<string, string>): Promise<any> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();

  try {
    const res = await axios.get(url, { headers, timeout: 12000 });
    return res.data;
  } catch (err: any) {
    if (err?.response?.status === 429) {
      // Back off on rate limit
      await new Promise((resolve) => setTimeout(resolve, 2000));
      throw new Error("GeckoTerminal rate limit 429");
    }
    throw err;
  }
}

function geckoPoolToTokenData(pool: any): TokenData | null {
  try {
    const baseToken = pool.relationships?.base_token?.data;
    const attrs = pool.attributes;
    if (!baseToken || !attrs) return null;

    // Extract address from token id (format: "base_0xADDRESS")
    const tokenId = baseToken.id || "";
    const address = tokenId.replace(/^base_/i, "");
    if (!address || !address.startsWith("0x")) return null;

    const priceUsd = parseFloat(attrs.base_token_price_usd) || 0;
    if (priceUsd <= 0) return null;

    const createdAt = attrs.pool_created_at ? new Date(attrs.pool_created_at).getTime() : null;
    const ageMinutes = createdAt ? (Date.now() - createdAt) / 60000 : 99999;

    const priceChange5m = parseFloat(attrs.price_change_percentage?.m5) || 0;
    const priceChange1h = parseFloat(attrs.price_change_percentage?.h1) || 0;
    const priceChange24h = parseFloat(attrs.price_change_percentage?.h24) || 0;

    const volume5mUsd = parseFloat(attrs.volume_usd?.m5) || 0;
    const volume1hUsd = parseFloat(attrs.volume_usd?.h1) || 0;
    const liquidityUsd = parseFloat(attrs.reserve_in_usd) || 0;
    const marketCapUsd = parseFloat(attrs.fdv_usd) || null;

    const buyTxns5m = attrs.transactions?.m5?.buys || 0;
    const sellTxns5m = attrs.transactions?.m5?.sells || 0;

    const dexUrl = `https://www.geckoterminal.com/${NETWORK}/pools/${attrs.address}`;

    return {
      address,
      symbol: attrs.name?.split(" / ")[0] || "UNKNOWN",
      name: attrs.name || "UNKNOWN",
      priceUsd,
      priceChange5m,
      priceChange1h,
      priceChange24h,
      volume5mUsd,
      volume1hUsd,
      liquidityUsd,
      marketCapUsd,
      ageMinutes,
      holderCount: null,
      dexUrl,
      pairAddress: attrs.address || "",
      txns5m: { buys: buyTxns5m, sells: sellTxns5m },
    };
  } catch (err) {
    logger.debug({ err }, "GeckoTerminal pool parse error");
    return null;
  }
}

function geckoTokenToTokenData(token: any): TokenData | null {
  try {
    const attrs = token.attributes;
    if (!attrs) return null;

    const address = attrs.address;
    if (!address || !address.startsWith("0x")) return null;

    const priceUsd = parseFloat(attrs.price_usd) || 0;
    if (priceUsd <= 0) return null;

    const priceChange5m = parseFloat(attrs.price_change_percentage?.last_5m) || 0;
    const priceChange1h = parseFloat(attrs.price_change_percentage?.last_1h) || 0;
    const priceChange24h = parseFloat(attrs.price_change_percentage?.last_24h) || 0;

    const volume1hUsd = parseFloat(attrs.volume_usd?.h1) || 0;
    const liquidityUsd = parseFloat(attrs.total_reserve_in_usd) || 0;
    const marketCapUsd = parseFloat(attrs.fdv_usd) || null;

    return {
      address,
      symbol: attrs.symbol || "UNKNOWN",
      name: attrs.name || attrs.symbol || "UNKNOWN",
      priceUsd,
      priceChange5m,
      priceChange1h,
      priceChange24h,
      volume5mUsd: volume1hUsd / 12, // estimate from 1h
      volume1hUsd,
      liquidityUsd,
      marketCapUsd,
      ageMinutes: 9999, // unknown age from token endpoint
      holderCount: null,
      dexUrl: `https://www.geckoterminal.com/${NETWORK}/tokens/${address}`,
      pairAddress: "",
      txns5m: { buys: 0, sells: 0 },
    };
  } catch (err) {
    logger.debug({ err }, "GeckoTerminal token parse error");
    return null;
  }
}

/**
 * Scan new/trending pools from GeckoTerminal on Base network.
 */
async function scanGeckoPools(category: string): Promise<TokenData[]> {
  const cacheKey = `gecko_${category}`;
  const cached = geckoCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.data;

  try {
    const data = await rateLimitedGet(
      `${GECKO_BASE_URL}/networks/${NETWORK}/${category}?page=1&include=base_token%2Cquote_token`,
      { Accept: "application/json;version=20230302" }
    );

    const pools: any[] = data?.data || [];
    const tokens: TokenData[] = [];
    const seen = new Set<string>();

    for (const pool of pools) {
      const token = geckoPoolToTokenData(pool);
      if (token && !seen.has(token.address.toLowerCase())) {
        seen.add(token.address.toLowerCase());
        tokens.push(token);
      }
    }

    geckoCache.set(cacheKey, { data: tokens, timestamp: Date.now() });
    logger.debug({ category, found: tokens.length }, `GeckoTerminal ${category} scan done`);
    return tokens;
  } catch (err: any) {
    logger.warn({ err: err?.message, category }, `GeckoTerminal ${category} scan failed`);
    geckoCache.set(cacheKey, { data: [], timestamp: Date.now() });
    return [];
  }
}

/**
 * Scan trending/top-gainer tokens from GeckoTerminal.
 */
async function scanGeckoTokens(category: string): Promise<TokenData[]> {
  const cacheKey = `gecko_tokens_${category}`;
  const cached = geckoCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.data;

  try {
    const data = await rateLimitedGet(
      `${GECKO_BASE_URL}/networks/${NETWORK}/tokens/${category}`,
      { Accept: "application/json;version=20230302" }
    );

    const tokenList: any[] = data?.data || [];
    const tokens: TokenData[] = [];

    for (const t of tokenList) {
      const token = geckoTokenToTokenData(t);
      if (token) tokens.push(token);
    }

    geckoCache.set(cacheKey, { data: tokens, timestamp: Date.now() });
    logger.debug({ category, found: tokens.length }, `GeckoTerminal tokens/${category} scan done`);
    return tokens;
  } catch (err: any) {
    logger.warn({ err: err?.message, category }, `GeckoTerminal tokens/${category} failed`);
    geckoCache.set(cacheKey, { data: [], timestamp: Date.now() });
    return [];
  }
}

/**
 * Main GeckoTerminal scan: runs all strategies in parallel and deduplicates.
 */
export async function scanGeckoTerminal(): Promise<TokenData[]> {
  const [newPools, trendingPools, trendingTokens, topGainers] = await Promise.allSettled([
    scanGeckoPools("new_pools"),
    scanGeckoPools("trending_pools"),
    scanGeckoTokens("trending"),
    scanGeckoTokens("top_gainers"),
  ]);

  const seen = new Set<string>();
  const results: TokenData[] = [];

  const addUnique = (tokens: TokenData[]) => {
    for (const t of tokens) {
      const key = t.address.toLowerCase();
      if (!seen.has(key) && t.priceUsd > 0) {
        seen.add(key);
        results.push(t);
      }
    }
  };

  if (newPools.status === "fulfilled") addUnique(newPools.value);
  if (trendingPools.status === "fulfilled") addUnique(trendingPools.value);
  if (trendingTokens.status === "fulfilled") addUnique(trendingTokens.value);
  if (topGainers.status === "fulfilled") addUnique(topGainers.value);

  // Sort by 5m price change (momentum)
  results.sort((a, b) => b.priceChange5m - a.priceChange5m);

  logger.info({ total: results.length }, "GeckoTerminal full scan complete");
  return results;
}
