import axios from "axios";
import { logger } from "../lib/logger.js";
import type { ScalpingConfigData } from "./config.js";
import { scanGeckoTerminal } from "./GeckoTerminalScanner.js";

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
  source?: "dexscreener" | "geckoterminal";
  volumeSpikeDetected?: boolean;
  volumeSpikeMultiplier?: number;
}

const DEXSCREENER_URL = "https://api.dexscreener.com";

const tokenCache = new Map<string, { data: TokenData[]; timestamp: number }>();
const CACHE_TTL_MS = 10000; // 10 seconds

// ── Volume Spike Tracker ──────────────────────────────────────────────────────
// Stores the last seen volume5mUsd per token address across scan cycles.
// Entries expire after 10 minutes to avoid stale comparisons.
const volumeHistory = new Map<string, { volume: number; updatedAt: number }>();
const VOLUME_HISTORY_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Known active memecoins/tokens on Base — used as seed for finding active pairs
const BASE_SEED_ADDRESSES = [
  "0x532f27101965dd16442E59d40670FaF5eBB142E4", // BRETT
  "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", // DEGEN
  "0xAC1Bd2486aaf3B5C0fc3Fd868558b082a531B2B3", // TOSHI
  "0x9a26F5433671751C3276a065f57e5a02D2817973", // KEYCAT
  "0xB4fDe59a779991bfB6a52253B51947828b982be3", // MOCHI
  "0x940181a94A35A4569E4529A3CDfB74e38FD98631", // AERO
  "0x768BE13e1680b5ebE0024C42c896E3dB59ec0149", // SKI
  "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", // USDbC
];

// DexScreener search terms covering different meme/trend categories
const SEARCH_TERMS = [
  "based",
  "coinbase",
  "brett",
  "toshi",
  "degen",
  "mochi",
  "pepe base",
  "dog base",
  "frog",
  "moon",
  "pump",
  "base meme",
];

let searchTermIndex = 0;

export class TokenScanner {
  private config: ScalpingConfigData;

  constructor(config: ScalpingConfigData) {
    this.config = config;
  }

  updateConfig(config: ScalpingConfigData): void {
    this.config = config;
  }

  async scanNewTokens(): Promise<TokenData[]> {
    const results: TokenData[] = [];
    const seen = new Set<string>();

    const addUnique = (tokens: TokenData[]) => {
      for (const t of tokens) {
        const key = t.address.toLowerCase();
        if (!seen.has(key) && t.address && t.priceUsd > 0) {
          seen.add(key);
          results.push(t);
        }
      }
    };

    // Run ALL scan strategies in parallel (DexScreener + GeckoTerminal)
    const [profileTokens, searchTokens, seedTokens, geckoTokens] = await Promise.allSettled([
      this.scanDexScreenerProfiles(),
      this.scanDexScreenerSearch(),
      this.scanSeedAddresses(),
      this.scanGeckoTerminalAll(),
    ]);

    if (profileTokens.status === "fulfilled") addUnique(profileTokens.value);
    if (searchTokens.status === "fulfilled") addUnique(searchTokens.value);
    if (seedTokens.status === "fulfilled") addUnique(seedTokens.value);
    if (geckoTokens.status === "fulfilled") addUnique(geckoTokens.value);

    // Detect volume spikes and mark tokens before sorting
    if (this.config.enableVolumeSpikeDetector) {
      this.detectVolumeSpikes(results);
    }

    // Sort: spike tokens first (highest multiplier first), then by momentum
    results.sort((a, b) => {
      const aSpike = a.volumeSpikeDetected ? (a.volumeSpikeMultiplier ?? 1) : 0;
      const bSpike = b.volumeSpikeDetected ? (b.volumeSpikeMultiplier ?? 1) : 0;
      if (aSpike !== bSpike) return bSpike - aSpike;
      return b.priceChange5m - a.priceChange5m;
    });

    const spikeCount = results.filter((t) => t.volumeSpikeDetected).length;
    logger.info(
      {
        total: results.length,
        dexscreener: results.filter(t => t.source !== "geckoterminal").length,
        geckoterminal: results.filter(t => t.source === "geckoterminal").length,
        volumeSpikes: spikeCount,
      },
      "Combined token scan complete"
    );

    return results;
  }

  /**
   * Strategy 1: DexScreener token profiles + boosts → batch pair lookup.
   */
  private async scanDexScreenerProfiles(): Promise<TokenData[]> {
    const cacheKey = "dex_profiles";
    const cached = tokenCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.data;

    try {
      const [profilesRes, boostsRes] = await Promise.allSettled([
        axios.get(`${DEXSCREENER_URL}/token-profiles/latest/v1`, {
          timeout: 7000,
          headers: { Accept: "application/json" },
        }),
        axios.get(`${DEXSCREENER_URL}/token-boosts/latest/v1`, {
          timeout: 7000,
          headers: { Accept: "application/json" },
        }),
      ]);

      const allAddresses = new Set<string>();

      if (profilesRes.status === "fulfilled") {
        const profiles: any[] = Array.isArray(profilesRes.value.data) ? profilesRes.value.data : [];
        profiles
          .filter((p) => p?.chainId === "base" && p?.tokenAddress)
          .forEach((p) => allAddresses.add(p.tokenAddress));
      }

      if (boostsRes.status === "fulfilled") {
        const boosts: any[] = Array.isArray(boostsRes.value.data) ? boostsRes.value.data : [];
        boosts
          .filter((b) => b?.chainId === "base" && b?.tokenAddress)
          .forEach((b) => allAddresses.add(b.tokenAddress));
      }

      if (allAddresses.size === 0) {
        tokenCache.set(cacheKey, { data: [], timestamp: Date.now() });
        return [];
      }

      const tokens = await this.fetchPairsForAddresses(Array.from(allAddresses));
      tokenCache.set(cacheKey, { data: tokens, timestamp: Date.now() });
      return tokens;
    } catch (err) {
      logger.debug({ err }, "DexScreener profiles scan failed");
      return [];
    }
  }

  /**
   * Strategy 2: Rotate through search keywords to find trending pairs on Base.
   */
  private async scanDexScreenerSearch(): Promise<TokenData[]> {
    const term = SEARCH_TERMS[searchTermIndex % SEARCH_TERMS.length];
    searchTermIndex++;

    const cacheKey = `dex_search_${term}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.data;

    try {
      const res = await axios.get(`${DEXSCREENER_URL}/latest/dex/search`, {
        params: { q: term },
        timeout: 7000,
        headers: { Accept: "application/json" },
      });

      const pairs: any[] = res.data?.pairs || [];
      const basePairs = pairs.filter((p: any) => p?.chainId === "base");

      const bestPairs = new Map<string, any>();
      for (const pair of basePairs) {
        const addr = pair?.baseToken?.address?.toLowerCase();
        if (!addr) continue;
        const liq = pair?.liquidity?.usd || 0;
        const existing = bestPairs.get(addr);
        if (!existing || liq > (existing?.liquidity?.usd || 0)) {
          bestPairs.set(addr, pair);
        }
      }

      const tokens: TokenData[] = [];
      for (const pair of bestPairs.values()) {
        const token = this.pairToTokenData(pair);
        if (token) tokens.push(token);
      }

      tokenCache.set(cacheKey, { data: tokens, timestamp: Date.now() });
      return tokens;
    } catch (err) {
      logger.debug({ err, term }, "DexScreener search failed");
      return [];
    }
  }

  /**
   * Strategy 3: Lookup pairs for known seed addresses.
   */
  private async scanSeedAddresses(): Promise<TokenData[]> {
    const cacheKey = "dex_seeds";
    const cached = tokenCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS * 3) return cached.data;

    const tokens = await this.fetchPairsForAddresses(BASE_SEED_ADDRESSES);
    tokenCache.set(cacheKey, { data: tokens, timestamp: Date.now() });
    return tokens;
  }

  /**
   * Strategy 4: GeckoTerminal — new_pools, trending_pools, trending tokens, top_gainers.
   */
  private async scanGeckoTerminalAll(): Promise<TokenData[]> {
    const cacheKey = "gecko_all";
    const cached = tokenCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.data;

    try {
      const tokens = await scanGeckoTerminal();
      const tagged = tokens.map((t) => ({ ...t, source: "geckoterminal" as const }));
      tokenCache.set(cacheKey, { data: tagged, timestamp: Date.now() });
      return tagged;
    } catch (err) {
      logger.warn({ err }, "GeckoTerminal scan failed");
      return [];
    }
  }

  /**
   * Batch lookup pair market data for a list of token addresses.
   * DexScreener allows up to 30 addresses per request.
   */
  private async fetchPairsForAddresses(addresses: string[]): Promise<TokenData[]> {
    if (addresses.length === 0) return [];
    const tokens: TokenData[] = [];

    for (let i = 0; i < addresses.length; i += 30) {
      const batch = addresses.slice(i, i + 30);
      try {
        const res = await axios.get(
          `${DEXSCREENER_URL}/latest/dex/tokens/${batch.join(",")}`,
          { timeout: 8000, headers: { Accept: "application/json" } }
        );

        const pairs: any[] = res.data?.pairs || [];
        const basePairs = pairs.filter((p: any) => p?.chainId === "base");

        const bestPairs = new Map<string, any>();
        for (const pair of basePairs) {
          const addr = pair?.baseToken?.address?.toLowerCase();
          if (!addr) continue;
          const liq = pair?.liquidity?.usd || 0;
          const existing = bestPairs.get(addr);
          if (!existing || liq > (existing?.liquidity?.usd || 0)) {
            bestPairs.set(addr, pair);
          }
        }

        for (const pair of bestPairs.values()) {
          const token = this.pairToTokenData(pair);
          if (token) tokens.push(token);
        }
      } catch (err) {
        logger.debug({ err }, "Batch token pair fetch failed");
      }
    }

    return tokens;
  }

  private pairToTokenData(pair: any): TokenData | null {
    const addr = pair?.baseToken?.address;
    if (!addr) return null;

    const priceUsd = parseFloat(pair.priceUsd) || 0;
    if (priceUsd <= 0) return null;

    const pairCreatedAt: number | null = pair.pairCreatedAt || null;
    const ageMinutes = pairCreatedAt
      ? (Date.now() - pairCreatedAt) / 60000
      : 99999;

    return {
      address: addr,
      symbol: pair.baseToken?.symbol || "UNKNOWN",
      name: pair.baseToken?.name || pair.baseToken?.symbol || "UNKNOWN",
      priceUsd,
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
      source: "dexscreener",
    };
  }

  /**
   * Compares each token's current volume5mUsd against its last recorded value.
   * Tokens that jump >= volumeSpikeMinMultiplier are flagged with volumeSpikeDetected=true
   * and sorted to the front of the queue so the bot evaluates them first.
   * History entries older than 10 minutes are purged to avoid stale comparisons.
   */
  private detectVolumeSpikes(tokens: TokenData[]): void {
    const now = Date.now();

    // Purge stale history entries
    for (const [addr, entry] of volumeHistory) {
      if (now - entry.updatedAt > VOLUME_HISTORY_TTL_MS) {
        volumeHistory.delete(addr);
      }
    }

    for (const token of tokens) {
      const key = token.address.toLowerCase();
      const prev = volumeHistory.get(key);

      if (prev && prev.volume > 0 && token.volume5mUsd > 0) {
        const multiplier = token.volume5mUsd / prev.volume;
        if (multiplier >= this.config.volumeSpikeMinMultiplier) {
          token.volumeSpikeDetected = true;
          token.volumeSpikeMultiplier = multiplier;
          logger.info(
            {
              symbol: token.symbol,
              prevVolume: prev.volume.toFixed(0),
              currentVolume: token.volume5mUsd.toFixed(0),
              multiplier: multiplier.toFixed(1),
            },
            `Volume spike detected: ${token.symbol} volume jumped ${multiplier.toFixed(1)}x`
          );
        }
      }

      // Always update history with latest volume
      volumeHistory.set(key, { volume: token.volume5mUsd, updatedAt: now });
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
}
