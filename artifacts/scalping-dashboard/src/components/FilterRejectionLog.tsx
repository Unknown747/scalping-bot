import { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { FilterRejectionEntry, FilterRejectionStage } from "../hooks/useSocket";

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

const STAGE_META: Record<FilterRejectionStage, { label: string; color: string; badge: string }> = {
  meme_score:    { label: "MemeScore",   color: "text-purple-400",  badge: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  new_listing:   { label: "New Listing", color: "text-blue-400",    badge: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  momentum_1h:   { label: "1h Momentum", color: "text-warn",        badge: "bg-warn/15 text-warn border-warn/30" },
  temp_blacklist:{ label: "Cooldown",    color: "text-orange-400",  badge: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  honeypot:      { label: "Honeypot",    color: "text-loss",        badge: "bg-loss/15 text-loss border-loss/30" },
  safety:        { label: "Safety",      color: "text-loss",        badge: "bg-loss/15 text-loss border-loss/30" },
  swap_failed:   { label: "Swap Gagal",  color: "text-loss",        badge: "bg-loss/15 text-loss border-loss/30" },
};

function RejectionRow({ entry }: { entry: FilterRejectionEntry }) {
  const [expanded, setExpanded] = useState(false);
  const meta = STAGE_META[entry.stage] ?? { label: entry.stage, color: "text-muted-foreground", badge: "bg-muted/20 text-muted-foreground border-border" };

  const hasDetails = Object.keys(entry.details).length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="border-b border-border/30 last:border-0 hover:bg-loss/3 transition-colors"
    >
      <button
        onClick={() => hasDetails && setExpanded((v) => !v)}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${hasDetails ? "cursor-pointer" : "cursor-default"}`}
      >
        <span className="text-loss/60 text-[10px] shrink-0">✗</span>

        <span className="text-[11px] font-mono font-bold w-20 shrink-0 truncate text-foreground/80">
          {entry.symbol}
        </span>

        <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border shrink-0 ${meta.badge}`}>
          {meta.label.toUpperCase()}
        </span>

        <span className="text-[9px] font-mono text-muted-foreground/70 truncate flex-1 text-left">
          {entry.reason}
        </span>

        <span className="text-[9px] font-mono text-muted-foreground/40 shrink-0 tabular-nums w-16 text-right">
          {formatTime(entry.timestamp)}
        </span>

        {hasDetails && (
          <motion.span
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.15 }}
            className="text-[9px] text-muted-foreground/30 shrink-0"
          >
            ▾
          </motion.span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && hasDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2 flex flex-wrap gap-x-3 gap-y-1">
              {Object.entries(entry.details).map(([k, v]) => (
                <span key={k} className="text-[9px] font-mono text-muted-foreground/60">
                  {k}:{" "}
                  <span className="text-foreground/70">
                    {Array.isArray(v) ? (v as string[]).join(", ") : String(v)}
                  </span>
                </span>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

type Props = {
  entries: FilterRejectionEntry[];
};

export function FilterRejectionLog({ entries }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

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

  const stageCounts = entries.reduce<Partial<Record<FilterRejectionStage, number>>>((acc, e) => {
    acc[e.stage] = (acc[e.stage] ?? 0) + 1;
    return acc;
  }, {});

  const topStage = Object.entries(stageCounts).sort(([, a], [, b]) => b - a)[0];

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden flex flex-col" style={{ minHeight: 340 }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <div className="flex items-center gap-2.5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Filter Rejection Log</div>
          <span className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded bg-loss/10 text-loss border border-loss/20 tracking-wider">
            LIVE
          </span>
        </div>

        {entries.length > 0 && (
          <div className="flex items-center gap-3 text-[9px] font-mono">
            <span className="text-loss/70">{entries.length} ditolak</span>
            {topStage && (
              <span className={`${STAGE_META[topStage[0] as FilterRejectionStage]?.color ?? "text-muted-foreground"}`}>
                top: {STAGE_META[topStage[0] as FilterRejectionStage]?.label ?? topStage[0]} ({topStage[1]}×)
              </span>
            )}
          </div>
        )}
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto log-console"
        style={{ maxHeight: 380 }}
      >
        {entries.length === 0 && (
          <div className="py-12 text-center space-y-2">
            <div className="text-2xl opacity-30 animate-pulse">🔍</div>
            <div className="text-[11px] text-muted-foreground font-mono">Belum ada token yang ditolak</div>
            <div className="text-[9px] text-muted-foreground/50 font-mono">
              Akan muncul saat bot menemukan dan memfilter token
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {entries.map((entry, i) => (
            <RejectionRow key={`${entry.address}-${entry.timestamp}-${i}`} entry={entry} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
