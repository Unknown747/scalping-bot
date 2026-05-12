type Wallet = {
  address?: string | null;
  ethBalance: number;
  wethBalance?: number;
  ethBalanceIdr: number;
  ethPriceUsd: number;
  network: string;
  preferWeth?: boolean;
};

function formatIdr(amount: number): string {
  return "Rp " + amount.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function formatEth(amount: number, decimals = 6): string {
  return amount.toFixed(decimals);
}

export function WalletCard({ wallet }: { wallet?: Wallet }) {
  const ethBal = wallet?.ethBalance ?? 0;
  const wethBal = wallet?.wethBalance ?? 0;
  const totalEth = ethBal + wethBal;
  const ethPrice = wallet?.ethPriceUsd ?? 0;
  const usdToIdr = 16000;

  const wethIdr = wethBal * ethPrice * usdToIdr;
  const ethIdr = ethBal * ethPrice * usdToIdr;

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3" data-testid="wallet-card">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Wallet</div>
        <span className="text-[10px] text-primary font-mono bg-primary/10 px-1.5 py-0.5 rounded">
          {wallet?.network || "BASE"}
        </span>
      </div>

      {/* WETH — Trading capital (primary) */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wider text-primary/70 font-mono">WETH</span>
          <span className="text-[8px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-mono">
            Trading
          </span>
        </div>
        <div className="text-2xl font-bold font-mono text-foreground">
          {formatEth(wethBal)} <span className="text-sm text-muted-foreground">WETH</span>
        </div>
        <div className="text-sm text-muted-foreground font-mono">
          {formatIdr(wethIdr)}
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-border/60" />

      {/* ETH — Gas fee reserve */}
      <div className="flex items-center justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-mono">ETH</span>
            <span className="text-[8px] px-1.5 py-0.5 rounded bg-muted/20 text-muted-foreground border border-border font-mono">
              Gas
            </span>
          </div>
          <div className="text-sm font-bold font-mono text-muted-foreground">
            {formatEth(ethBal)} <span className="text-xs">ETH</span>
          </div>
          <div className="text-[10px] text-muted-foreground/60 font-mono">{formatIdr(ethIdr)}</div>
        </div>

        {/* ETH price */}
        <div className="text-right space-y-0.5">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-mono">ETH/USD</div>
          <div className="text-sm font-mono text-foreground">${ethPrice.toLocaleString()}</div>
        </div>
      </div>

      {/* Total */}
      <div className="flex items-center justify-between pt-1 border-t border-border/40">
        <span className="text-[10px] text-muted-foreground font-mono">Total</span>
        <div className="text-right">
          <span className="text-xs font-bold font-mono text-foreground">
            {formatEth(totalEth, 5)} ETH
          </span>
          <div className="text-[10px] text-muted-foreground font-mono">
            {formatIdr(totalEth * ethPrice * usdToIdr)}
          </div>
        </div>
      </div>

      {/* Wallet address */}
      {wallet?.address && (
        <div className="text-[10px] text-muted-foreground font-mono truncate" data-testid="text-wallet-address">
          {wallet.address}
        </div>
      )}

      {/* Tip: low WETH warning */}
      {wethBal < 0.0005 && totalEth > 0 && (
        <div className="text-[9px] font-mono text-warn/80 bg-warn/5 border border-warn/20 rounded px-2 py-1.5 leading-relaxed">
          WETH rendah — bot akan pakai ETH native untuk swap. Pertimbangkan wrap ETH → WETH di Uniswap.
        </div>
      )}
    </div>
  );
}
