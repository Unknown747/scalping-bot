import { motion, AnimatePresence } from "framer-motion";

type Token = {
  address: string;
  symbol: string;
  name: string;
  priceUsd: number;
  priceChangePercent5m: number;
  volumeUsd5m: number;
  liquidityUsd: number;
  ageMinutes: number;
  safetyScore: number;
  passedFilters: boolean;
  scannedAt: string;
  dexUrl?: string | null;
};

function fmt(n: number, digits = 1) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(digits)}`;
}

function SafeScore({ score }: { score: number }) {
  const c = score >= 70 ? "text-primary bg-primary/10" : score >= 50 ? "text-warn bg-warn/10" : "text-loss bg-loss/10";
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${c}`}>{score}</span>;
}

export function TokenScanner({ tokens }: { tokens: Token[] }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Token Scanner</div>
        <span className="text-[10px] text-muted-foreground font-mono">{tokens.length} scanned</span>
      </div>

      <div className="overflow-auto max-h-[280px]">
        <table className="w-full text-xs font-mono" data-testid="table-token-scanner">
          <thead>
            <tr className="text-[10px] text-muted-foreground uppercase tracking-wider border-b border-border">
              <th className="text-left py-1.5 pr-2">Symbol</th>
              <th className="text-right pr-2">5m %</th>
              <th className="text-right pr-2">Volume</th>
              <th className="text-right pr-2">Liq</th>
              <th className="text-right pr-2">Age</th>
              <th className="text-right pr-2">Safe</th>
              <th className="text-right">Pass</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {tokens.slice(0, 30).map((token) => (
                <motion.tr
                  key={`${token.address}-${token.scannedAt}`}
                  initial={{ opacity: 0, backgroundColor: "rgba(0,255,136,0.05)" }}
                  animate={{ opacity: 1, backgroundColor: "rgba(0,0,0,0)" }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.8 }}
                  className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => token.dexUrl && window.open(token.dexUrl, "_blank")}
                  data-testid={`row-token-${token.address.slice(2, 8)}`}
                >
                  <td className="py-1.5 pr-2">
                    <div className="font-bold text-foreground">{token.symbol}</div>
                    <div className="text-[10px] text-muted-foreground truncate max-w-[80px]">{token.name}</div>
                  </td>
                  <td className={`text-right pr-2 font-bold ${token.priceChangePercent5m >= 0 ? "text-profit" : "text-loss"}`}>
                    {token.priceChangePercent5m >= 0 ? "+" : ""}{token.priceChangePercent5m.toFixed(1)}%
                  </td>
                  <td className="text-right pr-2 text-foreground">{fmt(token.volumeUsd5m)}</td>
                  <td className="text-right pr-2 text-foreground">{fmt(token.liquidityUsd)}</td>
                  <td className="text-right pr-2 text-muted-foreground">
                    {token.ageMinutes < 60 ? `${Math.floor(token.ageMinutes)}m` : `${(token.ageMinutes / 60).toFixed(1)}h`}
                  </td>
                  <td className="text-right pr-2"><SafeScore score={token.safetyScore} /></td>
                  <td className="text-right">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                      token.passedFilters ? "text-primary bg-primary/10" : "text-muted-foreground bg-muted"
                    }`}>
                      {token.passedFilters ? "YES" : "NO"}
                    </span>
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>

        {tokens.length === 0 && (
          <div className="py-8 text-center text-muted-foreground text-[11px] font-mono" data-testid="text-no-tokens">
            Waiting for token scan...
          </div>
        )}
      </div>
    </div>
  );
}
