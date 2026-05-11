import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";

type Props = {
  onLogin: (password: string) => Promise<{ success: boolean; error?: string }>;
};

export function Login({ onLogin }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || loading) return;

    setLoading(true);
    setError(null);

    const result = await onLogin(password);
    setLoading(false);

    if (!result.success) {
      setError(result.error || "Password salah");
      setShake(true);
      setPassword("");
      setTimeout(() => setShake(false), 600);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Background grid effect */}
      <div
        className="fixed inset-0 opacity-[0.03]"
        style={{
          backgroundImage: "linear-gradient(rgba(0,255,136,1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,136,1) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="relative w-full max-w-sm"
      >
        {/* Glow behind card */}
        <div
          className="absolute inset-0 rounded-2xl blur-3xl opacity-20"
          style={{ background: "radial-gradient(ellipse at center, rgba(0,255,136,0.3) 0%, transparent 70%)" }}
        />

        <div className="relative bg-card border border-border rounded-2xl p-8 space-y-8 shadow-2xl">
          {/* Logo / Brand */}
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-2 mb-3">
              <div className="w-2.5 h-2.5 rounded-full bg-primary blink" />
              <span className="text-2xl font-bold font-mono tracking-tight text-foreground">
                BASE SCALPER
              </span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <span className="px-2 py-0.5 rounded text-xs font-mono bg-primary/20 text-primary border border-primary/30">
                BASE NETWORK
              </span>
              <span className="px-2 py-0.5 rounded text-xs font-mono bg-muted text-muted-foreground border border-border">
                PAPER MODE
              </span>
            </div>
            <p className="text-muted-foreground text-xs font-mono mt-3">
              Masukkan password untuk mengakses dashboard
            </p>
          </div>

          {/* Lock icon */}
          <div className="flex justify-center">
            <div className={`w-16 h-16 rounded-2xl border-2 flex items-center justify-center transition-colors duration-300 ${
              error ? "border-loss/50 bg-loss/10" : "border-border bg-muted"
            }`}>
              <svg className={`w-8 h-8 ${error ? "text-loss" : "text-muted-foreground"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" strokeWidth={1.5} />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" strokeWidth={1.5} />
              </svg>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <motion.div
              animate={shake ? {
                x: [-8, 8, -6, 6, -4, 4, 0],
                transition: { duration: 0.5 }
              } : {}}
              className="space-y-1.5"
            >
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
                Password
              </label>
              <input
                ref={inputRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••"
                className={`w-full bg-muted border rounded-lg px-4 py-3 font-mono text-sm text-foreground placeholder-muted-foreground/50 outline-none transition-all duration-200 ${
                  error
                    ? "border-loss/60 focus:border-loss"
                    : "border-border focus:border-primary/60 focus:ring-1 focus:ring-primary/20"
                }`}
                autoComplete="current-password"
                disabled={loading}
              />
              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-loss text-xs font-mono"
                >
                  {error}
                </motion.p>
              )}
            </motion.div>

            <motion.button
              type="submit"
              disabled={loading || !password.trim()}
              whileTap={{ scale: 0.98 }}
              className="w-full py-3 rounded-lg font-bold font-mono text-sm tracking-wider transition-all duration-200 disabled:opacity-40 bg-gradient-to-r from-primary/80 to-primary text-background hover:from-primary hover:to-primary/80"
              style={{ boxShadow: password ? "0 0 20px rgba(0,255,136,0.2)" : "none" }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-background/30 border-t-background animate-spin" />
                  VERIFIKASI...
                </span>
              ) : (
                "MASUK"
              )}
            </motion.button>
          </form>

          {/* Footer */}
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground font-mono">
              Tidak bisa masuk? Hubungi admin untuk reset password
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
