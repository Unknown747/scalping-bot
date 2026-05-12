import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

type Trade = { exitTime: string; profitEth: number; tokenSymbol: string };
type PaginatedTrades = { trades: Trade[] };

type ChartPoint = {
  time: string;
  cumPnlEth: number;
  tradePnl: number;
  symbol: string;
};

const PROFIT_COLOR = "hsl(142, 70%, 45%)";
const LOSS_COLOR = "hsl(0, 72%, 51%)";

async function fetchTradesByMode(mode: "live" | "paper"): Promise<Trade[]> {
  const res = await fetch(`/api/trades?filter=today&limit=500&mode=${mode}`, { credentials: "include" });
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

export function PnlChart() {
  const [mode, setMode] = useState<"live" | "paper">("live");

  const { data: trades = [] } = useQuery({
    queryKey: ["pnl-chart", mode],
    queryFn: () => fetchTradesByMode(mode),
    refetchInterval: 15000,
  });

  const sorted = [...trades].sort(
    (a, b) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime()
  );

  let cum = 0;
  const chartData: ChartPoint[] = sorted.map((t) => {
    cum += t.profitEth;
    return {
      time: new Date(t.exitTime).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
      cumPnlEth: parseFloat(cum.toFixed(6)),
      tradePnl: parseFloat(t.profitEth.toFixed(6)),
      symbol: t.tokenSymbol,
    };
  });

  const finalPnl = chartData[chartData.length - 1]?.cumPnlEth ?? 0;
  const isPositive = finalPnl >= 0;
  const strokeColor = isPositive ? PROFIT_COLOR : LOSS_COLOR;

  const minVal = Math.min(0, ...chartData.map((d) => d.cumPnlEth));
  const maxVal = Math.max(0, ...chartData.map((d) => d.cumPnlEth));
  const range = maxVal - minVal || 0.0001;
  const zeroOffset = Math.abs(maxVal) / range;

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
            Cumulative PnL — Hari Ini
          </div>
          {/* LIVE / PAPER tab */}
          <div className="flex rounded overflow-hidden border border-border">
            <button
              onClick={() => setMode("live")}
              className={`px-2.5 py-0.5 text-[10px] font-mono border-r border-border/30 transition-colors ${
                mode === "live" ? "bg-loss/20 text-loss" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              LIVE
            </button>
            <button
              onClick={() => setMode("paper")}
              className={`px-2.5 py-0.5 text-[10px] font-mono transition-colors ${
                mode === "paper" ? "bg-warn/20 text-warn" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              PAPER
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-bold font-mono ${isPositive ? "text-profit" : "text-loss"}`}>
            {isPositive ? "+" : ""}{finalPnl.toFixed(6)} ETH
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">{trades.length} trade</span>
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="h-[140px] flex items-center justify-center text-muted-foreground text-[11px] font-mono">
          Belum ada trade {mode.toUpperCase()} hari ini
        </div>
      ) : (
        <div style={{ height: 140 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
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
                fill="url(#pnlGrad)"
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
