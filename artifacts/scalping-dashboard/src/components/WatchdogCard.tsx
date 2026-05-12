import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface WatchdogStats {
  restartCount: number;
  lastScanTime: string;
  lastScanCycle: number;
  lastRestartTime: string | null;
}

function timeAgo(isoString: string): string {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return `${diff}s lalu`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m lalu`;
  return `${Math.floor(diff / 3600)}j lalu`;
}

export function WatchdogCard() {
  const [stats, setStats] = useState<WatchdogStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/bot/watchdog", { credentials: "include" });
      if (res.ok) setStats(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const id = setInterval(fetchStats, 30_000);
    return () => clearInterval(id);
  }, []);

  const staleSecs = stats
    ? Math.floor((Date.now() - new Date(stats.lastScanTime).getTime()) / 1000)
    : 0;
  const isStalled = staleSecs > 300;

  const statusLabel = !stats
    ? "—"
    : isStalled
    ? "MACET"
    : stats.restartCount >= 3
    ? "TIDAK STABIL"
    : stats.restartCount >= 1
    ? "WASPADA"
    : "NORMAL";

  const statusColor =
    !stats || isStalled || stats.restartCount >= 3
      ? "text-loss"
      : stats.restartCount >= 1
      ? "text-warn"
      : "text-primary";

  const borderColor =
    !stats || isStalled || stats.restartCount >= 3
      ? "border-loss/40 bg-loss/5"
      : stats.restartCount >= 1
      ? "border-warn/40 bg-warn/5"
      : "border-primary/30 bg-primary/5";

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-2">Watchdog</div>
        <div className="text-xs text-muted-foreground font-mono animate-pulse">Memuat...</div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className={`border rounded-lg overflow-hidden ${borderColor}`}>
      <button
        className="w-full p-4 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Watchdog</div>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); fetchStats(); }}
              className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded border border-border"
            >
              Refresh
            </button>
            <span className="text-muted-foreground text-xs">{expanded ? "▲" : "▼"}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-1">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            isStalled || stats.restartCount >= 3 ? "bg-loss" :
            stats.restartCount >= 1 ? "bg-warn" : "bg-primary blink"
          }`} />
          <span className={`text-sm font-bold font-mono ${statusColor}`}>
            {statusLabel}
          </span>
        </div>

        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
          {stats.restartCount === 0
            ? "Belum pernah restart"
            : `${stats.restartCount}× restart`}
          {" · "}
          scan {timeAgo(stats.lastScanTime)}
          {isStalled && (
            <span className="text-loss ml-1 font-semibold">⚠ STALL {Math.floor(staleSecs / 60)}m</span>
          )}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border divide-y divide-border/50">
              <Row label="Restart Count" value={String(stats.restartCount)} color={
                stats.restartCount >= 3 ? "text-loss" :
                stats.restartCount >= 1 ? "text-warn" : "text-primary"
              } />
              <Row
                label="Scan Terakhir"
                value={timeAgo(stats.lastScanTime)}
                color={isStalled ? "text-loss" : "text-foreground"}
                sub={isStalled ? `Stall ${Math.floor(staleSecs / 60)}m ${staleSecs % 60}s` : undefined}
              />
              <Row
                label="Siklus Scan"
                value={stats.lastScanCycle >= 0 ? `#${stats.lastScanCycle}` : "belum mulai"}
                color="text-foreground"
              />
              <Row
                label="Restart Terakhir"
                value={stats.lastRestartTime ? timeAgo(stats.lastRestartTime) : "—"}
                color={stats.lastRestartTime ? "text-warn" : "text-muted-foreground"}
                sub={stats.lastRestartTime
                  ? new Date(stats.lastRestartTime).toLocaleTimeString("id-ID")
                  : undefined}
              />
            </div>

            <div className="px-4 py-2 text-[10px] text-muted-foreground font-mono border-t border-border/50">
              Cek setiap 60s · restart jika stall &gt;5m · cooldown 30s
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Row({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: string;
  color: string;
  sub?: string;
}) {
  return (
    <div className="px-4 py-2.5 flex items-start justify-between gap-2">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono flex-shrink-0">
        {label}
      </span>
      <div className="text-right">
        <span className={`text-xs font-mono font-semibold ${color}`}>{value}</span>
        {sub && (
          <div className="text-[10px] text-muted-foreground font-mono">{sub}</div>
        )}
      </div>
    </div>
  );
}
