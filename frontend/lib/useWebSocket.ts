"use client";

import { useEffect, useRef, useCallback } from "react";
import { getAccessToken } from "./api";

type WSMessage = {
  type: "signal" | "order" | "account" | "ping" | "connected" | "pong";
  data?: Record<string, unknown>;
  ts?: number;
  user_id?: string;
};

type Handlers = {
  onSignal?: (data: Record<string, unknown>) => void;
  onOrder?:  (data: Record<string, unknown>) => void;
  onAccount?: (data: Record<string, unknown>) => void;
};

export function useWebSocket(handlers: Handlers, enabled = true) {
  const wsRef      = useRef<WebSocket | null>(null);
  const retryRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    const token = getAccessToken();
    if (!token || !enabled) return;

    const base = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000")
      .replace(/^http/, "ws");
    const url = `${base}/api/v1/ws/${token}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg: WSMessage = JSON.parse(ev.data);
        if (msg.type === "signal" && msg.data)  handlers.onSignal?.(msg.data);
        if (msg.type === "order"  && msg.data)  handlers.onOrder?.(msg.data);
        if (msg.type === "account" && msg.data) handlers.onAccount?.(msg.data);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      // Reconnect after 5s
      retryRef.current = setTimeout(connect, 5_000);
    };

    ws.onerror = () => ws.close();
  }, [enabled, handlers]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [connect]);
}
