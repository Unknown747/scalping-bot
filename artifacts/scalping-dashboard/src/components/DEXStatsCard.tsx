import { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { DexQuoteEntry, DexQuoteItem } from "../hooks/useSocket";

const DEX_COLOR: Record<string, { bar: string; badge: string; dot: string }> = {
  "Uniswap V3":    { bar: "bg-pink-500",    badge: "bg-pink-500/15 text-pink-400 border-pink-500/30",    dot: "bg-pink-500" },
  "Aerodrome V2":  { bar: "bg-blue-500",    badge: "bg-blue-500/15 text-blue-400 border-blue-500/30",    dot: "bg-blue-500" },
  "BaseSwap V2":   { bar: "bg-emerald-500", badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", dot: "bg-emerald-500" },
  "PancakeSwap V2":{ bar: "bg-yellow-500",  badge: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",  dot: "bg-yellow-500" },
};

function formatTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  catch { return ""; }
}

function formatQuote(q: string): string {
  const n = parseFloat(q);
  if (isNaN(n) || n === 0) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(2) + "K";
  if (n < 0.000001) return n.toExponential(2);
  return n.toFixed(6);
}

function QuoteBar({ quotes }: { quotes: DexQuoteItem[] }) {
  const values = quotes.map(q => parseFloat(q.quoteEth) || 0);
  const max = Math.max(...values, 1e-18);
  return (
    <div className="flex flex-col gap-1 mt-1.5">
      {quotes.map((q) => {
        const pct = max > 0 ? Math.max(3, (parseFloat(q.quoteEth) || 0) / max * 100) : 0;
        const hasQuote = parseFloat(q.quoteEth) > 0;
        const colors = DEX_COLOR[q.name] ?? { bar: "bg-muted", badge: "", dot: "bg-muted" };
        return (
          <div key={q.name} className="flex items-center gap-2">
            <span className={`text-[9px] font-mono w-[88px] shrink-0 truncate ${q.winner ? "text-foreground font-bold" : "text-muted-foreground/60"}`}>
              {q.name.replace(" V2", "").replace(" V3", "")}
            </span>
            <div className="flex-1 h-1.5 bg-muted/20 rounded-full overflow-hidden">
              {hasQuote && (
                <motion.div
                  className={`h-full rounded-full ${colors.bar} ${q.winner ? "opacity-100" : "opacity-40"}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                />
              )}
            </div>
            <span className={`text-[9px] font-mono w-16 text-right tabular-nums shrink-0 ${q.winner ? "text-foreground font-bold" : "text-muted-foreground/50"}`}>
              {hasQuote ? formatQuote(q.quoteEth) : "no pool"}
            </span>
            {q.winner && <span className="text-[8px] text-primary font-bold shrink-0">✓</span>}
          </div>
        );
      })}
    </div>
  );
}

function QuoteRow({ entry, rank }: { entry: DexQuoteEntry; rank: number }) {
  const [expanded, setExpanded] = useState(rank === 0);
  const colors = DEX_COLOR[entry.winner] ?? { badge: "bg-muted/20 text-muted-foreground border-border", dot: "bg-muted" };

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="border-b border-border/30 last:border-0"
    >
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/5 transition-colors"
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${colors.dot}`} />
        <span className="text-[11px] font-mono font-bold w-14 shrink-0 truncate text-foreground/80">
          {entry.tokenSymbol}
        </span>
        <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border shrink-0 ${colors.badge}`}>
          {entry.winner.replace(" V2", "").replace(" V3", "").toUpperCase()}
        </span>
        <span className="flex-1" />
        <span className="text-[9px] font-mono text-muted-foreground/40 shrink-0 tabular-nums">
          {formatTime(entry.timestamp)}
        </span>
        <motion.span
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.15 }}
          className="text-[9px] text-muted-foreground/30 shrink-0"
        >
          ▾
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2.5">
              <QuoteBar quotes={entry.quotes} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

type Props = { entries: DexQuoteEntry[] };

export function DEXStatsCard({ entries }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, [entries.length]);

  // Aggregate win counts
  const winCounts: Record<string, number> = {};
  for (const e of entries) {
    winCounts[e.winner] = (winCounts[e.winner] ?? 0) + 1;
  }
  const topWinner = Object.entries(winCounts).sort(([, a], [, b]) => b - a)[0];
  const topColors = topWinner ? (DEX_COLOR[topWinner[0]] ?? { dot: "bg-muted" }) : null;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden flex flex-col" style={{ minHeight: 340 }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <div className="flex items-center gap-2.5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">DEX Quote Comparison</div>
          <span className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 tracking-wider">
            LIVE
          </span>
        </div>

        <div className="flex items-center gap-3 text-[9px] font-mono">
          {entries.length > 0 && (
            <span className="text-muted-foreground/60">{entries.length} comparisons</span>
          )}
          {topWinner && topColors && (
            <div className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${topColors.dot}`} />
              <span className="text-muted-foreground/70">
                top: {topWinner[0].replace(" V2","").replace(" V3","")} ({topWinner[1]}×)
              </span>
            </div>
          )}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-10 gap-2">
          <div className="text-2xl opacity-20 animate-pulse">⚖️</div>
          <div className="text-[11px] text-muted-foreground font-mono">Belum ada perbandingan DEX</div>
          <div className="text-[9px] text-muted-foreground/50 font-mono">
            Akan muncul saat bot mencoba beli token
          </div>
        </div>
      ) : (
        <>
          {/* Win count summary bar */}
          <div className="px-4 py-2 border-b border-border/30 flex items-center gap-3 flex-wrap">
            {Object.entries(DEX_COLOR).map(([dex, colors]) => {
              const wins = winCounts[dex] ?? 0;
              const pct = entries.length > 0 ? Math.round(wins / entries.length * 100) : 0;
              return (
                <div key={dex} className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                  <span className="text-[9px] font-mono text-muted-foreground/60">
                    {dex.replace(" V2","").replace(" V3","")}
                  </span>
                  <span className="text-[9px] font-mono font-bold text-foreground/70">
                    {wins}×
                  </span>
                  {pct > 0 && (
                    <span className="text-[8px] font-mono text-muted-foreground/40">
                      ({pct}%)
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div
            ref={containerRef}
            className="flex-1 overflow-y-auto log-console"
            style={{ maxHeight: 340 }}
          >
            <AnimatePresence initial={false}>
              {entries.map((entry, i) => (
                <QuoteRow key={`${entry.tokenAddress}-${entry.timestamp}`} entry={entry} rank={i} />
              ))}
            </AnimatePresence>
          </div>
        </>
      )}
    </div>
  );
}
