import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { Dashboard } from "./pages/Dashboard";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000,
    },
  },
});

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground font-mono">
      <div className="text-center space-y-2">
        <div className="text-4xl font-bold text-loss">404</div>
        <div className="text-muted-foreground">Page not found</div>
      </div>
    </div>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route component={NotFound} />
        </Switch>
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
