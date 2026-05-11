import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { useGetConfig, useUpdateConfig, getGetConfigQueryKey, useGetSecretsStatus, getGetSecretsStatusQueryKey } from "@workspace/api-client-react";
import { toast } from "sonner";

function Toggle({ enabled, onToggle, disabled }: { enabled: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-40 ${
        enabled ? "bg-primary" : "bg-border"
      }`}
      role="switch"
      aria-checked={enabled}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 35 }}
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow ${enabled ? "translate-x-4" : "translate-x-0.5"}`}
      />
    </button>
  );
}

function SectionHeader({ title, badge }: { title: string; badge?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">{title}</div>
      {badge && (
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-mono font-bold">
          {badge}
        </span>
      )}
    </div>
  );
}

function NumInput({
  label, value, onChange, min, max, step, unit, description,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; unit?: string; description?: string;
}) {
  const [local, setLocal] = useState(String(value));

  useEffect(() => { setLocal(String(value)); }, [value]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[11px] text-muted-foreground font-mono">{label}</label>
        {description && <span className="text-[9px] text-muted-foreground/60 font-mono">{description}</span>}
      </div>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={local}
          min={min}
          max={max}
          step={step ?? 0.001}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => {
            const v = parseFloat(local);
            if (!isNaN(v)) onChange(v);
            else setLocal(String(value));
          }}
          className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:border-primary/50 transition-colors"
        />
        {unit && <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">{unit}</span>}
      </div>
    </div>
  );
}

function TextInput({
  label, value, onChange, placeholder, type, description,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; description?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[11px] text-muted-foreground font-mono">{label}</label>
        {description && <span className="text-[9px] text-muted-foreground/60 font-mono">{description}</span>}
      </div>
      <input
        type={type || "text"}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:border-primary/50 transition-colors placeholder:text-muted-foreground/40"
      />
    </div>
  );
}

type Tab = "optimizations" | "trading" | "safety" | "ai" | "telegram" | "rpc" | "secrets";

export function FullSettingsPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("optimizations");
  const [pending, setPending] = useState<Partial<Record<string, any>>>({});
  const queryClient = useQueryClient();

  const { data: config } = useGetConfig({
    query: { refetchInterval: 8000, queryKey: getGetConfigQueryKey() },
  });

  const updateConfig = useUpdateConfig();

  const cfg = config as any;

  const save = (updates: Record<string, any>) => {
    updateConfig.mutate(
      { data: updates },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetConfigQueryKey() });
          setPending({});
          toast.success("Konfigurasi disimpan");
        },
        onError: () => toast.error("Gagal menyimpan konfigurasi"),
      }
    );
  };

  const toggle = (key: string) => {
    if (!cfg) return;
    save({ [key]: !cfg[key] });
  };

  const isSaving = updateConfig.isPending;

  const { data: secretsData } = useGetSecretsStatus({ query: { refetchInterval: 30000, queryKey: getGetSecretsStatusQueryKey() } });
  const secretsMissingCount = secretsData?.summary?.missingRequired?.length ?? 0;

  const TABS: { id: Tab; label: string }[] = [
    { id: "optimizations", label: "Optim" },
    { id: "trading", label: "Trading" },
    { id: "safety", label: "Safety" },
    { id: "ai", label: "🤖 AI" },
    { id: "telegram", label: "Telegram" },
    { id: "rpc", label: "RPC/Gas" },
    { id: "secrets", label: secretsMissingCount > 0 ? `🔑 ${secretsMissingCount}⚠` : "🔑 Secrets" },
  ];

  if (!cfg) return null;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
            Settings
          </div>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-mono">
            {cfg.mode === "live" ? "LIVE" : "PAPER"} · {cfg.riskLevel}
          </span>
        </div>
        <motion.svg
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="w-3.5 h-3.5 text-muted-foreground"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </motion.svg>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border">
              {/* Tab bar */}
              <div className="flex border-b border-border overflow-x-auto">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex-1 py-2 text-[10px] font-mono uppercase tracking-wider transition-colors whitespace-nowrap px-2 ${
                      tab === t.id
                        ? "text-primary border-b-2 border-primary bg-primary/5"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="p-4 space-y-4">
                {/* ── OPTIMIZATIONS ── */}
                {tab === "optimizations" && (
                  <div className="space-y-3">
                    {[
                      { key: "enableDynamicPositionSizing", label: "Dynamic Position Sizing", desc: "Scale trade size 1.0–1.5× by safety+meme score" },
                      { key: "enableBreakEvenAfterTP1", label: "Break-Even Stop", desc: "Exit if price falls to entry after TP1 hit" },
                      { key: "enableTokenBlacklist", label: "Token Blacklist", desc: "Block re-entry into recent stop-loss tokens" },
                      { key: "require1hMomentum", label: "1h Momentum Filter", desc: "Only buy if 1h trend is positive" },
                      { key: "enableMemeScore", label: "Meme Score Filter", desc: "Require minimum meme quality score" },
                      { key: "enablePeakProfitExit", label: "Peak Profit Exit", desc: "Force-exit when profit drops from peak" },
                      { key: "enableTWAP", label: "TWAP Execution", desc: "Split buys into multiple slices" },
                      { key: "enableDynamicSlippage", label: "Dynamic Slippage", desc: "Auto-adjust slippage by liquidity/volatility" },
                      { key: "enableMultiDEX", label: "Multi-DEX Router", desc: "Compare Uniswap/Aerodrome/BaseSwap" },
                      { key: "enableAutoCompound", label: "Auto-Compound", desc: "Reinvest profits into larger trade sizes" },
                      { key: "enableDeployerCheck", label: "Deployer Reputation", desc: "Block tokens from serial deployers" },
                    ].map(({ key, label, desc }) => (
                      <div
                        key={key}
                        className={`flex items-start justify-between gap-3 p-2.5 rounded-lg border transition-colors ${
                          cfg[key] ? "bg-primary/5 border-primary/20" : "bg-muted/10 border-border"
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className={`text-[11px] font-mono font-semibold ${cfg[key] ? "text-primary" : "text-muted-foreground"}`}>
                            {label}
                          </div>
                          <div className="text-[9px] text-muted-foreground/70 mt-0.5">{desc}</div>
                        </div>
                        <Toggle enabled={!!cfg[key]} onToggle={() => toggle(key)} disabled={isSaving} />
                      </div>
                    ))}
                  </div>
                )}

                {/* ── TRADING ── */}
                {tab === "trading" && (
                  <div className="space-y-4">
                    <SectionHeader title="Mode" />
                    <div className="grid grid-cols-2 gap-2">
                      {(["live", "paper"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => save({ mode: m })}
                          disabled={isSaving}
                          className={`py-2.5 rounded-lg text-xs font-mono font-bold capitalize transition-colors border ${
                            cfg.mode === m
                              ? m === "live"
                                ? "bg-loss/20 text-loss border-loss/50"
                                : "bg-warn/20 text-warn border-warn/50"
                              : "bg-muted/10 text-muted-foreground border-border hover:bg-muted/20"
                          }`}
                        >
                          {m === "live" ? "⚡ LIVE (Mainnet)" : "📄 Paper (Simulasi)"}
                        </button>
                      ))}
                    </div>
                    {cfg.mode === "live" && (
                      <div className="text-[9px] text-loss/80 font-mono bg-loss/5 border border-loss/20 rounded p-2">
                        Mode LIVE aktif — dana nyata digunakan. Pastikan PRIVATE_KEY & WALLET_ADDRESS sudah diset di tab Secrets.
                      </div>
                    )}

                    <SectionHeader title="Capital" />
                    <div className="grid grid-cols-2 gap-3">
                      <NumInput label="Total Capital" value={pending.totalCapitalEth ?? cfg.totalCapitalEth} unit="ETH"
                        min={0.001} max={100} step={0.001}
                        onChange={(v) => setPending((p) => ({ ...p, totalCapitalEth: v }))} />
                      <NumInput label="Max Per Trade" value={pending.maxTradeAmountEth ?? cfg.maxTradeAmountEth} unit="ETH"
                        min={0.0001} max={10} step={0.0001}
                        description="~$1 = 0.0003 ETH"
                        onChange={(v) => setPending((p) => ({ ...p, maxTradeAmountEth: v }))} />
                      <NumInput label="Min Per Trade" value={pending.minPositionEth ?? cfg.minPositionEth} unit="ETH"
                        min={0.00001} max={1} step={0.00001}
                        onChange={(v) => setPending((p) => ({ ...p, minPositionEth: v }))} />
                      <NumInput label="Max Positions" value={pending.maxConcurrentPositions ?? cfg.maxConcurrentPositions}
                        min={1} max={10} step={1}
                        onChange={(v) => setPending((p) => ({ ...p, maxConcurrentPositions: Math.round(v) }))} />
                      <NumInput label="Daily Loss Limit" value={pending.maxDailyLossEth ?? cfg.maxDailyLossEth} unit="ETH"
                        min={0.0001} step={0.0001}
                        onChange={(v) => setPending((p) => ({ ...p, maxDailyLossEth: v }))} />
                    </div>

                    <SectionHeader title="Take Profits" />
                    <div className="grid grid-cols-3 gap-2">
                      <NumInput label="TP1 %" value={pending.tp1Percent ?? cfg.tp1Percent} unit="%" min={0.5} max={50} step={0.5}
                        onChange={(v) => setPending((p) => ({ ...p, tp1Percent: v }))} />
                      <NumInput label="TP2 %" value={pending.tp2Percent ?? cfg.tp2Percent} unit="%" min={1} max={100} step={0.5}
                        onChange={(v) => setPending((p) => ({ ...p, tp2Percent: v }))} />
                      <NumInput label="TP3 %" value={pending.tp3Percent ?? cfg.tp3Percent} unit="%" min={1} max={200} step={0.5}
                        onChange={(v) => setPending((p) => ({ ...p, tp3Percent: v }))} />
                      <NumInput label="TP1 Sell" value={pending.tp1SellPercent ?? cfg.tp1SellPercent} unit="%" min={1} max={100} step={1}
                        onChange={(v) => setPending((p) => ({ ...p, tp1SellPercent: v }))} />
                      <NumInput label="TP2 Sell" value={pending.tp2SellPercent ?? cfg.tp2SellPercent} unit="%" min={1} max={100} step={1}
                        onChange={(v) => setPending((p) => ({ ...p, tp2SellPercent: v }))} />
                      <NumInput label="TP3 Sell" value={pending.tp3SellPercent ?? cfg.tp3SellPercent} unit="%" min={1} max={100} step={1}
                        onChange={(v) => setPending((p) => ({ ...p, tp3SellPercent: v }))} />
                    </div>

                    <SectionHeader title="Exit Rules" />
                    <div className="grid grid-cols-2 gap-3">
                      <NumInput label="Stop Loss" value={pending.stopLossPercent ?? cfg.stopLossPercent} unit="%" min={0.5} max={50} step={0.5}
                        onChange={(v) => setPending((p) => ({ ...p, stopLossPercent: v }))} />
                      <NumInput label="Max Hold" value={pending.maxHoldMinutes ?? cfg.maxHoldMinutes} unit="min" min={1} max={1440} step={1}
                        onChange={(v) => setPending((p) => ({ ...p, maxHoldMinutes: Math.round(v) }))} />
                      <NumInput label="Trailing Activate" value={pending.trailingStopActivatePercent ?? cfg.trailingStopActivatePercent} unit="%" min={0.5} max={50} step={0.5}
                        onChange={(v) => setPending((p) => ({ ...p, trailingStopActivatePercent: v }))} />
                      <NumInput label="Trailing Distance" value={pending.trailingStopDistancePercent ?? cfg.trailingStopDistancePercent} unit="%" min={0.5} max={20} step={0.5}
                        onChange={(v) => setPending((p) => ({ ...p, trailingStopDistancePercent: v }))} />
                      <NumInput label="Peak Drop Exit" value={pending.peakProfitDropPercent ?? cfg.peakProfitDropPercent} unit="%" min={10} max={90} step={5}
                        onChange={(v) => setPending((p) => ({ ...p, peakProfitDropPercent: v }))} />
                      <NumInput label="Blacklist Min" value={pending.tokenBlacklistMinutes ?? cfg.tokenBlacklistMinutes} unit="min" min={1} max={1440} step={1}
                        onChange={(v) => setPending((p) => ({ ...p, tokenBlacklistMinutes: Math.round(v) }))} />
                    </div>

                    <SectionHeader title="Advanced Trailing Stop" badge="NEW" />
                    <div className="p-2.5 rounded-lg border border-primary/20 bg-primary/5 mb-1">
                      <div className="text-[9px] text-muted-foreground leading-relaxed font-mono">
                        Trailing stop hanya aktif setelah profit melewati batas minimum, dan stop price selalu menjaga minimal profit yang dikunci.
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <NumInput
                        label="Min Profit to Activate"
                        value={pending.trailingStopMinProfitToActivate ?? cfg.trailingStopMinProfitToActivate ?? 5}
                        unit="%" min={1} max={50} step={0.5}
                        description="aktif setelah profit >"
                        onChange={(v) => setPending((p) => ({ ...p, trailingStopMinProfitToActivate: v }))}
                      />
                      <NumInput
                        label="Lock Min Profit"
                        value={pending.trailingStopLockMinProfitPercent ?? cfg.trailingStopLockMinProfitPercent ?? 2}
                        unit="%" min={0} max={20} step={0.5}
                        description="profit minimum terkunci"
                        onChange={(v) => setPending((p) => ({ ...p, trailingStopLockMinProfitPercent: v }))}
                      />
                    </div>

                    <SectionHeader title="Anti-FOMO & Cooldown" />
                    <div className="grid grid-cols-2 gap-3">
                      <NumInput label="Post-Close Cooldown" value={pending.cooldownAfterCloseSeconds ?? cfg.cooldownAfterCloseSeconds} unit="sec" min={0} max={600} step={5}
                        description="jeda setelah tiap close"
                        onChange={(v) => setPending((p) => ({ ...p, cooldownAfterCloseSeconds: Math.round(v) }))} />
                      <NumInput label="Max Buys / 5min" value={pending.maxBuysPerFiveMinutes ?? cfg.maxBuysPerFiveMinutes} min={1} max={20} step={1}
                        onChange={(v) => setPending((p) => ({ ...p, maxBuysPerFiveMinutes: Math.round(v) }))} />
                      <NumInput label="Cooldown Setelah Stop-Loss" value={pending.cooldownMinutesAfterLoss ?? cfg.cooldownMinutesAfterLoss} unit="min" min={0} max={1440} step={5}
                        description="jeda setelah stop-loss"
                        onChange={(v) => setPending((p) => ({ ...p, cooldownMinutesAfterLoss: Math.round(v) }))} />
                    </div>

                    {Object.keys(pending).length > 0 && (
                      <motion.button
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        onClick={() => save(pending)}
                        disabled={isSaving}
                        className="w-full py-2 rounded-lg bg-primary text-background font-mono font-bold text-xs hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {isSaving ? "Menyimpan..." : `Simpan ${Object.keys(pending).length} perubahan`}
                      </motion.button>
                    )}
                  </div>
                )}

                {/* ── SAFETY ── */}
                {tab === "safety" && (
                  <div className="space-y-4">
                    <SectionHeader title="Token Filter" />
                    <div className="grid grid-cols-2 gap-3">
                      <NumInput label="Min Safety Score" value={pending.minSafetyScore ?? cfg.minSafetyScore} min={0} max={100} step={1} unit="/100"
                        onChange={(v) => setPending((p) => ({ ...p, minSafetyScore: Math.round(v) }))} />
                      <NumInput label="Max Sell Tax" value={pending.maxSellTaxPercent ?? cfg.maxSellTaxPercent} unit="%" min={0} max={30} step={0.5}
                        onChange={(v) => setPending((p) => ({ ...p, maxSellTaxPercent: v }))} />
                      <NumInput label="Min Meme Score" value={pending.minMemeScore ?? cfg.minMemeScore} unit="/100" min={0} max={100} step={1}
                        onChange={(v) => setPending((p) => ({ ...p, minMemeScore: Math.round(v) }))} />
                      <NumInput label="Max Deployer Tokens/24h" value={pending.maxDeployerTokens24h ?? cfg.maxDeployerTokens24h} min={1} max={20} step={1}
                        onChange={(v) => setPending((p) => ({ ...p, maxDeployerTokens24h: Math.round(v) }))} />
                    </div>

                    <SectionHeader title="Scan Filters" />
                    <div className="grid grid-cols-2 gap-3">
                      <NumInput label="Min Liquidity" value={pending.minLiquidityUsd ?? cfg.minLiquidityUsd} unit="USD" min={100} max={1000000} step={500}
                        onChange={(v) => setPending((p) => ({ ...p, minLiquidityUsd: v }))} />
                      <NumInput label="Min 5m Volume" value={pending.min5mVolumeUsd ?? cfg.min5mVolumeUsd} unit="USD" min={100} max={500000} step={500}
                        onChange={(v) => setPending((p) => ({ ...p, min5mVolumeUsd: v }))} />
                      <NumInput label="Max Token Age" value={pending.maxTokenAgeMinutes ?? cfg.maxTokenAgeMinutes} unit="min" min={1} max={1440} step={1}
                        onChange={(v) => setPending((p) => ({ ...p, maxTokenAgeMinutes: Math.round(v) }))} />
                      <NumInput label="Min 5m Momentum" value={pending.minMomentumPercent ?? cfg.minMomentumPercent} unit="%" min={0} max={100} step={1}
                        onChange={(v) => setPending((p) => ({ ...p, minMomentumPercent: v }))} />
                    </div>

                    <SectionHeader title="Scan Timing" />
                    <div className="grid grid-cols-2 gap-3">
                      <NumInput label="Scan Interval" value={pending.scanIntervalSeconds ?? cfg.scanIntervalSeconds} unit="sec" min={2} max={60} step={1}
                        onChange={(v) => setPending((p) => ({ ...p, scanIntervalSeconds: Math.round(v) }))} />
                      <NumInput label="Price Check Interval" value={pending.priceCheckIntervalSeconds ?? cfg.priceCheckIntervalSeconds} unit="sec" min={1} max={30} step={1}
                        onChange={(v) => setPending((p) => ({ ...p, priceCheckIntervalSeconds: Math.round(v) }))} />
                    </div>

                    {Object.keys(pending).length > 0 && (
                      <motion.button
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        onClick={() => save(pending)}
                        disabled={isSaving}
                        className="w-full py-2 rounded-lg bg-primary text-background font-mono font-bold text-xs hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {isSaving ? "Menyimpan..." : `Simpan ${Object.keys(pending).length} perubahan`}
                      </motion.button>
                    )}
                  </div>
                )}

                {/* ── TELEGRAM ── */}
                {tab === "telegram" && (
                  <div className="space-y-4">
                    <div className={`flex items-center justify-between p-3 rounded-lg border ${cfg.enableTelegram ? "bg-primary/5 border-primary/20" : "bg-muted/10 border-border"}`}>
                      <div>
                        <div className={`text-xs font-mono font-bold ${cfg.enableTelegram ? "text-primary" : "text-muted-foreground"}`}>
                          Telegram Alerts
                        </div>
                        <div className="text-[9px] text-muted-foreground mt-0.5">Notifikasi buy/sell/stop-loss ke Telegram</div>
                      </div>
                      <Toggle enabled={!!cfg.enableTelegram} onToggle={() => toggle("enableTelegram")} disabled={isSaving} />
                    </div>

                    <TextInput
                      label="Bot Token"
                      value={pending.telegramBotToken ?? cfg.telegramBotToken ?? ""}
                      placeholder="123456789:AAF..."
                      type="password"
                      description="dari @BotFather"
                      onChange={(v) => setPending((p) => ({ ...p, telegramBotToken: v }))}
                    />
                    <TextInput
                      label="Chat ID"
                      value={pending.telegramChatId ?? cfg.telegramChatId ?? ""}
                      placeholder="-1001234567890"
                      description="User/Group ID"
                      onChange={(v) => setPending((p) => ({ ...p, telegramChatId: v }))}
                    />

                    <div className="text-[9px] text-muted-foreground/60 font-mono leading-relaxed bg-muted/20 rounded p-2.5 border border-border">
                      Cara setup: Buat bot di @BotFather → copy token. Untuk Chat ID: kirim pesan ke bot, buka{" "}
                      <span className="text-primary">api.telegram.org/bot&#123;TOKEN&#125;/getUpdates</span>
                    </div>

                    {Object.keys(pending).length > 0 && (
                      <motion.button
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        onClick={() => save(pending)}
                        disabled={isSaving}
                        className="w-full py-2 rounded-lg bg-primary text-background font-mono font-bold text-xs hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {isSaving ? "Menyimpan..." : "Simpan Telegram Config"}
                      </motion.button>
                    )}
                  </div>
                )}

                {/* ── AI FILTER ── */}
                {tab === "ai" && (
                  <div className="space-y-4">
                    <div className="p-3 rounded-lg border border-primary/30 bg-primary/5">
                      <div className="text-[10px] text-primary font-mono font-bold mb-1">AI Token Filter</div>
                      <div className="text-[9px] text-muted-foreground leading-relaxed">
                        Gunakan AI untuk menganalisis token sebelum masuk posisi. Gemini (utama) → Groq/OpenRouter (fallback) → HuggingFace/OpenRouter (fallback 2). Menggunakan Replit AI Integrations — tidak perlu API key sendiri.
                      </div>
                    </div>

                    <div className={`flex items-center justify-between p-3 rounded-lg border ${cfg.enableAIFilter ? "bg-primary/5 border-primary/20" : "bg-muted/10 border-border"}`}>
                      <div>
                        <div className={`text-xs font-mono font-bold ${cfg.enableAIFilter ? "text-primary" : "text-muted-foreground"}`}>
                          Aktifkan AI Filter
                        </div>
                        <div className="text-[9px] text-muted-foreground mt-0.5">AI memvalidasi setiap token sebelum buy</div>
                      </div>
                      <Toggle enabled={!!cfg.enableAIFilter} onToggle={() => toggle("enableAIFilter")} disabled={isSaving} />
                    </div>

                    <SectionHeader title="Provider Utama" />
                    <div className="grid grid-cols-3 gap-2">
                      {(["gemini", "groq", "huggingface"] as const).map((p) => (
                        <button
                          key={p}
                          onClick={() => save({ aiPrimaryProvider: p })}
                          disabled={isSaving}
                          className={`py-2 rounded-lg text-[10px] font-mono font-bold capitalize transition-colors border ${
                            (cfg.aiPrimaryProvider || "gemini") === p
                              ? "bg-primary/20 text-primary border-primary/50"
                              : "bg-muted/10 text-muted-foreground border-border hover:bg-muted/20"
                          }`}
                        >
                          {p === "gemini" ? "Gemini" : p === "groq" ? "Groq" : "HuggingFace"}
                        </button>
                      ))}
                    </div>
                    <div className="text-[9px] text-muted-foreground/60 font-mono">
                      Groq & HuggingFace dijalankan via OpenRouter. Jika provider utama gagal, sistem otomatis fallback ke provider lain.
                    </div>

                    <SectionHeader title="Threshold" />
                    <NumInput
                      label="Min Confidence"
                      value={pending.aiFilterMinConfidence ?? cfg.aiFilterMinConfidence ?? 65}
                      unit="%" min={30} max={95} step={5}
                      description="min AI confidence untuk buy"
                      onChange={(v) => setPending((p) => ({ ...p, aiFilterMinConfidence: Math.round(v) }))}
                    />

                    <div className="p-2.5 rounded-lg border border-border bg-muted/5">
                      <div className="text-[9px] text-muted-foreground font-mono leading-relaxed space-y-1">
                        <div className="font-semibold text-foreground/70">Urutan provider (contoh: Gemini dipilih):</div>
                        <div>1. Gemini 2.5 Flash — analisis utama</div>
                        <div>2. Groq / Llama 3.1 (via OpenRouter) — fallback cepat</div>
                        <div>3. HuggingFace / Llama 3.2 (via OpenRouter) — fallback terakhir</div>
                        <div className="pt-1 text-primary/70">Jika semua gagal → token tetap diproses tanpa AI filter</div>
                      </div>
                    </div>

                    {Object.keys(pending).length > 0 && (
                      <motion.button
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        onClick={() => save(pending)}
                        disabled={isSaving}
                        className="w-full py-2 rounded-lg bg-primary text-background font-mono font-bold text-xs hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {isSaving ? "Menyimpan..." : `Simpan ${Object.keys(pending).length} perubahan`}
                      </motion.button>
                    )}
                  </div>
                )}

                {/* ── RPC / GAS ── */}
                {tab === "rpc" && (
                  <div className="space-y-4">
                    <div className="p-3 rounded-lg border border-warn/30 bg-warn/5">
                      <div className="text-[10px] text-warn font-mono font-bold mb-1">RPC & Gas Settings</div>
                      <div className="text-[9px] text-muted-foreground leading-relaxed">
                        RPC URL dan MEV Protection diatur di Replit Secrets (<span className="text-primary font-mono">BASE_RPC_URL</span>, <span className="text-primary font-mono">MEV_PROTECTION_RPC</span>). Gas limits di bawah bisa diatur langsung.
                      </div>
                    </div>

                    <SectionHeader title="Gas Limits" badge="EIP-1559" />
                    <div className="grid grid-cols-2 gap-3">
                      <NumInput label="Max Priority Fee" value={pending.maxPriorityFeeGwei ?? cfg.maxPriorityFeeGwei} unit="Gwei" min={0.0001} max={10} step={0.001}
                        onChange={(v) => setPending((p) => ({ ...p, maxPriorityFeeGwei: v }))} />
                      <NumInput label="Max Fee Per Gas" value={pending.maxFeePerGasGwei ?? cfg.maxFeePerGasGwei} unit="Gwei" min={0.001} max={100} step={0.001}
                        onChange={(v) => setPending((p) => ({ ...p, maxFeePerGasGwei: v }))} />
                    </div>

                    <SectionHeader title="Slippage" />
                    <div className="grid grid-cols-2 gap-3">
                      <NumInput label="Max Slippage" value={pending.maxSlippagePercent ?? cfg.maxSlippagePercent} unit="%" min={0.1} max={30} step={0.1}
                        onChange={(v) => setPending((p) => ({ ...p, maxSlippagePercent: v }))} />
                      <NumInput label="TWAP Slices" value={pending.twapSlices ?? cfg.twapSlices} min={2} max={10} step={1}
                        onChange={(v) => setPending((p) => ({ ...p, twapSlices: Math.round(v) }))} />
                      <NumInput label="TWAP Interval" value={pending.twapIntervalMs ?? cfg.twapIntervalMs} unit="ms" min={1000} max={60000} step={1000}
                        onChange={(v) => setPending((p) => ({ ...p, twapIntervalMs: Math.round(v) }))} />
                      <NumInput label="Max Position Multiplier" value={pending.maxPositionSizeMultiplier ?? cfg.maxPositionSizeMultiplier} unit="×" min={1} max={3} step={0.1}
                        onChange={(v) => setPending((p) => ({ ...p, maxPositionSizeMultiplier: v }))} />
                    </div>

                    <SectionHeader title="Auto-Compound" />
                    <div className="grid grid-cols-2 gap-3">
                      <NumInput label="Compound Threshold" value={pending.compoundThresholdEth ?? cfg.compoundThresholdEth} unit="ETH" min={0.001} max={1} step={0.001}
                        onChange={(v) => setPending((p) => ({ ...p, compoundThresholdEth: v }))} />
                    </div>

                    {Object.keys(pending).length > 0 && (
                      <motion.button
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        onClick={() => save(pending)}
                        disabled={isSaving}
                        className="w-full py-2 rounded-lg bg-primary text-background font-mono font-bold text-xs hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {isSaving ? "Menyimpan..." : `Simpan ${Object.keys(pending).length} perubahan`}
                      </motion.button>
                    )}
                  </div>
                )}

                {/* ── SECRETS ── */}
                {tab === "secrets" && (
                  <div className="space-y-4">
                    {/* Summary banner */}
                    {secretsData && (
                      <div className={`p-3 rounded-lg border ${
                        secretsData.summary.readyForLive
                          ? "border-primary/30 bg-primary/5"
                          : "border-loss/30 bg-loss/5"
                      }`}>
                        <div className={`text-[10px] font-mono font-bold mb-1 ${secretsData.summary.readyForLive ? "text-primary" : "text-loss"}`}>
                          {secretsData.summary.readyForLive
                            ? "✅ Semua secret wajib sudah diset — siap VPS"
                            : `⚠ ${secretsData.summary.missingRequired.length} secret wajib belum diset`}
                        </div>
                        <div className="text-[9px] text-muted-foreground font-mono">
                          {secretsData.summary.set}/{secretsData.summary.total} environment variable aktif
                        </div>
                        {!secretsData.summary.readyForLive && (
                          <div className="mt-1.5 text-[9px] text-loss/80 font-mono">
                            Missing: {secretsData.summary.missingRequired.join(", ")}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Secret list */}
                    <div className="space-y-2">
                      {(secretsData?.secrets ?? []).map((s) => (
                        <div
                          key={s.key}
                          className={`p-2.5 rounded-lg border ${
                            s.set
                              ? "bg-primary/5 border-primary/15"
                              : s.required
                              ? "bg-loss/5 border-loss/30"
                              : "bg-muted/10 border-border"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-[9px] font-mono ${s.set ? "text-primary" : s.required ? "text-loss" : "text-muted-foreground"}`}>
                                  {s.set ? "✅" : s.required ? "❌" : "○"}
                                </span>
                                <span className={`text-[11px] font-mono font-bold ${s.set ? "text-foreground" : s.required ? "text-loss" : "text-muted-foreground"}`}>
                                  {s.label}
                                </span>
                                {s.required && (
                                  <span className="text-[8px] px-1 py-0.5 rounded bg-loss/10 text-loss border border-loss/20 font-mono">
                                    wajib
                                  </span>
                                )}
                              </div>
                              <div className="text-[8px] font-mono text-muted-foreground/60 mt-0.5">{s.key}</div>
                              {s.maskedValue && (
                                <div className="text-[9px] font-mono text-muted-foreground/70 mt-0.5 truncate">{s.maskedValue}</div>
                              )}
                              {s.note && (
                                <div className={`text-[9px] font-mono mt-0.5 leading-relaxed ${s.note.startsWith("⚠") ? "text-warn/80" : "text-muted-foreground/60"}`}>
                                  {s.note}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* VPS setup instructions */}
                    <div className="p-3 rounded-lg border border-border bg-muted/5 space-y-2">
                      <div className="text-[10px] font-mono font-bold text-muted-foreground">CARA SET DI VPS</div>
                      <div className="text-[9px] font-mono text-muted-foreground/70 leading-relaxed space-y-1">
                        <div>1. Copy file <span className="text-primary">.env.example</span> → <span className="text-primary">.env</span></div>
                        <div>2. Isi semua nilai di .env</div>
                        <div>3. Jalankan: <span className="text-primary">docker compose up -d</span></div>
                        <div>4. Dashboard tersedia di port <span className="text-primary">80</span>, API di port <span className="text-primary">8080</span></div>
                      </div>
                    </div>

                    <div className="p-3 rounded-lg border border-border bg-muted/5 space-y-2">
                      <div className="text-[10px] font-mono font-bold text-muted-foreground">DI REPLIT</div>
                      <div className="text-[9px] font-mono text-muted-foreground/70 leading-relaxed">
                        Set secret di <span className="text-primary">Tools → Secrets</span>. AI keys (Gemini, OpenRouter) sudah auto-set via Replit AI Integrations.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
