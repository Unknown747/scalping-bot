import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBotStatus, useGetStats, useGetPositions,
  useGetWalletBalance, useGetScannedTokens, useGetLogs, useGetConfig,
  useStartBot, useStopBot, useEmergencyStop, useClosePosition, useUpdateConfig,
  getGetBotStatusQueryKey, getGetStatsQueryKey, getGetPositionsQueryKey,
  getGetTradesQueryKey, getGetConfigQueryKey,
  getGetScannedTokensQueryKey, getGetLogsQueryKey, getGetWalletBalanceQueryKey,
} from "@workspace/api-client-react";
import { useSocket, type AIDecisionEntry } from "../hooks/useSocket";
import { useAuth } from "../hooks/useAuth";
import { StatsRow } from "../components/StatsRow";
import { ControlPanel } from "../components/ControlPanel";
import { WalletCard } from "../components/WalletCard";
import { ActivePositions } from "../components/ActivePositions";
import { TokenScanner } from "../components/TokenScanner";
import { TradeHistory } from "../components/TradeHistory";
import { LogConsole } from "../components/LogConsole";
import { PnlChart } from "../components/PnlChart";
import { FullSettingsPanel } from "../components/FullSettingsPanel";
import { AIDecisionLog } from "../components/AIDecisionLog";
import { SecurityAuditCard } from "../components/SecurityAuditCard";
import { toast } from "sonner";

type LogEntry = { id: number; level: string; message: string; tokenSymbol?: string | null; timestamp: string };
type TokenEntry = {
  address: string; symbol: string; name: string; priceUsd: number;
  priceChangePercent5m: number; priceChangePercent1h: number;
  volumeUsd5m: number; liquidityUsd: number; ageMinutes: number;
  safetyScore: number; passedFilters: boolean; scannedAt: string; dexUrl?: string | null;
};

export function Dashboard() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [liveTokens, setLiveTokens] = useState<TokenEntry[]>([]);
  const [aiDecisions, setAIDecisions] = useState<AIDecisionEntry[]>([]);
  const queryClient = useQueryClient();
  const { logout } = useAuth();

  const { data: botStatus } = useGetBotStatus({
    query: { refetchInterval: 5000, queryKey: getGetBotStatusQueryKey() },
  });
  const { data: stats } = useGetStats({
    query: { refetchInterval: 10000, queryKey: getGetStatsQueryKey() },
  });
  const { data: positions } = useGetPositions({
    query: { refetchInterval: 3000, queryKey: getGetPositionsQueryKey() },
  });
  const { data: wallet } = useGetWalletBalance({
    query: { refetchInterval: 30000, queryKey: getGetWalletBalanceQueryKey() },
  });
  const { data: scannedTokens } = useGetScannedTokens(
    { limit: 30 },
    { query: { refetchInterval: 10000, queryKey: getGetScannedTokensQueryKey({ limit: 30 }) } }
  );
  const { data: logData } = useGetLogs(
    { limit: 200 },
    { query: { refetchInterval: 5000, queryKey: getGetLogsQueryKey({ limit: 200 }) } }
  );
  const { data: config } = useGetConfig({
    query: { refetchInterval: 15000, queryKey: getGetConfigQueryKey() },
  });

  const startBot = useStartBot();
  const stopBot = useStopBot();
  const emergencyStop = useEmergencyStop();
  const closePosition = useClosePosition();
  const updateConfig = useUpdateConfig();

  useEffect(() => {
    if (logData) {
      setLogs((prev) => {
        const existingIds = new Set(prev.map((l) => l.id));
        const newLogs = (logData as LogEntry[]).filter((l) => !existingIds.has(l.id));
        return [...prev, ...newLogs].slice(-500);
      });
    }
  }, [logData]);

  useEffect(() => {
    if (scannedTokens) {
      setLiveTokens(scannedTokens as TokenEntry[]);
    }
  }, [scannedTokens]);

  const { emit: _emit } = useSocket({
    onTradeExecuted: (data) => {
      const sign = data.profitPercent >= 0 ? "+" : "";
      if (data.profitPercent >= 0) {
        toast.success(`${data.tokenSymbol} ditutup ${sign}${data.profitPercent.toFixed(2)}%`);
      } else {
        toast.error(`${data.tokenSymbol} stop loss ${sign}${data.profitPercent.toFixed(2)}%`);
      }
    },
    onLogs: (newLogs) => {
      setLogs((prev) => [...prev, ...newLogs].slice(-500));
    },
    onTokens: (newTokens) => {
      setLiveTokens((prev) => {
        const merged = [...newTokens, ...prev];
        const seen = new Set<string>();
        return merged.filter((t) => {
          if (seen.has(t.address)) return false;
          seen.add(t.address);
          return true;
        }).slice(0, 50);
      });
    },
    onAIDecision: (entry) => {
      setAIDecisions((prev) => [entry, ...prev].slice(0, 100));
    },
  });

  const handleStartStop = () => {
    if (botStatus?.running) {
      stopBot.mutate(undefined, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
          toast.info("Bot dihentikan");
        },
        onError: () => toast.error("Gagal menghentikan bot"),
      });
    } else {
      startBot.mutate(undefined, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
          toast.success("Bot dijalankan");
        },
        onError: () => toast.error("Gagal menjalankan bot"),
      });
    }
  };

  const handleEmergencyStop = () => {
    emergencyStop.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPositionsQueryKey() });
        toast.error("Emergency stop — semua posisi ditutup");
      },
    });
  };

  const handleClosePosition = (address: string, percent: number) => {
    closePosition.mutate({ address, data: { percent } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPositionsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTradesQueryKey() });
        toast.success(`Posisi ditutup (${percent}%)`);
      },
      onError: () => toast.error("Gagal menutup posisi"),
    });
  };

  const handleRiskChange = (level: string) => {
    updateConfig.mutate({ data: { riskLevel: level as "conservative" | "moderate" | "aggressive" } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetConfigQueryKey() });
        toast.info(`Level risiko: ${level}`);
      },
    });
  };

  const handleModeToggle = (mode: "live" | "paper") => {
    updateConfig.mutate({ data: { mode } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetConfigQueryKey() });
        toast.info(`Mode diganti ke ${mode.toUpperCase()}`);
      },
    });
  };

  const handleLogout = async () => {
    await logout();
    toast.info("Berhasil keluar");
  };

  const isPaperMode = botStatus?.mode === "paper";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Paper trading banner — only shown if user deliberately switches to paper mode */}
      <AnimatePresence>
        {isPaperMode && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-warn/10 border-b border-warn/30 px-4 py-1.5 text-center overflow-hidden"
          >
            <span className="text-warn text-[11px] font-semibold tracking-widest uppercase">
              ⚠ PAPER MODE — Tidak ada dana nyata. Aktifkan LIVE di Settings → Trading → mode
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-primary blink" />
            <h1 className="text-lg font-bold tracking-tight text-foreground font-mono">
              BASE SCALPER
            </h1>
            <span className={`px-2 py-0.5 rounded text-xs font-bold font-mono ${
              botStatus?.mode === "live"
                ? "bg-loss/20 text-loss border border-loss/30"
                : "bg-warn/20 text-warn border border-warn/30"
            }`}>
              {(botStatus?.mode || "paper").toUpperCase()}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {wallet?.address && (
              <span className="text-xs text-muted-foreground font-mono hidden sm:block">
                {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
              </span>
            )}
            <span className="px-2 py-0.5 rounded text-xs font-bold bg-primary/20 text-primary border border-primary/30">
              BASE
            </span>
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-mono ${
              botStatus?.running
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${botStatus?.running ? "bg-primary blink" : "bg-muted-foreground"}`} />
              {botStatus?.running ? "RUNNING" : "STOPPED"}
            </div>

            {/* Logout button */}
            <button
              onClick={handleLogout}
              title="Keluar"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-border text-muted-foreground hover:text-loss hover:border-loss/50 transition-colors font-mono text-[11px]"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="hidden sm:inline">Keluar</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 py-4 space-y-4">
        <StatsRow stats={stats as any} botStatus={botStatus as any} />

        <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-4">
          <div className="space-y-4">
            <ControlPanel
              running={botStatus?.running || false}
              mode={botStatus?.mode || "paper"}
              onStartStop={handleStartStop}
              onEmergencyStop={handleEmergencyStop}
              onRiskChange={handleRiskChange}
              onModeToggle={handleModeToggle}
              isStarting={startBot.isPending}
              isStopping={stopBot.isPending}
              isEmergencyStopping={emergencyStop.isPending}
            />
            <SecurityAuditCard />
            <FullSettingsPanel />
            <WalletCard wallet={wallet as any} />
          </div>

          <div className="space-y-4">
            <ActivePositions
              positions={(positions as any) || []}
              onClose={handleClosePosition}
            />
            <TokenScanner tokens={liveTokens} />
          </div>
        </div>

        <PnlChart />

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <AIDecisionLog
            entries={aiDecisions}
            enabled={!!(config as any)?.enableAIFilter}
          />
          <LogConsole logs={logs} />
        </div>

        <TradeHistory />
      </main>
    </div>
  );
}
