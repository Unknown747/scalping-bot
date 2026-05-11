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
};

const FILTER_LABELS: Record<string, string> = {
  today: "Today",
  week: "This Week",
  all: "All Time",
};

const REASON_LABELS: Record<string, string> = {
  tp1: "TP1",
  tp2: "TP2",
  tp3: "TP3",
  stop_loss: "SL",
  trailing_stop: "TRAIL",
  max_hold: "MAX",
  manual: "MANUAL",
  emergency: "EMRG",
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

export function TradeHistory() {
  const [filter, setFilter] = useState<"today" | "week" | "all">("today");

  const { data: trades } = useGetTrades(
    { filter, limit: 200 },
    { query: { refetchInterval: 10000, queryKey: getGetTradesQueryKey({ filter, limit: 200 }) } }
  );

  const exportCsv = () => {
    if (!trades?.length) return;
    const headers = ["Time", "Token", "Entry", "Exit", "Profit%", "ProfitETH", "Hold", "Reason"];
    const rows = (trades as Trade[]).map((t) => [
      new Date(t.exitTime).toLocaleString("id-ID"),
      t.tokenSymbol,
      t.entryPrice.toFixed(8),
      t.exitPrice.toFixed(8),
      t.profitPercent.toFixed(2),
      t.profitEth.toFixed(6),
      formatHold(t.holdSeconds),
      t.exitReason,
    ]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trades_${filter}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Trade History</div>
        <div className="flex items-center gap-2">
          <div className="flex rounded overflow-hidden border border-border">
            {(["today", "week", "all"] as const).map((f) => (
              <button
                key={f}
                data-testid={`button-filter-${f}`}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 text-[10px] font-mono transition-colors ${
                  filter === f
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {FILTER_LABELS[f]}
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

      <div className="overflow-auto max-h-[320px]">
        <table className="w-full text-xs font-mono" data-testid="table-trade-history">
          <thead>
            <tr className="text-[10px] text-muted-foreground uppercase tracking-wider border-b border-border sticky top-0 bg-card">
              <th className="text-left py-1.5 pr-2">Time</th>
              <th className="text-left pr-2">Token</th>
              <th className="text-right pr-2">Entry</th>
              <th className="text-right pr-2">Exit</th>
              <th className="text-right pr-2">P%</th>
              <th className="text-right pr-2">Hold</th>
              <th className="text-right">Reason</th>
            </tr>
          </thead>
          <tbody>
            {(trades as Trade[] | undefined)?.map((trade) => (
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
                <td className="text-right pr-2 text-muted-foreground">${trade.entryPrice.toFixed(6)}</td>
                <td className="text-right pr-2 text-muted-foreground">${trade.exitPrice.toFixed(6)}</td>
                <td className={`text-right pr-2 font-bold ${trade.profitPercent >= 0 ? "text-profit" : "text-loss"}`}>
                  {trade.profitPercent >= 0 ? "+" : ""}{trade.profitPercent.toFixed(2)}%
                </td>
                <td className="text-right pr-2 text-muted-foreground">{formatHold(trade.holdSeconds)}</td>
                <td className="text-right">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                    trade.exitReason === "stop_loss" || trade.exitReason === "emergency"
                      ? "bg-loss/10 text-loss"
                      : trade.exitReason === "trailing_stop"
                      ? "bg-warn/10 text-warn"
                      : "bg-primary/10 text-primary"
                  }`}>
                    {REASON_LABELS[trade.exitReason] || trade.exitReason}
                  </span>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>

        {(!trades || (trades as Trade[]).length === 0) && (
          <div className="py-8 text-center text-muted-foreground text-[11px] font-mono" data-testid="text-no-trades">
            No trades for {FILTER_LABELS[filter].toLowerCase()}
          </div>
        )}
      </div>
    </div>
  );
}
