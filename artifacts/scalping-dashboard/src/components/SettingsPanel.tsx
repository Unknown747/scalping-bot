import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { useGetConfig, useUpdateConfig, getGetConfigQueryKey } from "@workspace/api-client-react";
import { toast } from "sonner";

type OptKey =
  | "enableDynamicPositionSizing"
  | "enableBreakEvenAfterTP1"
  | "enableTokenBlacklist"
  | "require1hMomentum";

interface Optimization {
  key: OptKey;
  label: string;
  description: string;
  colorOn: string;
  colorOff: string;
}

const OPTIMIZATIONS: Optimization[] = [
  {
    key: "enableDynamicPositionSizing",
    label: "Dynamic Position Sizing",
    description: "Scale trade size up/down based on safety & meme score (max 1.5×)",
    colorOn: "primary",
    colorOff: "muted",
  },
  {
    key: "enableBreakEvenAfterTP1",
    label: "Break-Even Stop",
    description: "After TP1 hit, exit immediately if price returns to entry",
    colorOn: "primary",
    colorOff: "muted",
  },
  {
    key: "enableTokenBlacklist",
    label: "Token Blacklist",
    description: "Block re-entry into tokens that triggered a recent stop-loss",
    colorOn: "primary",
    colorOff: "muted",
  },
  {
    key: "require1hMomentum",
    label: "1h Momentum Filter",
    description: "Only buy tokens with positive 1-hour price trend",
    colorOn: "primary",
    colorOff: "muted",
  },
];

function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none ${
        enabled ? "bg-primary" : "bg-border"
      }`}
      aria-checked={enabled}
      role="switch"
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 35 }}
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow ${
          enabled ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: config } = useGetConfig({
    query: { refetchInterval: 10000, queryKey: getGetConfigQueryKey() },
  });

  const updateConfig = useUpdateConfig();

  const handleToggle = (key: OptKey) => {
    if (!config) return;
    const current = (config as any)[key] as boolean;
    updateConfig.mutate(
      { data: { [key]: !current } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetConfigQueryKey() });
          const label = OPTIMIZATIONS.find((o) => o.key === key)?.label || key;
          toast.info(`${label}: ${!current ? "ON" : "OFF"}`);
        },
        onError: () => toast.error("Gagal update konfigurasi"),
      }
    );
  };

  const activeCount = config
    ? OPTIMIZATIONS.filter((o) => (config as any)[o.key]).length
    : 0;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
            Optimizations
          </div>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
              activeCount === 4
                ? "bg-primary/20 text-primary border border-primary/30"
                : activeCount > 0
                ? "bg-warn/20 text-warn border border-warn/30"
                : "bg-muted text-muted-foreground border border-border"
            }`}
          >
            {activeCount}/4
          </span>
        </div>
        <motion.svg
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="w-3.5 h-3.5 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </motion.svg>
      </button>

      {/* Collapsible content */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
              {OPTIMIZATIONS.map((opt) => {
                const enabled = config ? !!(config as any)[opt.key] : false;
                const isPending = updateConfig.isPending;

                return (
                  <div
                    key={opt.key}
                    className={`flex items-start justify-between gap-3 p-2.5 rounded-lg border transition-colors ${
                      enabled
                        ? "bg-primary/5 border-primary/20"
                        : "bg-muted/20 border-border"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-mono font-semibold ${enabled ? "text-primary" : "text-muted-foreground"}`}>
                        {opt.label}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                        {opt.description}
                      </div>
                    </div>
                    <div className="flex-shrink-0 pt-0.5">
                      <Toggle
                        enabled={enabled}
                        onToggle={() => !isPending && handleToggle(opt.key)}
                      />
                    </div>
                  </div>
                );
              })}

              <div className="text-[9px] text-muted-foreground/60 font-mono leading-tight pt-1">
                Perubahan berlaku langsung — tidak perlu restart bot
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
