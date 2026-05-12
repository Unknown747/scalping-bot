import { useState } from "react";
import { motion } from "framer-motion";
import { useGetTrades, getGetTradesQueryKey } from "@workspace/api-client-react";

type Trade = {
  id: number;
  tokenSymbol: string;
  tokenName: string;
  entryPrice: number;
  exitPrice: number;
  amountEth: number;
  profitPercent: number;
  profitEth: number;
  entryTime: string;
  exitTime: string;
  holdSeconds: number;
  exitReason: string;
  txHash?: string | null;
  mevProtected: boolean;
  mode?: string;
};

type PaginatedTrades = {
  trades: Trade[];
  total: number;
  page: number;
  totalPages: number;
};

const TIME_FILTER_LABELS: Record<string, string> = {
  today: "Hari Ini",
  week: "Minggu Ini",
  all: "Semua",
};

const MODE_FILTER_LABELS: Record<string, string> = {
  all: "Live + Paper",
  live: "Live",
  paper: "Paper",
};

const REASON_LABELS: Record<string, string> = {
  tp1: "TP1",
  tp2: "TP2",
  tp3: "TP3",
  stop_loss: "SL",
  trailing_stop: "TRAIL",
  max_hold: "MAX",
  manual: "MANUAL",
  manual_sell: "MANUAL",
  emergency: "EMRG",
  force_exit: "PEAK",
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatHold(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m${sec}s` : `${sec}s`;
}

function MevBadge({ protected: isProtected }: { protected: boolean }) {
  if (isProtected) {
    return (
      <span
        title="Trade masuk via MEV blocker — terlindungi dari sandwich attack"
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-primary/15 text-primary border border-primary/25"
      >
        ✓ MEV
      </span>
    );
  }
  return (
    <span
      title="Trade menggunakan RPC standar — tidak ada MEV protection"
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground border border-border/50"
    >
      — STD
    </span>
  );
}

function ModeBadge({ mode }: { mode?: string }) {
  if (!mode) return null;
  return mode === "live" ? (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-loss/10 text-loss border border-loss/20">
      LIVE
    </span>
  ) : (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-warn/10 text-warn border border-warn/20">
      SIM
    </span>
  );
}

export function TradeHistory() {
  const [timeFilter, setTimeFilter] = useState<"today" | "week" | "all">("today");
  const [modeFilter, setModeFilter] = useState<"all" | "live" | "paper">("all");

  const { data: raw } = useGetTrades(
    { filter: timeFilter, limit: 200 },
    { query: { refetchInterval: 10000, queryKey: getGetTradesQueryKey({ filter: timeFilter, limit: 200 }) } }
  );

  const paginated = raw as PaginatedTrades | undefined;
  const allTrades: Trade[] = paginated?.trades ?? (Array.isArray(raw) ? (raw as Trade[]) : []);

  // Client-side mode filter
  const trades = modeFilter === "all"
    ? allTrades
    : allTrades.filter((t) => (t.mode ?? "live") === modeFilter);

  // MEV stats (on filtered trades)
  const mevCount = trades.filter((t) => t.mevProtected).length;
  const mevPct = trades.length > 0 ? Math.round((mevCount / trades.length) * 100) : 0;
  const mevProfitEth = trades.filter((t) => t.mevProtected).reduce((s, t) => s + t.profitEth, 0);
  const stdProfitEth = trades.filter((t) => !t.mevProtected).reduce((s, t) => s + t.profitEth, 0);

  // Mode breakdown
  const liveCount = allTrades.filter((t) => (t.mode ?? "live") === "live").length;
  const paperCount = allTrades.filter((t) => t.mode === "paper").length;

  const exportCsv = () => {
    if (!trades.length) return;
    const headers = ["Time", "Token", "Mode", "Entry", "Exit", "Profit%", "ProfitETH", "Hold", "Reason", "MEV"];
    const rows = trades.map((t) => [
      new Date(t.exitTime).toLocaleString("id-ID"),
      t.tokenSymbol,
      t.mode ?? "live",
      t.entryPrice.toFixed(8),
      t.exitPrice.toFixed(8),
      t.profitPercent.toFixed(2),
      t.profitEth.toFixed(6),
      formatHold(t.holdSeconds),
      t.exitReason,
      t.mevProtected ? "YES" : "NO",
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trades_${timeFilter}_${modeFilter}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Trade History</div>
          {paginated?.total !== undefined && (
            <span className="text-[10px] text-muted-foreground font-mono">({trades.length} tampil / {paginated.total} total)</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Time filter */}
          <div className="flex rounded overflow-hidden border border-border">
            {(["today", "week", "all"] as const).map((f) => (
              <button
                key={f}
                data-testid={`button-filter-${f}`}
                onClick={() => setTimeFilter(f)}
                className={`px-2.5 py-1 text-[10px] font-mono transition-colors border-r border-border/30 last:border-r-0 ${
                  timeFilter === f
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {TIME_FILTER_LABELS[f]}
              </button>
            ))}
          </div>

          {/* Mode filter */}
          <div className="flex rounded overflow-hidden border border-border">
            {(["all", "live", "paper"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setModeFilter(m)}
                className={`px-2.5 py-1 text-[10px] font-mono transition-colors border-r border-border/30 last:border-r-0 ${
                  modeFilter === m
                    ? m === "live"
                      ? "bg-loss/20 text-loss"
                      : m === "paper"
                      ? "bg-warn/20 text-warn"
                      : "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {MODE_FILTER_LABELS[m]}
              </button>
            ))}
          </div>

          <button
            data-testid="button-export-csv"
            onClick={exportCsv}
            className="px-2.5 py-1 text-[10px] font-mono border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 rounded transition-colors"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Mode breakdown summary */}
      {allTrades.length > 0 && modeFilter === "all" && (
        <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
          <span>Breakdown:</span>
          <span className="text-loss font-bold">{liveCount} LIVE</span>
          <span className="text-warn font-bold">{paperCount} PAPER</span>
          <span className="text-muted-foreground/50">— gunakan filter mode untuk pisahkan</span>
        </div>
      )}

      {/* MEV Summary Bar */}
      {trades.length > 0 && (
        <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-muted/30 border border-border/50">
          <div className="text-center">
            <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider mb-0.5">MEV Protected</div>
            <div className="text-sm font-bold font-mono text-primary">{mevPct}%</div>
            <div className="text-[10px] text-muted-foreground font-mono">{mevCount}/{trades.length} trade</div>
          </div>
          <div className="text-center border-x border-border/50">
            <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider mb-0.5">P&L via MEV</div>
            <div className={`text-sm font-bold font-mono ${mevProfitEth >= 0 ? "text-profit" : "text-loss"}`}>
              {mevProfitEth >= 0 ? "+" : ""}{mevProfitEth.toFixed(5)} ETH
            </div>
            <div className="text-[10px] text-muted-foreground font-mono">dRPC MEV Blocker</div>
          </div>
          <div className="text-center">
            <div className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider mb-0.5">P&L via STD</div>
            <div className={`text-sm font-bold font-mono ${stdProfitEth >= 0 ? "text-profit" : "text-loss"}`}>
              {stdProfitEth >= 0 ? "+" : ""}{stdProfitEth.toFixed(5)} ETH
            </div>
            <div className="text-[10px] text-muted-foreground font-mono">Standard RPC</div>
          </div>
        </div>
      )}

      {/* MEV bar chart */}
      {trades.length > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
            <span>MEV Protected</span>
            <span>Standard RPC</span>
          </div>
          <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
            <div
              className="bg-primary transition-all duration-500"
              style={{ width: `${mevPct}%` }}
            />
            <div className="bg-border flex-1" />
          </div>
          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-primary">{mevPct}% ✓ MEV</span>
            <span className="text-muted-foreground">{100 - mevPct}% STD</span>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-auto max-h-[320px]">
        <table className="w-full text-xs font-mono" data-testid="table-trade-history">
          <thead>
            <tr className="text-[10px] text-muted-foreground uppercase tracking-wider border-b border-border sticky top-0 bg-card">
              <th className="text-left py-1.5 pr-2">Time</th>
              <th className="text-left pr-2">Token</th>
              <th className="text-left pr-2">Mode</th>
              <th className="text-right pr-2">Entry</th>
              <th className="text-right pr-2">Exit</th>
              <th className="text-right pr-2">P%</th>
              <th className="text-right pr-2">Hold</th>
              <th className="text-right pr-2">Reason</th>
              <th className="text-right">MEV</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <motion.tr
                key={trade.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="border-b border-border/40 hover:bg-muted/20 transition-colors"
                data-testid={`row-trade-${trade.id}`}
              >
                <td className="py-1.5 pr-2 text-muted-foreground whitespace-nowrap">
                  {formatTime(trade.exitTime)}
                </td>
                <td className="pr-2 font-bold text-foreground">{trade.tokenSymbol}</td>
                <td className="pr-2">
                  <ModeBadge mode={trade.mode} />
                </td>
                <td className="text-right pr-2 text-muted-foreground">${trade.entryPrice.toFixed(6)}</td>
                <td className="text-right pr-2 text-muted-foreground">${trade.exitPrice.toFixed(6)}</td>
                <td className={`text-right pr-2 font-bold ${trade.profitPercent >= 0 ? "text-profit" : "text-loss"}`}>
                  {trade.profitPercent >= 0 ? "+" : ""}{trade.profitPercent.toFixed(2)}%
                </td>
                <td className="text-right pr-2 text-muted-foreground">{formatHold(trade.holdSeconds)}</td>
                <td className="text-right pr-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                    trade.exitReason === "stop_loss" || trade.exitReason === "emergency"
                      ? "bg-loss/10 text-loss"
                      : trade.exitReason === "trailing_stop" || trade.exitReason === "force_exit"
                      ? "bg-warn/10 text-warn"
                      : "bg-primary/10 text-primary"
                  }`}>
                    {REASON_LABELS[trade.exitReason] || trade.exitReason}
                  </span>
                </td>
                <td className="text-right">
                  <MevBadge protected={trade.mevProtected} />
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>

        {trades.length === 0 && (
          <div className="py-8 text-center text-muted-foreground text-[11px] font-mono" data-testid="text-no-trades">
            Tidak ada trade {modeFilter !== "all" ? `mode ${modeFilter.toUpperCase()} ` : ""}untuk {TIME_FILTER_LABELS[timeFilter].toLowerCase()}
          </div>
        )}
      </div>
    </div>
  );
}
