import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/stores/auth";

const WS_BASE = import.meta.env.VITE_WS_BASE ?? `ws://${window.location.host}/api/v1`;

/**
 * Connects to a WebSocket room and invalidates relevant queries on events.
 */
export function useRealtimeUpdates(room: string) {
  const token = useAuth((s) => s.token);
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!token || import.meta.env.VITE_USE_BACKEND !== "true") return;

    const url = `${WS_BASE}/ws/${room}?token=${token}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        // Invalidate relevant queries based on event type
        if (msg.type?.startsWith("ticket.")) {
          qc.invalidateQueries({ queryKey: ["tickets"] });
          qc.invalidateQueries({ queryKey: ["at_risk"] });
        }
        if (msg.type === "kpi.refresh") {
          qc.invalidateQueries({ queryKey: ["kpi"] });
        }
        if (msg.type === "alert.fired") {
          qc.invalidateQueries({ queryKey: ["notifications"] });
        }
        if (msg.type === "export.ready") {
          qc.invalidateQueries({ queryKey: ["exports"] });
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      // Reconnect after 3s
      setTimeout(() => {
        if (wsRef.current === ws) wsRef.current = null;
      }, 3000);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [token, room, qc]);
}
