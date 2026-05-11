import { motion } from "framer-motion";

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
  running, mode, onStartStop, onEmergencyStop, onRiskChange, onModeToggle,
  isStarting, isStopping, isEmergencyStopping
}: Props) {
  const isPending = isStarting || isStopping;

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-4" data-testid="control-panel">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Control Panel</div>

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

      {/* Mode toggle */}
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Trading Mode</div>
        <div className="grid grid-cols-2 gap-1">
          <button
            data-testid="button-mode-paper"
            onClick={() => onModeToggle("paper")}
            className={`py-1.5 rounded text-xs font-mono transition-colors ${
              mode === "paper"
                ? "bg-warn/20 text-warn border border-warn/50"
                : "bg-muted text-muted-foreground border border-border hover:bg-muted/80"
            }`}
          >
            PAPER
          </button>
          <button
            data-testid="button-mode-live"
            onClick={() => onModeToggle("live")}
            className={`py-1.5 rounded text-xs font-mono transition-colors ${
              mode === "live"
                ? "bg-loss/20 text-loss border border-loss/50"
                : "bg-muted text-muted-foreground border border-border hover:bg-muted/80"
            }`}
          >
            LIVE
          </button>
        </div>
      </div>

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
