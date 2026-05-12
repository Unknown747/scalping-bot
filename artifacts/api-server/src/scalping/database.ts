import { DatabaseSync } from "node:sqlite";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env["SQLITE_PATH"] || path.join(__dirname, "../../scalping.db");

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!_db) {
    _db = new DatabaseSync(DB_PATH);
    _db.exec("PRAGMA journal_mode = WAL");
    _db.exec("PRAGMA foreign_keys = ON");
    _db.exec("PRAGMA cache_size = -8000");
    _db.exec("PRAGMA temp_store = MEMORY");
    initSchema(_db);
    logger.info({ path: DB_PATH }, "SQLite database initialized");
  }
  return _db;
}

function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_address TEXT NOT NULL,
      token_symbol TEXT NOT NULL,
      token_name TEXT NOT NULL,
      entry_price REAL NOT NULL,
      exit_price REAL NOT NULL,
      amount_eth REAL NOT NULL,
      amount_tokens REAL NOT NULL DEFAULT 0,
      profit_percent REAL NOT NULL,
      profit_eth REAL NOT NULL,
      entry_time TEXT NOT NULL,
      exit_time TEXT NOT NULL,
      hold_seconds INTEGER NOT NULL,
      exit_reason TEXT NOT NULL,
      tx_hash TEXT,
      mev_protected INTEGER NOT NULL DEFAULT 0,
      mode TEXT NOT NULL DEFAULT 'live',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_address TEXT NOT NULL UNIQUE,
      token_symbol TEXT NOT NULL,
      token_name TEXT NOT NULL,
      entry_price REAL NOT NULL,
      current_price REAL NOT NULL,
      amount_eth REAL NOT NULL,
      amount_tokens REAL NOT NULL DEFAULT 0,
      profit_percent REAL NOT NULL DEFAULT 0,
      profit_eth REAL NOT NULL DEFAULT 0,
      entry_time TEXT NOT NULL,
      hold_seconds INTEGER NOT NULL DEFAULT 0,
      tp1_hit INTEGER NOT NULL DEFAULT 0,
      tp2_hit INTEGER NOT NULL DEFAULT 0,
      trailing_stop_active INTEGER NOT NULL DEFAULT 0,
      trailing_stop_price REAL,
      safety_score INTEGER NOT NULL DEFAULT 0,
      liquidity_usd REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scanned_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT NOT NULL,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      price_usd REAL NOT NULL,
      price_change_5m REAL NOT NULL DEFAULT 0,
      price_change_1h REAL NOT NULL DEFAULT 0,
      volume_5m_usd REAL NOT NULL DEFAULT 0,
      liquidity_usd REAL NOT NULL DEFAULT 0,
      market_cap_usd REAL,
      age_minutes REAL NOT NULL DEFAULT 0,
      holder_count INTEGER,
      safety_score INTEGER NOT NULL DEFAULT 0,
      passed_filters INTEGER NOT NULL DEFAULT 0,
      dex_url TEXT,
      scanned_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bot_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      token_symbol TEXT,
      data TEXT,
      timestamp TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bot_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      config_json TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS daily_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      pnl_eth REAL NOT NULL DEFAULT 0,
      total_trades INTEGER NOT NULL DEFAULT 0,
      winning_trades INTEGER NOT NULL DEFAULT 0,
      losing_trades INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS token_blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT NOT NULL UNIQUE,
      symbol TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT 'honeypot',
      added_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_trades_exit_time ON trades(exit_time);
    CREATE INDEX IF NOT EXISTS idx_trades_token_address ON trades(token_address);
    CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at);
    CREATE INDEX IF NOT EXISTS idx_scanned_tokens_scanned_at ON scanned_tokens(scanned_at);
    CREATE INDEX IF NOT EXISTS idx_scanned_tokens_address ON scanned_tokens(address);
    CREATE INDEX IF NOT EXISTS idx_bot_logs_timestamp ON bot_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_bot_logs_level ON bot_logs(level);
    CREATE INDEX IF NOT EXISTS idx_positions_token_address ON positions(token_address);
    CREATE INDEX IF NOT EXISTS idx_token_blacklist_address ON token_blacklist(address);
  `);

  // Migration: add mode column to existing trades tables that don't have it yet
  try {
    db.exec(`ALTER TABLE trades ADD COLUMN mode TEXT NOT NULL DEFAULT 'live'`);
  } catch {
    // Column already exists — ignore
  }
}

// Trade operations
export function insertTrade(trade: {
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  entryPrice: number;
  exitPrice: number;
  amountEth: number;
  amountTokens?: number;
  profitPercent: number;
  profitEth: number;
  entryTime: string;
  exitTime: string;
  holdSeconds: number;
  exitReason: string;
  txHash?: string | null;
  mevProtected?: boolean;
  mode?: "live" | "paper";
}): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO trades (token_address, token_symbol, token_name, entry_price, exit_price, amount_eth, amount_tokens, profit_percent, profit_eth, entry_time, exit_time, hold_seconds, exit_reason, tx_hash, mev_protected, mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    trade.tokenAddress, trade.tokenSymbol, trade.tokenName,
    trade.entryPrice, trade.exitPrice, trade.amountEth,
    trade.amountTokens || 0, trade.profitPercent, trade.profitEth,
    trade.entryTime, trade.exitTime, trade.holdSeconds,
    trade.exitReason, trade.txHash || null,
    trade.mevProtected ? 1 : 0,
    trade.mode || "live"
  );
  return Number(result.lastInsertRowid);
}

export function getTrades(
  filter: "today" | "week" | "all" = "today",
  limit = 100,
  page = 1,
  mode?: "live" | "paper"
): { trades: any[]; total: number; page: number; totalPages: number } {
  const db = getDb();
  const conditions: string[] = [];
  if (filter === "today") {
    conditions.push("date(exit_time) = date('now')");
  } else if (filter === "week") {
    conditions.push("exit_time >= datetime('now', '-7 days')");
  }
  if (mode) {
    conditions.push(`mode = '${mode}'`);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const offset = (page - 1) * limit;
  const countRow = db.prepare(`SELECT COUNT(*) as total FROM trades ${whereClause}`).get() as any;
  const total = Number(countRow?.total || 0);
  const totalPages = Math.ceil(total / limit);

  const trades = (db.prepare(`
    SELECT id, token_address as tokenAddress, token_symbol as tokenSymbol, token_name as tokenName,
           entry_price as entryPrice, exit_price as exitPrice, amount_eth as amountEth,
           profit_percent as profitPercent, profit_eth as profitEth,
           entry_time as entryTime, exit_time as exitTime, hold_seconds as holdSeconds,
           exit_reason as exitReason, tx_hash as txHash,
           mev_protected as mevProtected, mode
    FROM trades ${whereClause}
    ORDER BY exit_time DESC LIMIT ? OFFSET ?
  `).all(limit, offset) as any[]);

  for (const t of trades) {
    t.mevProtected = t.mevProtected === 1;
  }

  return { trades, total, page, totalPages };
}

// Position operations
export function upsertPosition(pos: {
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  entryPrice: number;
  currentPrice: number;
  amountEth: number;
  amountTokens?: number;
  profitPercent: number;
  profitEth: number;
  entryTime: string;
  holdSeconds: number;
  tp1Hit: boolean;
  tp2Hit: boolean;
  trailingStopActive: boolean;
  trailingStopPrice?: number | null;
  safetyScore: number;
  liquidityUsd: number;
  status: string;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO positions (token_address, token_symbol, token_name, entry_price, current_price, amount_eth, amount_tokens, profit_percent, profit_eth, entry_time, hold_seconds, tp1_hit, tp2_hit, trailing_stop_active, trailing_stop_price, safety_score, liquidity_usd, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(token_address) DO UPDATE SET
      current_price = excluded.current_price,
      profit_percent = excluded.profit_percent,
      profit_eth = excluded.profit_eth,
      hold_seconds = excluded.hold_seconds,
      tp1_hit = excluded.tp1_hit,
      tp2_hit = excluded.tp2_hit,
      trailing_stop_active = excluded.trailing_stop_active,
      trailing_stop_price = excluded.trailing_stop_price,
      status = excluded.status
  `).run(
    pos.tokenAddress, pos.tokenSymbol, pos.tokenName,
    pos.entryPrice, pos.currentPrice, pos.amountEth,
    pos.amountTokens || 0, pos.profitPercent, pos.profitEth,
    pos.entryTime, pos.holdSeconds,
    pos.tp1Hit ? 1 : 0, pos.tp2Hit ? 1 : 0,
    pos.trailingStopActive ? 1 : 0, pos.trailingStopPrice || null,
    pos.safetyScore, pos.liquidityUsd, pos.status
  );
}

export function getPositions(): any[] {
  const db = getDb();
  return db.prepare(`
    SELECT id, token_address as tokenAddress, token_symbol as tokenSymbol, token_name as tokenName,
           entry_price as entryPrice, current_price as currentPrice, amount_eth as amountEth,
           amount_tokens as amountTokens, profit_percent as profitPercent, profit_eth as profitEth,
           entry_time as entryTime, hold_seconds as holdSeconds,
           tp1_hit as tp1Hit, tp2_hit as tp2Hit,
           trailing_stop_active as trailingStopActive, safety_score as safetyScore,
           liquidity_usd as liquidityUsd, status
    FROM positions WHERE status IN ('open', 'closing')
    ORDER BY entry_time DESC
  `).all() as any[];
}

export function deletePosition(tokenAddress: string): void {
  const db = getDb();
  db.prepare("DELETE FROM positions WHERE token_address = ?").run(tokenAddress);
}

// Scanned tokens
export function insertScannedToken(token: {
  address: string;
  symbol: string;
  name: string;
  priceUsd: number;
  priceChange5m: number;
  priceChange1h: number;
  volume5mUsd: number;
  liquidityUsd: number;
  marketCapUsd?: number | null;
  ageMinutes: number;
  holderCount?: number | null;
  safetyScore: number;
  passedFilters: boolean;
  dexUrl?: string | null;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO scanned_tokens (address, symbol, name, price_usd, price_change_5m, price_change_1h, volume_5m_usd, liquidity_usd, market_cap_usd, age_minutes, holder_count, safety_score, passed_filters, dex_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    token.address, token.symbol, token.name, token.priceUsd,
    token.priceChange5m, token.priceChange1h, token.volume5mUsd,
    token.liquidityUsd, token.marketCapUsd || null,
    token.ageMinutes, token.holderCount || null,
    token.safetyScore, token.passedFilters ? 1 : 0, token.dexUrl || null
  );
}

export function getScannedTokens(limit = 20, page = 1): any[] {
  const db = getDb();
  const offset = (page - 1) * limit;
  return (db.prepare(`
    SELECT id, address, symbol, name, price_usd as priceUsd,
           price_change_5m as priceChangePercent5m, price_change_1h as priceChangePercent1h,
           volume_5m_usd as volumeUsd5m, liquidity_usd as liquidityUsd,
           market_cap_usd as marketCapUsd, age_minutes as ageMinutes,
           holder_count as holderCount, safety_score as safetyScore,
           passed_filters as passedFilters, dex_url as dexUrl,
           scanned_at as scannedAt
    FROM scanned_tokens
    ORDER BY scanned_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset) as any[]).map((r: any) => ({ ...r, passedFilters: r.passedFilters === 1 }));
}

// Bot logs
export function insertLog(log: {
  level: string;
  message: string;
  tokenSymbol?: string | null;
  data?: string | null;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO bot_logs (level, message, token_symbol, data)
    VALUES (?, ?, ?, ?)
  `).run(log.level, log.message, log.tokenSymbol || null, log.data || null);
}

export function getLogs(limit = 100, page = 1, level?: string): any[] {
  const db = getDb();
  const offset = (page - 1) * limit;
  if (level) {
    return db.prepare(`
      SELECT id, level, message, token_symbol as tokenSymbol, data, timestamp
      FROM bot_logs WHERE level = ?
      ORDER BY timestamp DESC LIMIT ? OFFSET ?
    `).all(level, limit, offset) as any[];
  }
  return db.prepare(`
    SELECT id, level, message, token_symbol as tokenSymbol, data, timestamp
    FROM bot_logs
    ORDER BY timestamp DESC LIMIT ? OFFSET ?
  `).all(limit, offset) as any[];
}

// Today + all-time stats (used by /api/stats and /api/stats/both)
export function getTodayStats(mode?: "live" | "paper"): { pnlEth: number; totalTrades: number; winningTrades: number; losingTrades: number } {
  const db = getDb();
  const modeClause = mode ? `AND mode = '${mode}'` : "";
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(profit_eth), 0) as pnlEth,
      COUNT(*) as totalTrades,
      SUM(CASE WHEN profit_eth > 0 THEN 1 ELSE 0 END) as winningTrades,
      SUM(CASE WHEN profit_eth <= 0 THEN 1 ELSE 0 END) as losingTrades
    FROM trades WHERE date(exit_time) = date('now') ${modeClause}
  `).get() as any;
  return {
    pnlEth: Number(row?.pnlEth || 0),
    totalTrades: Number(row?.totalTrades || 0),
    winningTrades: Number(row?.winningTrades || 0),
    losingTrades: Number(row?.losingTrades || 0),
  };
}

export function getAllTimeStats(mode?: "live" | "paper"): { totalPnlEth: number; avgProfitPercent: number; avgHoldSeconds: number; largestWin: number; largestLoss: number } {
  const db = getDb();
  const modeClause = mode ? `WHERE mode = '${mode}'` : "";
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(profit_eth), 0) as totalPnlEth,
      COALESCE(AVG(profit_percent), 0) as avgProfitPercent,
      COALESCE(AVG(hold_seconds), 0) as avgHoldSeconds,
      COALESCE(MAX(profit_percent), 0) as largestWin,
      COALESCE(MIN(profit_percent), 0) as largestLoss
    FROM trades ${modeClause}
  `).get() as any;
  return {
    totalPnlEth: Number(row?.totalPnlEth || 0),
    avgProfitPercent: Number(row?.avgProfitPercent || 0),
    avgHoldSeconds: Number(row?.avgHoldSeconds || 0),
    largestWin: Number(row?.largestWin || 0),
    largestLoss: Number(row?.largestLoss || 0),
  };
}

export function cleanOldLogs(keepDays = 7): void {
  const db = getDb();
  db.exec(`DELETE FROM bot_logs WHERE timestamp < datetime('now', '-${keepDays} days')`);
  db.exec(`DELETE FROM scanned_tokens WHERE scanned_at < datetime('now', '-1 days')`);
}

// ─── Permanent Honeypot / FoT Blacklist ──────────────────────────────────────

export function addToHoneypotBlacklist(address: string, symbol: string, reason: string): void {
  const db = getDb();
  try {
    db.prepare(`
      INSERT INTO token_blacklist (address, symbol, reason)
      VALUES (?, ?, ?)
      ON CONFLICT(address) DO UPDATE SET reason = excluded.reason, added_at = datetime('now')
    `).run(address.toLowerCase(), symbol, reason);
  } catch {
    // Ignore duplicate
  }
}

export function isHoneypotBlacklisted(address: string): boolean {
  const db = getDb();
  const row = db.prepare("SELECT id FROM token_blacklist WHERE address = ?").get(address.toLowerCase());
  return !!row;
}

export function getHoneypotBlacklist(): { id: number; address: string; symbol: string; reason: string; addedAt: string }[] {
  const db = getDb();
  return (db.prepare(`
    SELECT id, address, symbol, reason, added_at as addedAt
    FROM token_blacklist ORDER BY added_at DESC
  `).all() as any[]);
}

export function removeFromHoneypotBlacklist(address: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM token_blacklist WHERE address = ?").run(address.toLowerCase());
  return Number(result.changes) > 0;
}

export function clearHoneypotBlacklist(): number {
  const db = getDb();
  const result = db.prepare("DELETE FROM token_blacklist").run();
  return Number(result.changes);
}
