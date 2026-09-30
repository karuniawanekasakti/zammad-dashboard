import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ACTIVITY_EVENTS, IDLE_CHECK_INTERVAL_MS, createIdleSession, type SharedActivity } from "@/lib/idle-session";
import { useAuth } from "@/stores/auth";

const SHARED_ACTIVITY_KEY = "zm-last-activity";

// The timestamp every tab of this browser shares. Storage can throw (private
// mode, quota); in that case each tab falls back to tracking its own activity.
const sharedActivity: SharedActivity = {
  read() {
    try {
      const value = Number(localStorage.getItem(SHARED_ACTIVITY_KEY));
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  },
  write(at) {
    try {
      localStorage.setItem(SHARED_ACTIVITY_KEY, String(at));
    } catch {
      /* storage unavailable: per-tab tracking only */
    }
  },
};

/**
 * Keeps an active session alive (throttled token refresh) and signs the user out
 * after an hour without real input. Background polling never counts as activity.
 */
export function useIdleLogout() {
  const signedIn = useAuth((s) => !!s.user);
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();

  useEffect(() => {
    if (!signedIn) return;

    const session = createIdleSession({
      refresh: () => api.refreshSession(),
      onIdle: () => {
        logout();
        navigate("/login", { replace: true });
        toast.info("You were signed out due to inactivity.");
      },
      shared: sharedActivity,
    });
    const onActivity = () => session.activity();
    const onVisible = () => {
      if (document.visibilityState === "visible") session.check();
    };

    // Capture phase: `scroll` does not bubble, and the app scrolls inside <main>.
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, onActivity, { capture: true, passive: true }));
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => session.check(), IDLE_CHECK_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, onActivity, { capture: true }));
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [signedIn, logout, navigate]);
}
