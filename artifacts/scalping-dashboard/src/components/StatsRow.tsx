import { motion } from "framer-motion";

type Stats = {
  todayPnlEth: number;
  todayPnlIdr: number;
  totalTradesDay: number;
  winningTradesDay: number;
  winRateDay: number;
  avgHoldSeconds: number;
  capitalEth: number;
  capitalIdr: number;
  ethPriceUsd: number;
  mode?: string;
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

function StatCard({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean | null }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-lg p-3 flex flex-col gap-1 min-w-0"
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

export function StatsRow({ stats, botStatus }: { stats?: Stats; botStatus?: BotStatus }) {
  const pnlEth = stats?.todayPnlEth || 0;
  const pnlIdr = stats?.todayPnlIdr || 0;
  const winRate = stats?.winRateDay || botStatus?.winRateDay || 0;
  const totalTrades = stats?.totalTradesDay || botStatus?.totalTradesDay || 0;
  const avgHold = stats?.avgHoldSeconds || 0;
  const capital = stats?.capitalEth || 0;
  const capitalIdr = stats?.capitalIdr || 0;
  const mode = stats?.mode || "live";
  const isPaper = mode === "paper";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2" data-testid="stats-row">
      <StatCard
        label={isPaper ? "Today PnL [PAPER]" : "Today PnL [LIVE]"}
        value={`${pnlEth >= 0 ? "+" : ""}${pnlEth.toFixed(6)} ETH`}
        sub={`${pnlIdr >= 0 ? "+" : "-"}${formatIdr(pnlIdr)}`}
        positive={pnlEth > 0 ? true : pnlEth < 0 ? false : null}
      />
      <StatCard
        label="Win Rate"
        value={`${winRate.toFixed(1)}%`}
        sub={`${stats?.winningTradesDay || 0}W / ${(totalTrades - (stats?.winningTradesDay || 0))}L`}
        positive={winRate >= 60 ? true : winRate < 50 ? false : null}
      />
      <StatCard
        label="Trades Today"
        value={String(totalTrades)}
        sub={`${botStatus?.activePositions || 0} open`}
        positive={null}
      />
      <StatCard
        label="Avg Hold"
        value={formatHold(avgHold)}
        positive={null}
      />
      <StatCard
        label="Capital"
        value={`${capital.toFixed(4)} ETH`}
        sub={formatIdr(capitalIdr)}
        positive={null}
      />
      <StatCard
        label="ETH Price"
        value={`$${(stats?.ethPriceUsd || 0).toLocaleString()}`}
        positive={null}
      />
    </div>
  );
}
