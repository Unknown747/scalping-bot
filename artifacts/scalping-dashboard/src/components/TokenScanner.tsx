import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  memeScore?: number;
  passedFilters: boolean;
  scannedAt: string;
  dexUrl?: string | null;
};

type BlacklistEntry = {
  id: number;
  address: string;
  symbol: string;
  reason: string;
  addedAt: string;
};

function fmt(n: number, digits = 1) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(digits)}`;
}

function ScoreBadge({ score, label }: { score: number; label: string }) {
  const c = score >= 70 ? "text-primary bg-primary/10" : score >= 50 ? "text-warn bg-warn/10" : "text-loss bg-loss/10";
  return (
    <span title={label} className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${c}`}>{score}</span>
  );
}

function BlacklistTab() {
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const { data: blacklist = [], isLoading } = useQuery<BlacklistEntry[]>({
    queryKey: ["blacklist"],
    queryFn: async () => {
      const res = await fetch("/api/tokens/blacklist", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 15000,
  });

  const removeEntry = async (address: string) => {
    setRemoving(address);
    try {
      await fetch(`/api/tokens/blacklist/${address}`, {
        method: "DELETE",
        credentials: "include",
      });
      queryClient.invalidateQueries({ queryKey: ["blacklist"] });
    } finally {
      setRemoving(null);
    }
  };

  const clearAll = async () => {
    setClearing(true);
    try {
      await fetch("/api/tokens/blacklist", { method: "DELETE", credentials: "include" });
      queryClient.invalidateQueries({ queryKey: ["blacklist"] });
      setConfirmClear(false);
    } finally {
      setClearing(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString("id-ID", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-muted-foreground font-mono">
          {blacklist.length} token diblokir permanen (honeypot / FoT)
        </div>
        {blacklist.length > 0 && !confirmClear && (
          <button
            onClick={() => setConfirmClear(true)}
            className="text-[10px] font-mono px-2 py-0.5 rounded border border-loss/40 text-loss/70 hover:bg-loss/10 transition-colors"
          >
            Hapus semua
          </button>
        )}
        {confirmClear && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-loss">Yakin?</span>
            <button onClick={clearAll} disabled={clearing}
              className="text-[10px] font-mono px-2 py-0.5 rounded bg-loss/20 text-loss border border-loss/40 hover:bg-loss/30 transition-colors disabled:opacity-50">
              {clearing ? "..." : "Ya"}
            </button>
            <button onClick={() => setConfirmClear(false)}
              className="text-[10px] font-mono px-2 py-0.5 rounded border border-border text-muted-foreground hover:bg-muted transition-colors">
              Batal
            </button>
          </div>
        )}
      </div>

      <div className="overflow-auto max-h-[250px]">
        {isLoading ? (
          <div className="py-6 text-center text-muted-foreground text-[11px] font-mono">Memuat...</div>
        ) : blacklist.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground text-[11px] font-mono">
            Belum ada token di blacklist
          </div>
        ) : (
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-[10px] text-muted-foreground uppercase tracking-wider border-b border-border sticky top-0 bg-card">
                <th className="text-left py-1.5 pr-2">Token</th>
                <th className="text-left pr-2">Alasan</th>
                <th className="text-right pr-2">Ditambahkan</th>
                <th className="text-right">Hapus</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {blacklist.map((entry) => (
                  <motion.tr key={entry.address}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="border-b border-border/40 hover:bg-muted/20 transition-colors"
                  >
                    <td className="py-1.5 pr-2">
                      <div className="font-bold text-loss">{entry.symbol}</div>
                      <div className="text-[9px] text-muted-foreground font-mono truncate max-w-[80px]">
                        {entry.address.slice(0, 6)}…{entry.address.slice(-4)}
                      </div>
                    </td>
                    <td className="pr-2">
                      <span className="text-[10px] text-warn/80 truncate max-w-[140px] block">
                        {entry.reason.replace("Honeypot/FoT: ", "").slice(0, 40)}
                      </span>
                    </td>
                    <td className="text-right pr-2 text-muted-foreground text-[10px]">
                      {formatDate(entry.addedAt)}
                    </td>
                    <td className="text-right">
                      <button
                        onClick={() => removeEntry(entry.address)}
                        disabled={removing === entry.address}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-loss hover:border-loss/40 transition-colors disabled:opacity-40"
                      >
                        {removing === entry.address ? "..." : "✕"}
                      </button>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function TokenScanner({ tokens }: { tokens: Token[] }) {
  const [tab, setTab] = useState<"scanner" | "blacklist">("scanner");
  const { data: blacklist = [] } = useQuery<BlacklistEntry[]>({
    queryKey: ["blacklist"],
    queryFn: async () => {
      const res = await fetch("/api/tokens/blacklist", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 15000,
  });

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Token Scanner</div>
          <div className="flex rounded overflow-hidden border border-border">
            <button onClick={() => setTab("scanner")}
              className={`px-2.5 py-0.5 text-[10px] font-mono border-r border-border/30 transition-colors ${
                tab === "scanner" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              Scan
            </button>
            <button onClick={() => setTab("blacklist")}
              className={`px-2.5 py-0.5 text-[10px] font-mono transition-colors flex items-center gap-1 ${
                tab === "blacklist" ? "bg-loss/20 text-loss" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              Blacklist
              {blacklist.length > 0 && (
                <span className="bg-loss/30 text-loss rounded px-1 text-[9px]">{blacklist.length}</span>
              )}
            </button>
          </div>
        </div>
        {tab === "scanner" && (
          <span className="text-[10px] text-muted-foreground font-mono">{tokens.length} scanned</span>
        )}
      </div>

      {tab === "scanner" ? (
        <div className="overflow-auto max-h-[280px]">
          <table className="w-full text-xs font-mono" data-testid="table-token-scanner">
            <thead>
              <tr className="text-[10px] text-muted-foreground uppercase tracking-wider border-b border-border">
                <th className="text-left py-1.5 pr-2">Symbol</th>
                <th className="text-right pr-2">5m %</th>
                <th className="text-right pr-2">Vol</th>
                <th className="text-right pr-2">Liq</th>
                <th className="text-right pr-2">Age</th>
                <th className="text-right pr-2">Meme</th>
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
                    <td className="text-right pr-2">
                      {token.memeScore !== undefined
                        ? <ScoreBadge score={token.memeScore} label="Meme Score" />
                        : <span className="text-muted-foreground">—</span>
                      }
                    </td>
                    <td className="text-right pr-2"><ScoreBadge score={token.safetyScore} label="Safety Score" /></td>
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
      ) : (
        <BlacklistTab />
      )}
    </div>
  );
}
