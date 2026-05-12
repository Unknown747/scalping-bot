import { useEffect, useRef, useState } from "react";

type LogEntry = {
  id: number;
  level: string;
  message: string;
  tokenSymbol?: string | null;
  timestamp: string;
};

const LEVEL_CONFIG: Record<string, { label: string; color: string }> = {
  buy: { label: "BUY", color: "text-profit" },
  sell: { label: "SELL", color: "text-warn" },
  stop_loss: { label: "SL", color: "text-loss" },
  force_exit: { label: "PEAK", color: "text-warn" },
  error: { label: "ERR", color: "text-loss" },
  warn: { label: "WARN", color: "text-warn" },
  info: { label: "INFO", color: "text-muted-foreground" },
};

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

export function LogConsole({ logs }: { logs: LogEntry[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [locked, setLocked] = useState(false);

  // Auto-scroll: scroll CONTAINER not page (use scrollTop, not scrollIntoView)
  useEffect(() => {
    if (locked) return;
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs, locked]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // If user scrolled up more than 60px, lock auto-scroll
    if (distFromBottom > 60) {
      setLocked(true);
    }
  };

  const scrollToBottom = () => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setLocked(false);
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3 flex flex-col" style={{ minHeight: 340 }}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Bot Console</div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-muted-foreground">{logs.length} entries</span>
          {locked ? (
            <button
              onClick={scrollToBottom}
              className="text-[10px] font-mono px-2 py-0.5 rounded border border-primary/40 text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
            >
              ↓ scroll baru
            </button>
          ) : (
            <button
              onClick={() => setLocked(true)}
              className="text-[10px] font-mono px-2 py-0.5 rounded border border-border text-muted-foreground hover:bg-muted transition-colors"
            >
              ⏸ pause
            </button>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto log-console space-y-0.5"
        style={{ maxHeight: 280 }}
        data-testid="log-console"
      >
        {logs.map((log) => {
          const cfg = LEVEL_CONFIG[log.level] || LEVEL_CONFIG.info;
          return (
            <div
              key={log.id}
              className="flex gap-2 py-0.5 border-b border-border/20 last:border-0"
              data-testid={`log-entry-${log.id}`}
            >
              <span className="text-muted-foreground shrink-0 opacity-60 tabular-nums">
                {formatTime(log.timestamp)}
              </span>
              <span className={`font-bold shrink-0 w-10 text-center ${cfg.color}`}>
                [{cfg.label}]
              </span>
              {log.tokenSymbol && (
                <span className="text-primary shrink-0 font-bold">{log.tokenSymbol}</span>
              )}
              <span className="text-foreground/80 truncate">{log.message}</span>
            </div>
          );
        })}

        {logs.length === 0 && (
          <div className="py-8 text-center text-muted-foreground text-[11px]" data-testid="text-no-logs">
            Waiting for bot logs...
          </div>
        )}
      </div>
    </div>
  );
}
