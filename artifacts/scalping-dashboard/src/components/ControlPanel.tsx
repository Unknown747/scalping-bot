import { motion } from "framer-motion";
import { useGetConfig, useUpdateConfig, getGetConfigQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

type Props = {
  running: boolean;
  mode: string;
  onStartStop: () => void;
  onEmergencyStop: () => void;
  onRiskChange: (level: string) => void;
  onModeToggle: (mode: "live" | "paper") => void;
  isStarting: boolean;
  isStopping: boolean;
  isEmergencyStopping: boolean;
};

const riskLevels = ["conservative", "moderate", "aggressive"] as const;

export function ControlPanel({
  running, mode, onStartStop, onEmergencyStop, onRiskChange,
  isStarting, isStopping, isEmergencyStopping
}: Props) {
  const isPending = isStarting || isStopping;
  const queryClient = useQueryClient();
  const updateConfig = useUpdateConfig();

  const enablePaperMode = () => {
    updateConfig.mutate({ data: { mode: "paper" } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetConfigQueryKey() });
        toast.info("Switched to paper mode");
      },
    });
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-4" data-testid="control-panel">
      {/* Live mode indicator */}
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Control Panel</div>
        {mode === "live" ? (
          <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-loss/15 text-loss border border-loss/30 tracking-wider">
            ⚡ MAINNET LIVE
          </span>
        ) : (
          <button
            onClick={enablePaperMode}
            className="text-[9px] font-mono px-2 py-0.5 rounded bg-warn/10 text-warn border border-warn/30 hover:bg-warn/20 transition-colors"
          >
            PAPER (click: kembali ke paper)
          </button>
        )}
      </div>

      {/* START/STOP button */}
      <motion.button
        data-testid="button-start-stop"
        onClick={onStartStop}
        disabled={isPending}
        whileTap={{ scale: 0.97 }}
        className={`w-full py-3 rounded-lg font-bold text-sm font-mono tracking-wider transition-all duration-200 disabled:opacity-50 ${
          running
            ? "bg-gradient-to-r from-loss/80 to-loss text-white hover:from-loss hover:to-loss/80"
            : "bg-gradient-to-r from-primary/80 to-primary text-background hover:from-primary hover:to-primary/80"
        }`}
        style={running ? {} : { boxShadow: "0 0 20px rgba(0,255,136,0.2)" }}
      >
        {isPending ? "..." : running ? "STOP BOT" : "START BOT"}
      </motion.button>

      {/* Risk Level */}
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Risk Level</div>
        <div className="grid grid-cols-3 gap-1">
          {riskLevels.map((level) => (
            <button
              key={level}
              data-testid={`button-risk-${level}`}
              onClick={() => onRiskChange(level)}
              className={`py-1.5 rounded text-xs font-mono capitalize transition-colors ${
                level === "conservative"
                  ? "text-primary border border-primary/50 bg-primary/10"
                  : level === "moderate"
                  ? "text-warn border border-warn/50 bg-warn/10"
                  : "text-loss border border-loss/50 bg-loss/10"
              } hover:opacity-80`}
            >
              {level === "conservative" ? "Low" : level === "moderate" ? "Mid" : "High"}
            </button>
          ))}
        </div>
      </div>

      {/* Live trading info */}
      {mode === "live" && (
        <div className="rounded-lg border border-loss/20 bg-loss/5 p-2.5 space-y-1">
          <div className="text-[10px] font-mono text-loss font-bold">LIVE TRADING ACTIVE</div>
          <div className="text-[9px] text-muted-foreground font-mono leading-relaxed">
            Dana nyata digunakan. Setiap trade ~$1 (0.0003 ETH). Pastikan wallet & RPC sudah dikonfigurasi di Secrets.
          </div>
        </div>
      )}

      {/* Emergency Stop */}
      <motion.button
        data-testid="button-emergency-stop"
        onClick={onEmergencyStop}
        disabled={isEmergencyStopping}
        whileTap={{ scale: 0.97 }}
        className={`w-full py-2.5 rounded-lg font-bold text-xs font-mono tracking-wider text-loss border border-loss/50 bg-loss/10 transition-all duration-200 hover:bg-loss/20 disabled:opacity-50 ${
          running ? "pulse-red" : ""
        }`}
      >
        {isEmergencyStopping ? "CLOSING ALL..." : "EMERGENCY STOP"}
      </motion.button>
    </div>
  );
}
