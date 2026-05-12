import { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { AIDecisionEntry } from "../hooks/useSocket";

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function ConfidenceBar({ value, verdict }: { value: number; verdict: boolean }) {
  return (
    <div className="relative h-1 w-16 rounded-full bg-muted/30 overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${value}%` }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className={`absolute inset-y-0 left-0 rounded-full ${
          verdict ? "bg-profit" : "bg-loss"
        }`}
      />
    </div>
  );
}

const PROVIDER_BADGE: Record<string, string> = {
  Gemini:      "bg-blue-500/15 text-blue-400 border-blue-500/30",
  Groq:        "bg-purple-500/15 text-purple-400 border-purple-500/30",
  HuggingFace: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
};

function providerColor(provider: string): string {
  const key = provider.split("/")[0];
  return PROVIDER_BADGE[key] ?? "bg-muted/20 text-muted-foreground border-border";
}

function DecisionRow({ entry, index }: { entry: AIDecisionEntry; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`border-b border-border/30 last:border-0 ${
        entry.verdict
          ? "bg-profit/3 hover:bg-profit/5"
          : "bg-loss/3 hover:bg-loss/5"
      } transition-colors`}
    >
      {/* Main row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        {/* Verdict icon */}
        <span className={`text-sm shrink-0 ${entry.verdict ? "text-profit" : "text-loss/80"}`}>
          {entry.verdict ? "▲" : "▼"}
        </span>

        {/* Symbol */}
        <span className={`text-[11px] font-mono font-bold w-20 shrink-0 truncate ${
          entry.verdict ? "text-profit" : "text-loss"
        }`}>
          {entry.symbol}
        </span>

        {/* Decision badge */}
        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border shrink-0 ${
          entry.verdict
            ? "bg-profit/15 text-profit border-profit/30"
            : "bg-loss/10 text-loss/80 border-loss/20"
        }`}>
          {entry.decision.toUpperCase()}
        </span>

        {/* Confidence bar + number */}
        <div className="flex items-center gap-1.5 shrink-0">
          <ConfidenceBar value={entry.confidence} verdict={entry.verdict} />
          <span className={`text-[10px] font-mono tabular-nums ${
            entry.confidence >= 75 ? "text-profit" : entry.confidence >= 60 ? "text-warn" : "text-loss/70"
          }`}>
            {entry.confidence}%
          </span>
        </div>

        {/* Provider */}
        <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded border shrink-0 hidden sm:inline ${providerColor(entry.provider)}`}>
          {entry.provider.split("/")[0]}
        </span>

        {/* Latency */}
        <span className="text-[9px] font-mono text-muted-foreground/50 shrink-0 ml-auto tabular-nums">
          {entry.latencyMs}ms
        </span>

        {/* Time */}
        <span className="text-[9px] font-mono text-muted-foreground/50 shrink-0 tabular-nums w-16 text-right">
          {formatTime(entry.timestamp)}
        </span>

        {/* Expand chevron */}
        <motion.span
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.15 }}
          className="text-[9px] text-muted-foreground/40 shrink-0"
        >
          ▾
        </motion.span>
      </button>

      {/* Expanded detail */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2">
              {/* Scores row */}
              <div className="flex flex-wrap gap-2 text-[9px] font-mono">
                <span className="text-muted-foreground/60">
                  Safety: <span className="text-foreground/80">{entry.safetyScore}/100</span>
                </span>
                <span className="text-muted-foreground/60">
                  Meme: <span className="text-foreground/80">{entry.memeScore}/100</span>
                </span>
                <span className="text-muted-foreground/60">
                  5m: <span className={entry.priceChange5m >= 0 ? "text-profit" : "text-loss"}>
                    {entry.priceChange5m >= 0 ? "+" : ""}{entry.priceChange5m.toFixed(1)}%
                  </span>
                </span>
                <span className="text-muted-foreground/60">
                  Liq: <span className="text-foreground/80">${(entry.liquidityUsd / 1000).toFixed(0)}k</span>
                </span>
                <span className={`ml-auto px-1.5 py-0.5 rounded border ${providerColor(entry.provider)}`}>
                  {entry.provider} · {entry.model}
                </span>
              </div>

              {/* Reasons */}
              <div className="space-y-1">
                {entry.reasons.map((reason, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <span className={`text-[9px] shrink-0 mt-0.5 ${entry.verdict ? "text-profit/60" : "text-loss/50"}`}>
                      {entry.verdict ? "✓" : "✗"}
                    </span>
                    <span className="text-[9px] font-mono text-muted-foreground/80 leading-snug">{reason}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

type Props = {
  entries: AIDecisionEntry[];
  enabled: boolean;
};

export function AIDecisionLog({ entries, enabled }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Auto-scroll to top when new entries arrive (newest first)
  useEffect(() => {
    if (autoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [entries.length]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollTop < 40;
  };

  const buyCount = entries.filter((e) => e.verdict).length;
  const skipCount = entries.length - buyCount;
  const avgConfidence = entries.length
    ? Math.round(entries.reduce((s, e) => s + e.confidence, 0) / entries.length)
    : 0;
  const avgLatency = entries.length
    ? Math.round(entries.reduce((s, e) => s + e.latencyMs, 0) / entries.length)
    : 0;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden flex flex-col" style={{ minHeight: 340 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <div className="flex items-center gap-2.5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">AI Decision Log</div>
          {enabled ? (
            <span className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 tracking-wider">
              LIVE
            </span>
          ) : (
            <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-muted/20 text-muted-foreground border border-border">
              AI FILTER OFF
            </span>
          )}
        </div>

        {/* Stats */}
        {entries.length > 0 && (
          <div className="flex items-center gap-3 text-[9px] font-mono">
            <span className="text-profit">▲ {buyCount} BUY</span>
            <span className="text-loss/70">▼ {skipCount} SKIP</span>
            <span className="text-muted-foreground/60">avg {avgConfidence}% conf</span>
            <span className="text-muted-foreground/40">~{avgLatency}ms</span>
          </div>
        )}
      </div>

      {/* List */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto log-console"
        style={{ maxHeight: 380 }}
      >
        {!enabled && entries.length === 0 && (
          <div className="py-12 text-center space-y-2">
            <div className="text-2xl opacity-30">🤖</div>
            <div className="text-[11px] text-muted-foreground font-mono">AI Filter tidak aktif</div>
            <div className="text-[9px] text-muted-foreground/50 font-mono">
              Aktifkan di Settings → 🤖 AI → Aktifkan AI Filter
            </div>
          </div>
        )}

        {enabled && entries.length === 0 && (
          <div className="py-12 text-center space-y-2">
            <div className="text-2xl opacity-30 animate-pulse">🤖</div>
            <div className="text-[11px] text-muted-foreground font-mono">Menunggu analisis AI...</div>
            <div className="text-[9px] text-muted-foreground/50 font-mono">
              Akan muncul saat bot menemukan token kandidat
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {entries.map((entry, i) => (
            <DecisionRow key={`${entry.symbol}-${entry.timestamp}`} entry={entry} index={i} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
