import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Position = {
  id: number;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  entryPrice: number;
  currentPrice: number;
  amountEth: number;
  profitPercent: number;
  profitEth: number;
  entryTime: string;
  holdSeconds: number;
  tp1Hit: boolean;
  tp2Hit: boolean;
  trailingStopActive: boolean;
  safetyScore: number;
  liquidityUsd: number;
  status: string;
};

function SafetyBadge({ score }: { score: number }) {
  const color = score >= 70 ? "text-primary bg-primary/10 border-primary/30"
    : score >= 50 ? "text-warn bg-warn/10 border-warn/30"
    : "text-loss bg-loss/10 border-loss/30";
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${color}`}>
      {score}
    </span>
  );
}

function HoldTimer({ entryTime }: { entryTime: string }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const calc = () => {
      const diff = Math.floor((Date.now() - new Date(entryTime).getTime()) / 1000);
      setSeconds(diff);
    };
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [entryTime]);

  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const isUrgent = seconds >= 780; // 13 minutes — 2 mins to max hold

  return (
    <span className={`font-mono text-xs ${isUrgent ? "text-loss blink" : "text-muted-foreground"}`}>
      {m}m {s.toString().padStart(2, "0")}s
    </span>
  );
}

function PositionCard({ pos, onClose }: { pos: Position; onClose: (addr: string, pct: number) => void }) {
  const profit = pos.profitPercent;
  const isProfit = profit >= 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`bg-card border rounded-lg p-3 space-y-2.5 ${
        isProfit ? "card-glow-profit border-profit/20" : "card-glow-loss border-loss/20"
      }`}
      data-testid={`card-position-${pos.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold font-mono text-sm text-foreground">{pos.tokenSymbol}</div>
          <div className="text-[10px] text-muted-foreground truncate">{pos.tokenName}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <SafetyBadge score={pos.safetyScore} />
          <HoldTimer entryTime={pos.entryTime} />
        </div>
      </div>

      {/* Prices */}
      <div className="grid grid-cols-2 gap-2 text-xs font-mono">
        <div>
          <div className="text-[10px] text-muted-foreground">Entry</div>
          <div className="text-foreground">${pos.entryPrice.toFixed(8)}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground">Current</div>
          <div className={isProfit ? "text-profit" : "text-loss"}>${pos.currentPrice.toFixed(8)}</div>
        </div>
      </div>

      {/* Profit bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs font-mono">
          <span className={`font-bold ${isProfit ? "text-profit glow-profit" : "text-loss glow-loss"}`}>
            {isProfit ? "+" : ""}{profit.toFixed(2)}%
          </span>
          <span className={isProfit ? "text-profit" : "text-loss"}>
            {isProfit ? "+" : ""}{pos.profitEth.toFixed(6)} ETH
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${isProfit ? "bg-profit" : "bg-loss"}`}
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(Math.abs(profit) * 5, 100)}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* TP indicators */}
      <div className="flex items-center gap-1.5">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${pos.tp1Hit ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>TP1</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${pos.tp2Hit ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>TP2</span>
        {pos.trailingStopActive && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-warn/20 text-warn">TRAIL</span>
        )}
        <div className="flex-1" />
        <button
          data-testid={`button-close-position-${pos.id}`}
          onClick={() => onClose(pos.tokenAddress, 100)}
          className="text-[10px] px-2 py-1 rounded border border-muted text-muted-foreground hover:border-loss hover:text-loss transition-colors font-mono"
        >
          CLOSE
        </button>
      </div>
    </motion.div>
  );
}

export function ActivePositions({ positions, onClose }: { positions: Position[]; onClose: (addr: string, pct: number) => void }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Active Positions</div>
        <span className="text-xs font-mono text-muted-foreground">{positions.length} open</span>
      </div>

      <AnimatePresence mode="popLayout">
        {positions.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="py-8 text-center text-muted-foreground text-xs font-mono"
            data-testid="text-no-positions"
          >
            No open positions
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
            {positions.map((pos) => (
              <PositionCard key={pos.tokenAddress} pos={pos} onClose={onClose} />
            ))}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
