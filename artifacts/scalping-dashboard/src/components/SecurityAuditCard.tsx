import { useEffect, useState } from "react";

interface SecurityCheck {
  name: string;
  passed: boolean;
  severity: "critical" | "warning" | "info";
  message: string;
  fix?: string;
}

interface AuditResult {
  safe: boolean;
  canRunLive: boolean;
  checks: SecurityCheck[];
  criticalFailures: string[];
  warnings: string[];
  auditedAt: string;
}

function severityIcon(severity: SecurityCheck["severity"], passed: boolean) {
  if (passed) return <span className="text-primary">✓</span>;
  if (severity === "critical") return <span className="text-loss">✗</span>;
  if (severity === "warning") return <span className="text-warn">⚠</span>;
  return <span className="text-muted-foreground">ℹ</span>;
}

function severityColor(severity: SecurityCheck["severity"], passed: boolean) {
  if (passed) return "text-primary";
  if (severity === "critical") return "text-loss";
  if (severity === "warning") return "text-warn";
  return "text-muted-foreground";
}

export function SecurityAuditCard() {
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const runAudit = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/security-audit", { credentials: "include" });
      const data = await res.json();
      setAudit(data);
      if (!data.canRunLive) setExpanded(true);
    } catch {
      setAudit(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runAudit();
  }, []);

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-2">Security Audit</div>
        <div className="text-xs text-muted-foreground font-mono animate-pulse">Memeriksa keamanan...</div>
      </div>
    );
  }

  if (!audit) return null;

  const headerColor = !audit.canRunLive
    ? "border-loss/40 bg-loss/5"
    : audit.warnings.length > 0
    ? "border-warn/40 bg-warn/5"
    : "border-primary/30 bg-primary/5";

  const statusLabel = !audit.canRunLive
    ? "GAGAL — Live mode diblokir"
    : audit.warnings.length > 0
    ? "LULUS (ada peringatan)"
    : "AMAN";

  const statusColor = !audit.canRunLive
    ? "text-loss"
    : audit.warnings.length > 0
    ? "text-warn"
    : "text-primary";

  return (
    <div className={`border rounded-lg overflow-hidden ${headerColor}`}>
      <button
        className="w-full p-4 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Security Audit</div>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); runAudit(); }}
              className="text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded border border-border"
            >
              Refresh
            </button>
            <span className="text-muted-foreground text-xs">{expanded ? "▲" : "▼"}</span>
          </div>
        </div>
        <div className={`text-sm font-bold font-mono mt-1 ${statusColor}`}>
          {statusLabel}
        </div>
        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
          {audit.checks.filter((c) => c.passed).length}/{audit.checks.length} checks lolos
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border divide-y divide-border/50">
          {audit.checks.map((check) => (
            <div key={check.name} className="px-4 py-3 space-y-1">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-sm">{severityIcon(check.severity, check.passed)}</span>
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-mono font-semibold ${severityColor(check.severity, check.passed)}`}>
                    {check.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono leading-relaxed">
                    {check.message}
                  </div>
                  {!check.passed && check.fix && (
                    <div className="text-[11px] text-foreground/70 font-mono mt-1 bg-background/50 rounded px-2 py-1 border border-border/50">
                      Solusi: {check.fix}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
