import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { api } from "@/lib/api";
import { beaconDecision } from "@/lib/session-log";

/**
 * Record page visits for the hidden Session & Activity Log.
 *
 * Runs only against the real backend: there is nowhere for a mock beacon to
 * land, so mock/offline mode is a no-op. Visits are de-duplicated by
 * pathname within the dedup window, and `/login` + `/session-log` are skipped
 * entirely (see `beaconDecision`).
 */
export function useActivityBeacon() {
  const { pathname } = useLocation();
  const lastRef = useRef<{ route: string; at: number } | null>(null);

  useEffect(() => {
    if (import.meta.env.VITE_USE_BACKEND !== "true" || import.meta.env.VITE_USE_MOCK === "true") return;

    const now = Date.now();
    const decision = beaconDecision(pathname, lastRef.current, now);
    // Advance the window even when a beacon is skipped, so a repeat visit to
    // the same route stays deduped instead of firing the moment it ages out.
    lastRef.current = { route: decision.lastPath, at: now };
    if (!decision.send) return;

    void api.logActivity({ kind: "view", route: decision.route }).catch(() => undefined);
  }, [pathname]);
}
