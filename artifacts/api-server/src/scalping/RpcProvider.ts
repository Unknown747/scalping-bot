import { logger } from "../lib/logger.js";

/**
 * RPC rotation utility — cycles through multiple Base network endpoints.
 * Primary (Alchemy/Infura from env) → public backups when rate-limited or down.
 */

const PUBLIC_BASE_RPCS = [
  "https://mainnet.base.org",
  "https://base.publicnode.com",
  "https://base.drpc.org",
  "https://1rpc.io/base",
  "https://endpoints.omniatech.io/v1/base/mainnet/public",
  "https://base-rpc.publicnode.com",
];

// Health tracking per RPC
const rpcHealth = new Map<string, { failures: number; lastFail: number; latencyMs: number }>();

function getRpcList(): string[] {
  const primary = process.env["BASE_RPC_URL"];
  const mev = process.env["MEV_PROTECTION_RPC"];
  const extras: string[] = [];

  if (primary && primary !== "https://mainnet.base.org") extras.push(primary);
  if (mev && mev !== primary && mev !== "https://mainnet.base.org") extras.push(mev);

  return [...extras, ...PUBLIC_BASE_RPCS];
}

function isHealthy(rpc: string): boolean {
  const h = rpcHealth.get(rpc);
  if (!h) return true;
  // Cool down: after 3+ failures, wait 60s before retrying
  if (h.failures >= 3 && Date.now() - h.lastFail < 60_000) return false;
  return true;
}

function recordSuccess(rpc: string, latencyMs: number) {
  const h = rpcHealth.get(rpc) ?? { failures: 0, lastFail: 0, latencyMs: 0 };
  h.failures = Math.max(0, h.failures - 1);
  h.latencyMs = latencyMs;
  rpcHealth.set(rpc, h);
}

function recordFailure(rpc: string) {
  const h = rpcHealth.get(rpc) ?? { failures: 0, lastFail: 0, latencyMs: 999 };
  h.failures++;
  h.lastFail = Date.now();
  rpcHealth.set(rpc, h);
  logger.warn({ rpc, failures: h.failures }, "RPC failure recorded");
}

/**
 * Get a working JSON-RPC provider with automatic fallback.
 * Returns both the provider and its RPC URL.
 */
export async function getProvider(): Promise<{ provider: any; rpcUrl: string; ethers: any }> {
  const { ethers } = await import("ethers");
  const rpcs = getRpcList();
  const healthy = rpcs.filter(isHealthy);
  const candidates = healthy.length > 0 ? healthy : rpcs; // fallback to all if all unhealthy

  for (const rpc of candidates) {
    try {
      const start = Date.now();
      const provider = new ethers.JsonRpcProvider(rpc);
      // Quick liveness check
      await provider.getBlockNumber();
      recordSuccess(rpc, Date.now() - start);
      return { provider, rpcUrl: rpc, ethers };
    } catch (err: any) {
      recordFailure(rpc);
      logger.debug({ rpc, err: err?.message }, "RPC not responsive, trying next");
    }
  }

  throw new Error("All Base RPC endpoints failed");
}

/**
 * Execute a function with automatic RPC retry on failure.
 * Tries each healthy RPC in order.
 */
export async function withRpcRetry<T>(
  fn: (provider: any, ethers: any, rpcUrl: string) => Promise<T>
): Promise<T> {
  const { ethers } = await import("ethers");
  const rpcs = getRpcList();
  const healthy = rpcs.filter(isHealthy);
  const candidates = healthy.length > 0 ? healthy : rpcs;

  let lastError: any;

  for (const rpc of candidates) {
    try {
      const start = Date.now();
      const provider = new ethers.JsonRpcProvider(rpc);
      const result = await fn(provider, ethers, rpc);
      recordSuccess(rpc, Date.now() - start);
      return result;
    } catch (err: any) {
      lastError = err;
      const isRateLimit = err?.message?.includes("429") ||
        err?.message?.includes("rate") ||
        err?.code === "SERVER_ERROR";
      if (isRateLimit) recordFailure(rpc);
      logger.debug({ rpc, err: err?.message }, "RPC call failed, trying next");
    }
  }

  throw lastError ?? new Error("All RPC endpoints failed");
}

/**
 * Get MEV-protected provider for trade submission.
 * Falls back to primary RPC if MEV RPC fails.
 */
export async function getMevProvider(): Promise<{ provider: any; ethers: any }> {
  const { ethers } = await import("ethers");
  const mevRpc = process.env["MEV_PROTECTION_RPC"];
  const primaryRpc = process.env["BASE_RPC_URL"] || "https://mainnet.base.org";

  const candidates = [mevRpc, primaryRpc, ...PUBLIC_BASE_RPCS].filter(Boolean) as string[];

  for (const rpc of candidates) {
    if (!isHealthy(rpc)) continue;
    try {
      const provider = new ethers.JsonRpcProvider(rpc);
      await provider.getBlockNumber();
      return { provider, ethers };
    } catch {
      recordFailure(rpc);
    }
  }

  // Last resort — use ethers default with primary
  const provider = new ethers.JsonRpcProvider(primaryRpc);
  return { provider, ethers };
}

export function getRpcHealthReport(): Array<{ rpc: string; failures: number; latencyMs: number; healthy: boolean }> {
  return getRpcList().map((rpc) => {
    const h = rpcHealth.get(rpc);
    return {
      rpc: rpc.replace(/\/[a-zA-Z0-9]{20,}/, "/***"),
      failures: h?.failures ?? 0,
      latencyMs: h?.latencyMs ?? 0,
      healthy: isHealthy(rpc),
    };
  });
}
