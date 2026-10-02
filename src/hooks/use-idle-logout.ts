import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ACTIVITY_EVENTS, IDLE_CHECK_INTERVAL_MS, createIdleSession, type SharedActivity } from "@/lib/idle-session";
import { logoutSessionAndClear } from "@/lib/session-logout";
import { refreshSessionToken } from "@/lib/session-refresh";
import { useAuth } from "@/stores/auth";

const SHARED_ACTIVITY_KEY = "zm-last-activity";

// The timestamp every tab of this browser shares.
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
      refresh: () => {
        const { token, setToken } = useAuth.getState();
        return refreshSessionToken({ token, setToken });
      },
      onIdle: () => {
        // Close the access-session on the server (best-effort) before clearing
        // local state. The token is read from the store at the moment of idling,
        logoutSessionAndClear({ token: useAuth.getState().token, clear: logout });
        navigate("/login", { replace: true });
        toast.info("You were signed out due to inactivity.");
      },
      shared: sharedActivity,
    });
    const onActivity = () => session.activity();
    const onVisible = () => {
      if (document.visibilityState === "visible") session.check();
    };

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
