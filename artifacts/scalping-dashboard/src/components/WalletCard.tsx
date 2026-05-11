type Wallet = {
  address?: string | null;
  ethBalance: number;
  ethBalanceIdr: number;
  ethPriceUsd: number;
  network: string;
};

function formatIdr(amount: number): string {
  return "Rp " + amount.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function WalletCard({ wallet }: { wallet?: Wallet }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3" data-testid="wallet-card">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Wallet</div>
        <span className="text-[10px] text-primary font-mono bg-primary/10 px-1.5 py-0.5 rounded">
          {wallet?.network || "BASE"}
        </span>
      </div>

      <div className="space-y-1">
        <div className="text-2xl font-bold font-mono text-foreground">
          {(wallet?.ethBalance || 0).toFixed(6)} <span className="text-sm text-muted-foreground">ETH</span>
        </div>
        <div className="text-sm text-muted-foreground font-mono">
          {formatIdr(wallet?.ethBalanceIdr || 0)}
        </div>
      </div>

      <div className="border-t border-border pt-2 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground font-mono">ETH/USD</span>
        <span className="text-[11px] font-mono text-foreground">
          ${(wallet?.ethPriceUsd || 0).toLocaleString()}
        </span>
      </div>

      {wallet?.address && (
        <div className="text-[10px] text-muted-foreground font-mono truncate" data-testid="text-wallet-address">
          {wallet.address}
        </div>
      )}
    </div>
  );
}
