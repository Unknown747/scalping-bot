import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

type Trade = { exitTime: string; profitEth: number; tokenSymbol: string; mode?: string };
type PaginatedTrades = { trades: Trade[] };

type ChartPoint = {
  time: string;
  cumPnlEth: number;
  tradePnl: number;
  symbol: string;
};

const PROFIT_COLOR = "hsl(142, 70%, 45%)";
const LOSS_COLOR = "hsl(0, 72%, 51%)";

async function fetchTradesByMode(filter: string, mode: "live" | "paper"): Promise<Trade[]> {
  const res = await fetch(`/api/trades?filter=${filter}&limit=500&mode=${mode}`, {
    credentials: "include",
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data as PaginatedTrades)?.trades ?? (Array.isArray(data) ? data : []);
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as ChartPoint;
  const pos = d.cumPnlEth >= 0;
  return (
    <div className="bg-card border border-border rounded px-2.5 py-1.5 text-[11px] font-mono space-y-0.5">
      <div className="text-muted-foreground">{d.time} — <span className="text-foreground">{d.symbol}</span></div>
      <div className={pos ? "text-profit" : "text-loss"}>
        Cum: {d.cumPnlEth >= 0 ? "+" : ""}{d.cumPnlEth.toFixed(6)} ETH
      </div>
      <div className={d.tradePnl >= 0 ? "text-profit" : "text-loss"}>
        Trade: {d.tradePnl >= 0 ? "+" : ""}{d.tradePnl.toFixed(6)} ETH
      </div>
    </div>
  );
}

function buildChartData(trades: Trade[]): ChartPoint[] {
  const sorted = [...trades].sort(
    (a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime()
  );
  let cum = 0;
  return sorted.map((t) => {
    cum += t.profitEth;
    return {
      time: new Date(t.exitTime).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
      cumPnlEth: parseFloat(cum.toFixed(6)),
      tradePnl: parseFloat(t.profitEth.toFixed(6)),
      symbol: t.tokenSymbol,
    };
  });
}

function ModeChart({ mode, label }: { mode: "live" | "paper"; label: string }) {
  const { data: trades = [] } = useQuery({
    queryKey: ["pnl-chart-trades", mode],
    queryFn: () => fetchTradesByMode("today", mode),
    refetchInterval: 15000,
  });

  const chartData = buildChartData(trades);
  const finalPnl = chartData[chartData.length - 1]?.cumPnlEth ?? 0;
  const isPositive = finalPnl >= 0;
  const strokeColor = isPositive ? PROFIT_COLOR : LOSS_COLOR;
  const gradientId = `pnlGrad-${mode}`;

  const minVal = Math.min(0, ...chartData.map((d) => d.cumPnlEth));
  const maxVal = Math.max(0, ...chartData.map((d) => d.cumPnlEth));
  const range = maxVal - minVal || 0.0001;
  const zeroOffset = Math.abs(maxVal) / range;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${
            mode === "live"
              ? "bg-loss/10 text-loss border-loss/30"
              : "bg-warn/10 text-warn border-warn/30"
          }`}>
            {label}
          </span>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
            Cumulative PnL — Hari Ini
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-bold font-mono ${isPositive ? "text-profit" : "text-loss"}`}>
            {isPositive ? "+" : ""}{finalPnl.toFixed(6)} ETH
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {trades.length} trade
          </span>
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="h-[120px] flex items-center justify-center text-muted-foreground text-[11px] font-mono border border-border/30 rounded bg-muted/10">
          Belum ada trade {mode.toUpperCase()} hari ini
        </div>
      ) : (
        <div style={{ height: 120 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset={`${zeroOffset * 100}%`} stopColor={PROFIT_COLOR} stopOpacity={0.25} />
                  <stop offset={`${zeroOffset * 100}%`} stopColor={LOSS_COLOR} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={LOSS_COLOR} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 9, fill: "hsl(215 20% 55%)", fontFamily: "monospace" }}
                interval="preserveStartEnd"
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 9, fill: "hsl(215 20% 55%)", fontFamily: "monospace" }}
                tickFormatter={(v: number) => v.toFixed(4)}
                axisLine={false}
                tickLine={false}
                width={62}
              />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.12)" strokeDasharray="4 4" />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="cumPnlEth"
                stroke={strokeColor}
                strokeWidth={1.5}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0, fill: strokeColor }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export function PnlChart() {
  const [view, setView] = useState<"live" | "paper" | "both">("live");

  const tabs = [
    { key: "live" as const, label: "LIVE — Mainnet" },
    { key: "paper" as const, label: "PAPER — Simulasi" },
    { key: "both" as const, label: "KEDUANYA" },
  ];

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      {/* Tab selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-mono">Chart PnL:</div>
        <div className="flex rounded overflow-hidden border border-border">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setView(tab.key)}
              className={`px-2.5 py-1 text-[10px] font-mono transition-colors border-r border-border/30 last:border-r-0 ${
                view === tab.key
                  ? tab.key === "live"
                    ? "bg-loss/20 text-loss"
                    : tab.key === "paper"
                    ? "bg-warn/20 text-warn"
                    : "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <span className="text-[9px] text-muted-foreground font-mono">
          Data live & paper <strong>tidak digabung</strong> — pilih tab untuk lihat masing-masing
        </span>
      </div>

      {view === "live" && <ModeChart mode="live" label="LIVE — Mainnet" />}
      {view === "paper" && <ModeChart mode="paper" label="PAPER — Simulasi" />}
      {view === "both" && (
        <div className="space-y-4">
          <ModeChart mode="live" label="LIVE — Mainnet" />
          <div className="border-t border-border/40" />
          <ModeChart mode="paper" label="PAPER — Simulasi" />
        </div>
      )}
    </div>
  );
}
