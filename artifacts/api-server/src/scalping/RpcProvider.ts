import { logger } from "../lib/logger.js";

/**
 * RPC Provider — strict separation of read vs write providers.
 *
 * readProvider  = BASE_RPC_URL  (data queries, price reads, balance checks)
 * writeProvider = MEV_PROTECTION_RPC  (all swap / approve transactions)
 *
 * Fallback chain:
 *   write: MEV_PROTECTION_RPC (primary) → MEV_PROTECTION_RPC_BACKUP (Flashbots) → BASE_RPC_URL → public RPCs
 *   read:  BASE_RPC_URL → public RPCs (never touches MEV endpoint)
 *
 * MEV RPCs — keduanya dianggap "mevActive = true":
 *   primary : MEV_PROTECTION_RPC        (default: https://mev-blocker.drpc.org)
 *   backup  : MEV_PROTECTION_RPC_BACKUP (default: https://rpc.flashbots.net/fast)
 */

// ─── Public fallback RPCs (read only) ─────────────────────────────────────────
const PUBLIC_READ_RPCS = [
  "https://mainnet.base.org",
  "https://base.publicnode.com",
  "https://base.drpc.org",
  "https://1rpc.io/base",
  "https://endpoints.omniatech.io/v1/base/mainnet/public",
  "https://base-rpc.publicnode.com",
];

// ─── Health tracking ──────────────────────────────────────────────────────────
interface RpcHealth {
  failures: number;
  lastFail: number;
  latencyMs: number;
  lastUsed: number;
}
const rpcHealth = new Map<string, RpcHealth>();

function isHealthy(rpc: string): boolean {
  const h = rpcHealth.get(rpc);
  if (!h) return true;
  if (h.failures >= 3 && Date.now() - h.lastFail < 60_000) return false;
  return true;
}

function recordSuccess(rpc: string, latencyMs: number): void {
  const h = rpcHealth.get(rpc) ?? { failures: 0, lastFail: 0, latencyMs: 0, lastUsed: 0 };
  h.failures = Math.max(0, h.failures - 1);
  h.latencyMs = latencyMs;
  h.lastUsed = Date.now();
  rpcHealth.set(rpc, h);
}

function recordFailure(rpc: string): void {
  const h = rpcHealth.get(rpc) ?? { failures: 0, lastFail: 0, latencyMs: 999, lastUsed: 0 };
  h.failures += 1;
  h.lastFail = Date.now();
  rpcHealth.set(rpc, h);
  logger.warn({ rpc: maskKey(rpc), failures: h.failures }, "RPC failure recorded");
}

function maskKey(rpc: string): string {
  return rpc.replace(/\/[a-zA-Z0-9]{20,}/, "/***");
}

// ─── Read RPC list (BASE_RPC_URL + public backups, never MEV endpoint) ────────
function getReadRpcList(): string[] {
  const primary = process.env["BASE_RPC_URL"];
  const list: string[] = [];
  if (primary) list.push(primary);
  for (const pub of PUBLIC_READ_RPCS) {
    if (!list.includes(pub)) list.push(pub);
  }
  return list;
}

// ─── MEV RPC defaults ────────────────────────────────────────────────────────
const DEFAULT_MEV_PRIMARY = "https://mev-blocker.drpc.org";
const DEFAULT_MEV_BACKUP   = "https://rpc.flashbots.net/fast";

function getMevRpcSet(): { primary: string; backup: string } {
  return {
    primary: process.env["MEV_PROTECTION_RPC"]        || DEFAULT_MEV_PRIMARY,
    backup:  process.env["MEV_PROTECTION_RPC_BACKUP"] || DEFAULT_MEV_BACKUP,
  };
}

// ─── Write RPC list (MEV primary → MEV backup → BASE_RPC_URL → public) ───────
function getWriteRpcList(): string[] {
  const { primary, backup } = getMevRpcSet();
  const base = process.env["BASE_RPC_URL"];
  const list: string[] = [];
  list.push(primary);
  if (backup && backup !== primary) list.push(backup);
  if (base && !list.includes(base)) list.push(base);
  for (const pub of PUBLIC_READ_RPCS) {
    if (!list.includes(pub)) list.push(pub);
  }
  return list;
}

// ─── getReadProvider ─────────────────────────────────────────────────────────
/**
 * Returns a provider backed by BASE_RPC_URL (read-only queries).
 * Never uses the MEV endpoint.
 */
export async function getReadProvider(): Promise<{ provider: any; ethers: any; rpcUrl: string }> {
  const { ethers } = await import("ethers");
  const rpcs = getReadRpcList();
  const candidates = rpcs.filter(isHealthy).length > 0 ? rpcs.filter(isHealthy) : rpcs;

  for (const rpc of candidates) {
    try {
      const start = Date.now();
      const provider = new ethers.JsonRpcProvider(rpc);
      await provider.getBlockNumber();
      recordSuccess(rpc, Date.now() - start);
      return { provider, ethers, rpcUrl: rpc };
    } catch {
      recordFailure(rpc);
    }
  }
  throw new Error("All read RPC endpoints failed");
}

// ─── getWriteProvider ─────────────────────────────────────────────────────────
/**
 * Returns a wallet-ready provider for submitting transactions.
 * Tries MEV_PROTECTION_RPC first, logs which path is taken,
 * then falls back to BASE_RPC_URL, then public RPCs.
 */
export interface WriteProviderResult {
  provider: any;
  ethers: any;
  rpcUrl: string;
  mevActive: boolean;
}

export async function getWriteProvider(): Promise<WriteProviderResult> {
  const { ethers } = await import("ethers");
  const { primary: mevPrimary, backup: mevBackup } = getMevRpcSet();
  const primaryRpc = process.env["BASE_RPC_URL"] || "https://mainnet.base.org";
  const rpcs = getWriteRpcList();

  for (const rpc of rpcs) {
    const isMevPrimary = rpc === mevPrimary;
    const isMevBackup  = rpc === mevBackup;
    const isMev        = isMevPrimary || isMevBackup;
    if (!isHealthy(rpc)) continue;

    try {
      const start = Date.now();
      const provider = new ethers.JsonRpcProvider(rpc);
      await provider.getBlockNumber();
      recordSuccess(rpc, Date.now() - start);

      if (isMevPrimary) {
        logger.info({ rpc: maskKey(rpc) }, "MEV protection active — dRPC MEV Blocker (primary)");
      } else if (isMevBackup) {
        logger.warn({ rpc: maskKey(rpc) }, "MEV protection active — Flashbots (backup, primary down)");
      } else {
        logger.warn(
          { rpc: maskKey(rpc), mevPrimary: maskKey(mevPrimary), mevBackup: maskKey(mevBackup) },
          "MEV protection unavailable — both MEV RPCs down, using standard RPC"
        );
      }

      return { provider, ethers, rpcUrl: rpc, mevActive: isMev };
    } catch (err: any) {
      recordFailure(rpc);
      if (isMevPrimary) {
        logger.warn({ err: err?.message }, "dRPC MEV Blocker unreachable, trying Flashbots backup");
      } else if (isMevBackup) {
        logger.warn({ err: err?.message }, "Flashbots backup unreachable, falling back to standard RPC");
      }
    }
  }

  // Last-resort: force primary RPC (no liveness check — better than failing)
  logger.error({ primaryRpc: maskKey(primaryRpc) }, "All write RPCs failed — using primary RPC as last resort");
  const provider = new ethers.JsonRpcProvider(primaryRpc);
  return { provider, ethers, rpcUrl: primaryRpc, mevActive: false };
}

// ─── withRpcRetry (read operations) ─────────────────────────────────────────
/**
 * Execute a read-only call with automatic RPC retry on failure.
 * Only uses read RPCs (BASE_RPC_URL + public backups).
 */
export async function withRpcRetry<T>(
  fn: (provider: any, ethers: any, rpcUrl: string) => Promise<T>
): Promise<T> {
  const { ethers } = await import("ethers");
  const rpcs = getReadRpcList();
  const candidates = rpcs.filter(isHealthy).length > 0 ? rpcs.filter(isHealthy) : rpcs;

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
      const isRateLimit =
        err?.message?.includes("429") ||
        err?.message?.includes("rate limit") ||
        err?.code === "SERVER_ERROR";
      if (isRateLimit) recordFailure(rpc);
      logger.debug({ rpc: maskKey(rpc), err: err?.message }, "Read RPC call failed, trying next");
    }
  }
  throw lastError ?? new Error("All read RPC endpoints failed");
}

// ─── Health report ─────────────────────────────────────────────────────────
export function getRpcHealthReport(): Array<{
  rpc: string;
  role: "write-mev-primary" | "write-mev-backup" | "write-fallback" | "read" | "backup";
  failures: number;
  latencyMs: number;
  healthy: boolean;
}> {
  const { primary: mevPrimary, backup: mevBackup } = getMevRpcSet();
  const primaryRpc = process.env["BASE_RPC_URL"] || "";

  const allRpcs = [...new Set([...getWriteRpcList(), ...getReadRpcList()])];

  return allRpcs.map((rpc) => {
    const h = rpcHealth.get(rpc);
    let role: "write-mev-primary" | "write-mev-backup" | "write-fallback" | "read" | "backup" = "backup";
    if (rpc === mevPrimary)  role = "write-mev-primary";
    else if (rpc === mevBackup)   role = "write-mev-backup";
    else if (rpc === primaryRpc)  role = "write-fallback";

    return {
      rpc: maskKey(rpc),
      role,
      failures: h?.failures ?? 0,
      latencyMs: h?.latencyMs ?? 0,
      healthy: isHealthy(rpc),
    };
  });
}
