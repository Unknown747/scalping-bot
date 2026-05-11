import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { Dashboard } from "./pages/Dashboard";
import { Login } from "./pages/Login";
import { useAuth } from "./hooks/useAuth";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        if (error?.response?.status === 401) return false;
        return failureCount < 2;
      },
      staleTime: 1000,
    },
  },
});

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { authenticated, loading, login } = useAuth();

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3 font-mono text-muted-foreground text-sm">
          <div className="w-4 h-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          Memuat...
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return <Login onLogin={login} />;
  }

  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground font-mono">
      <div className="text-center space-y-2">
        <div className="text-4xl font-bold text-loss">404</div>
        <div className="text-muted-foreground">Halaman tidak ditemukan</div>
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <AuthGuard>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route component={NotFound} />
          </Switch>
        </AuthGuard>
      </WouterRouter>
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "hsl(231 32% 11%)",
            border: "1px solid hsl(231 25% 18%)",
            color: "hsl(210 40% 92%)",
            fontFamily: "monospace",
            fontSize: "12px",
          },
        }}
      />
    </QueryClientProvider>
  );
}

export default App;
