import axios from "axios";
import { logger } from "../lib/logger.js";

export interface PriceUpdate {
  address: string;
  priceUsd: number;
  priceChange5m: number;
  liquidityUsd: number;
  volume5mUsd: number;
  timestamp: number;
}

const DEXSCREENER_URL = "https://api.dexscreener.com/latest/dex";
const priceCache = new Map<string, { price: number; timestamp: number }>();

export class PriceMonitor {
  removeToken(address: string): void {
    priceCache.delete(address.toLowerCase());
  }

  async getPrices(addresses: string[]): Promise<Map<string, PriceUpdate>> {
    const result = new Map<string, PriceUpdate>();
    if (addresses.length === 0) return result;

    // Batch up to 30 addresses per request
    const batches: string[][] = [];
    for (let i = 0; i < addresses.length; i += 30) {
      batches.push(addresses.slice(i, i + 30));
    }

    for (const batch of batches) {
      try {
        const response = await axios.get(
          `${DEXSCREENER_URL}/tokens/${batch.join(",")}`,
          { timeout: 5000 }
        );

        const pairs = response.data?.pairs || [];
        for (const pair of pairs) {
          if (!pair?.baseToken?.address) continue;
          const addr = pair.baseToken.address.toLowerCase();
          if (!batch.map(a => a.toLowerCase()).includes(addr)) continue;

          // Use the pair with highest liquidity as price source
          const existing = result.get(addr);
          const liquidity = pair.liquidity?.usd || 0;
          if (!existing || liquidity > existing.liquidityUsd) {
            result.set(addr, {
              address: pair.baseToken.address,
              priceUsd: parseFloat(pair.priceUsd) || 0,
              priceChange5m: pair.priceChange?.m5 || 0,
              liquidityUsd: liquidity,
              volume5mUsd: pair.volume?.m5 || 0,
              timestamp: Date.now(),
            });
          }
        }
      } catch (err) {
        logger.warn({ err, batchSize: batch.length }, "Price fetch failed for batch");
      }
    }

    return result;
  }

  async getEthPrice(): Promise<number> {
    const cacheKey = "eth_price";
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 30000) {
      return cached.price;
    }

    try {
      const response = await axios.get(
        `${DEXSCREENER_URL}/tokens/0x4200000000000000000000000000000000000006`,
        { timeout: 5000 }
      );
      const pairs = response.data?.pairs || [];
      const ethPair = pairs.find((p: any) =>
        p.quoteToken?.symbol === "USDC" || p.quoteToken?.symbol === "USDT"
      );
      const price = parseFloat(ethPair?.priceUsd || "0") || 3200;
      priceCache.set(cacheKey, { price, timestamp: Date.now() });
      return price;
    } catch {
      return priceCache.get(cacheKey)?.price || 3200;
    }
  }
}
