import { useState, useEffect, useCallback } from "react";

type AuthState = {
  authenticated: boolean;
  loading: boolean;
  authenticatedAt?: string;
};

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>({ authenticated: false, loading: true });

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setAuth({ authenticated: data.authenticated, loading: false, authenticatedAt: data.authenticatedAt });
      } else {
        setAuth({ authenticated: false, loading: false });
      }
    } catch {
      setAuth({ authenticated: false, loading: false });
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setAuth({ authenticated: true, loading: false, authenticatedAt: data.authenticatedAt });
        return { success: true };
      }
      return { success: false, error: data.error || "Login gagal" };
    } catch {
      return { success: false, error: "Koneksi ke server gagal" };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } finally {
      setAuth({ authenticated: false, loading: false });
    }
  }, []);

  return { ...auth, login, logout, checkAuth };
}
