import { useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import { getGetBotStatusQueryKey, getGetPositionsQueryKey, getGetStatsQueryKey, getGetLogsQueryKey, getGetTradesQueryKey } from "@workspace/api-client-react";

type LogEntry = {
  id: number;
  level: string;
  message: string;
  tokenSymbol?: string | null;
  timestamp: string;
};

type TokenEntry = {
  address: string;
  symbol: string;
  name: string;
  priceUsd: number;
  priceChangePercent5m: number;
  priceChangePercent1h: number;
  volumeUsd5m: number;
  liquidityUsd: number;
  ageMinutes: number;
  safetyScore: number;
  passedFilters: boolean;
  scannedAt: string;
  dexUrl?: string | null;
};

type SocketCallbacks = {
  onTradeExecuted?: (data: { tokenSymbol: string; profitPercent: number; exitTime: string }) => void;
  onLogs?: (logs: LogEntry[]) => void;
  onTokens?: (tokens: TokenEntry[]) => void;
};

let socketInstance: Socket | null = null;

export function useSocket(callbacks: SocketCallbacks) {
  const queryClient = useQueryClient();
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!socketInstance) {
      socketInstance = io({
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: Infinity,
      });
    }

    const socket = socketInstance;

    socket.on("bot-status", () => {
      queryClient.invalidateQueries({ queryKey: getGetBotStatusQueryKey() });
    });

    socket.on("position-update", () => {
      queryClient.invalidateQueries({ queryKey: getGetPositionsQueryKey() });
    });

    socket.on("trade-executed", (data: any) => {
      queryClient.invalidateQueries({ queryKey: getGetTradesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
      callbacksRef.current.onTradeExecuted?.(data);
    });

    socket.on("stats-update", () => {
      queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
    });

    socket.on("log", (entry: LogEntry) => {
      callbacksRef.current.onLogs?.([{ ...entry, id: Date.now() }]);
    });

    socket.on("new-token", (token: TokenEntry) => {
      callbacksRef.current.onTokens?.([token]);
    });

    return () => {
      socket.off("bot-status");
      socket.off("position-update");
      socket.off("trade-executed");
      socket.off("stats-update");
      socket.off("log");
      socket.off("new-token");
    };
  }, [queryClient]);

  const emit = useCallback((event: string, data?: unknown) => {
    socketInstance?.emit(event, data);
  }, []);

  return { emit };
}
