import { useState } from "react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";

type ModeStats = {
  mode: "live" | "paper";
  todayPnlEth: number;
  todayPnlIdr: number;
  totalTradesDay: number;
  winningTradesDay: number;
  winRateDay: number;
  avgHoldSeconds: number;
  capitalEth?: number;
  capitalIdr?: number;
  ethPriceUsd?: number;
};

type Stats = ModeStats & {
  capitalEth: number;
  capitalIdr: number;
  ethPriceUsd: number;
};

type BothStats = {
  live: ModeStats;
  paper: ModeStats;
  currentMode: string;
  capitalEth: number;
  capitalIdr: number;
  ethPriceUsd: number;
};

type BotStatus = {
  running: boolean;
  activePositions: number;
  totalTradesDay: number;
  winRateDay: number;
};

function formatIdr(amount: number): string {
  return "Rp " + Math.abs(amount).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function formatHold(seconds: number): string {
  if (!seconds) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function StatCard({
  label,
  value,
  sub,
  positive,
  dimmed,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean | null;
  dimmed?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-card border border-border rounded-lg p-3 flex flex-col gap-1 min-w-0 transition-opacity ${dimmed ? "opacity-50" : ""}`}
    >
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{label}</div>
      <div className={`text-lg font-bold font-mono truncate ${
        positive === true ? "text-profit glow-profit" :
        positive === false ? "text-loss glow-loss" :
        "text-foreground"
      }`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
    </motion.div>
  );
}

function StatsSection({
  modeStats,
  botStatus,
  capitalEth,
  capitalIdr,
  ethPriceUsd,
  dimmed,
}: {
  modeStats: ModeStats;
  botStatus?: BotStatus;
  capitalEth: number;
  capitalIdr: number;
  ethPriceUsd: number;
  dimmed?: boolean;
}) {
  const pnlEth = modeStats.todayPnlEth ?? 0;
  const pnlIdr = modeStats.todayPnlIdr ?? 0;
  const winRate = modeStats.winRateDay ?? 0;
  const totalTrades = modeStats.totalTradesDay ?? 0;
  const avgHold = modeStats.avgHoldSeconds ?? 0;
  const isPaper = modeStats.mode === "paper";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      <StatCard
        label={isPaper ? "Today PnL [PAPER]" : "Today PnL [LIVE]"}
        value={`${pnlEth >= 0 ? "+" : ""}${pnlEth.toFixed(6)} ETH`}
        sub={`${pnlIdr >= 0 ? "+" : "-"}${formatIdr(pnlIdr)}`}
        positive={pnlEth > 0 ? true : pnlEth < 0 ? false : null}
        dimmed={dimmed}
      />
      <StatCard
        label="Win Rate"
        value={`${winRate.toFixed(1)}%`}
        sub={`${modeStats.winningTradesDay ?? 0}W / ${totalTrades - (modeStats.winningTradesDay ?? 0)}L`}
        positive={winRate >= 60 ? true : winRate < 50 ? false : null}
        dimmed={dimmed}
      />
      <StatCard
        label="Trades Today"
        value={String(totalTrades)}
        sub={`${isPaper ? "sim" : (botStatus?.activePositions ?? 0) + " open"}`}
        positive={null}
        dimmed={dimmed}
      />
      <StatCard
        label="Avg Hold"
        value={formatHold(avgHold)}
        positive={null}
        dimmed={dimmed}
      />
      <StatCard
        label="Capital"
        value={`${capitalEth.toFixed(4)} ETH`}
        sub={formatIdr(capitalIdr)}
        positive={null}
        dimmed={dimmed}
      />
      <StatCard
        label="ETH Price"
        value={`$${ethPriceUsd.toLocaleString()}`}
        positive={null}
        dimmed={dimmed}
      />
    </div>
  );
}

function ResetStatsButton({ currentMode }: { currentMode: string }) {
  const [confirm, setConfirm] = useState<"live" | "paper" | "all" | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const doReset = async (mode: "live" | "paper" | "all") => {
    setLoading(true);
    try {
      const res = await fetch(`/api/stats/reset?mode=${mode}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setMsg(`Data ${mode.toUpperCase()} berhasil dihapus`);
        queryClient.invalidateQueries();
      } else {
        setMsg("Gagal reset");
      }
    } catch {
      setMsg("Error koneksi");
    } finally {
      setLoading(false);
      setConfirm(null);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  if (msg) {
    return (
      <span className="text-[10px] font-mono text-profit px-2 py-1 rounded border border-profit/30 bg-profit/10">
        ✓ {msg}
      </span>
    );
  }

  if (confirm) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-mono text-loss">
          Hapus data {confirm.toUpperCase()}?
        </span>
        <button
          onClick={() => doReset(confirm)}
          disabled={loading}
          className="text-[10px] font-mono px-2 py-0.5 rounded bg-loss/20 text-loss border border-loss/40 hover:bg-loss/30 transition-colors disabled:opacity-50"
        >
          {loading ? "..." : "Ya, hapus"}
        </button>
        <button
          onClick={() => setConfirm(null)}
          className="text-[10px] font-mono px-2 py-0.5 rounded border border-border text-muted-foreground hover:bg-muted transition-colors"
        >
          Batal
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] text-muted-foreground font-mono">Reset:</span>
      {(["live", "paper", "all"] as const).map((m) => (
        <button
          key={m}
          onClick={() => setConfirm(m)}
          className={`text-[9px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
            m === "live"
              ? "border-loss/40 text-loss/70 hover:bg-loss/10"
              : m === "paper"
              ? "border-warn/40 text-warn/70 hover:bg-warn/10"
              : "border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          {m === "all" ? "SEMUA" : m.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

type Props = {
  stats?: Stats;
  botStatus?: BotStatus;
  bothStats?: BothStats;
};

export function StatsRow({ stats, botStatus, bothStats }: Props) {
  const [view, setView] = useState<"current" | "live" | "paper" | "both">("current");

  const currentMode = bothStats?.currentMode ?? stats?.mode ?? "paper";
  const isPaperCurrent = currentMode === "paper";

  const capitalEth = bothStats?.capitalEth ?? stats?.capitalEth ?? 0;
  const capitalIdr = bothStats?.capitalIdr ?? stats?.capitalIdr ?? 0;
  const ethPriceUsd = bothStats?.ethPriceUsd ?? stats?.ethPriceUsd ?? 0;

  const fallbackStats: ModeStats = {
    mode: (stats?.mode as "live" | "paper") ?? "paper",
    todayPnlEth: stats?.todayPnlEth ?? 0,
    todayPnlIdr: stats?.todayPnlIdr ?? 0,
    totalTradesDay: stats?.totalTradesDay ?? botStatus?.totalTradesDay ?? 0,
    winningTradesDay: stats?.winningTradesDay ?? 0,
    winRateDay: stats?.winRateDay ?? botStatus?.winRateDay ?? 0,
    avgHoldSeconds: stats?.avgHoldSeconds ?? 0,
  };

  const liveStats = bothStats?.live ?? (currentMode === "live" ? fallbackStats : { mode: "live" as const, todayPnlEth: 0, todayPnlIdr: 0, totalTradesDay: 0, winningTradesDay: 0, winRateDay: 0, avgHoldSeconds: 0 });
  const paperStats = bothStats?.paper ?? (currentMode === "paper" ? fallbackStats : { mode: "paper" as const, todayPnlEth: 0, todayPnlIdr: 0, totalTradesDay: 0, winningTradesDay: 0, winRateDay: 0, avgHoldSeconds: 0 });

  const currentStats = isPaperCurrent ? paperStats : liveStats;

  const tabs = [
    { key: "current" as const, label: isPaperCurrent ? "PAPER" : "LIVE" },
    { key: "live" as const, label: "LIVE" },
    { key: "paper" as const, label: "PAPER" },
    { key: "both" as const, label: "KEDUANYA" },
  ];

  return (
    <div className="space-y-2" data-testid="stats-row">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-mono">Tampilan Stats:</div>
        <div className="flex rounded overflow-hidden border border-border">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setView(tab.key)}
              className={`px-2.5 py-1 text-[10px] font-mono transition-colors ${
                view === tab.key
                  ? tab.key === "live" || (tab.key === "current" && !isPaperCurrent)
                    ? "bg-loss/20 text-loss border-r border-border/50"
                    : tab.key === "paper" || (tab.key === "current" && isPaperCurrent)
                    ? "bg-warn/20 text-warn border-r border-border/50"
                    : "bg-primary/20 text-primary border-r border-border/50"
                  : "text-muted-foreground hover:bg-muted border-r border-border/30 last:border-r-0"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
          isPaperCurrent
            ? "bg-warn/10 text-warn border-warn/30"
            : "bg-loss/10 text-loss border-loss/30"
        }`}>
          Bot aktif: {currentMode.toUpperCase()}
        </span>

        <div className="ml-auto">
          <ResetStatsButton currentMode={currentMode} />
        </div>
      </div>

      {view === "current" && (
        <StatsSection
          modeStats={currentStats}
          botStatus={botStatus}
          capitalEth={capitalEth}
          capitalIdr={capitalIdr}
          ethPriceUsd={ethPriceUsd}
        />
      )}
      {view === "live" && (
        <StatsSection
          modeStats={liveStats}
          botStatus={botStatus}
          capitalEth={capitalEth}
          capitalIdr={capitalIdr}
          ethPriceUsd={ethPriceUsd}
        />
      )}
      {view === "paper" && (
        <StatsSection
          modeStats={paperStats}
          botStatus={undefined}
          capitalEth={capitalEth}
          capitalIdr={capitalIdr}
          ethPriceUsd={ethPriceUsd}
        />
      )}
      {view === "both" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-mono font-bold text-loss border border-loss/30 bg-loss/10 px-1.5 py-0.5 rounded">
              LIVE — Mainnet
            </span>
          </div>
          <StatsSection
            modeStats={liveStats}
            botStatus={botStatus}
            capitalEth={capitalEth}
            capitalIdr={capitalIdr}
            ethPriceUsd={ethPriceUsd}
          />
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[9px] font-mono font-bold text-warn border border-warn/30 bg-warn/10 px-1.5 py-0.5 rounded">
              PAPER — Simulasi
            </span>
          </div>
          <StatsSection
            modeStats={paperStats}
            botStatus={undefined}
            capitalEth={capitalEth}
            capitalIdr={capitalIdr}
            ethPriceUsd={ethPriceUsd}
          />
        </div>
      )}
    </div>
  );
}
