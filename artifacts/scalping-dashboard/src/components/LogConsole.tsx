import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

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
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    if (autoScrollRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = isAtBottom;
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3 flex flex-col" style={{ minHeight: 340 }}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Bot Console</div>
        <span className="text-[10px] font-mono text-muted-foreground">{logs.length} entries</span>
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto log-console space-y-0.5"
        style={{ maxHeight: 280 }}
        data-testid="log-console"
      >
        <AnimatePresence initial={false}>
          {logs.map((log) => {
            const cfg = LEVEL_CONFIG[log.level] || LEVEL_CONFIG.info;
            return (
              <motion.div
                key={log.id}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.15 }}
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
              </motion.div>
            );
          })}
        </AnimatePresence>

        {logs.length === 0 && (
          <div className="py-8 text-center text-muted-foreground text-[11px]" data-testid="text-no-logs">
            Waiting for bot logs...
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
