export const IDLE_TIMEOUT_MS = 60 * 60 * 1000; //60 * 60 * 1000 = 1 jam;
export const REFRESH_THROTTLE_MS = 5 * 60 * 1000;
export const IDLE_CHECK_INTERVAL_MS = 15 * 1000;
export const SHARED_ACTIVITY_WRITE_MS = 10 * 1000;

export const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll"] as const;

// Last-activity timestamp shared between tabs. Signing out clears the shared
export interface SharedActivity {
  read: () => number | null;
  write: (at: number) => void;
}

interface IdleSessionOptions {
  refresh: () => Promise<void>;
  onIdle: () => void;
  shared?: SharedActivity;
  now?: () => number;
}

const NO_SHARED_ACTIVITY: SharedActivity = { read: () => null, write: () => undefined };

export function createIdleSession({ refresh, onIdle, shared = NO_SHARED_ACTIVITY, now = Date.now }: IdleSessionOptions) {
  let lastActivityAt = now();
  let lastRefreshAt = lastActivityAt;
  let lastSharedWriteAt = -Infinity;
  let refreshing = false;
  let expired = false;

  const isIdle = () => {
    const t = now();
    // Cheap local test first: reading shared storage on every mousemove is wasteful.
    if (t - lastActivityAt < IDLE_TIMEOUT_MS) return false;
    return t - Math.max(lastActivityAt, shared.read() ?? 0) >= IDLE_TIMEOUT_MS;
  };
  const expire = () => {
    expired = true;
    onIdle();
  };

  return {
    /** Call on real user input. */
    activity() {
      if (expired) return;
      if (isIdle()) {
        expire();
        return;
      }
      const at = now();
      lastActivityAt = at;
      if (at - lastSharedWriteAt >= SHARED_ACTIVITY_WRITE_MS) {
        lastSharedWriteAt = at;
        shared.write(at);
      }
      if (refreshing || at - lastRefreshAt < REFRESH_THROTTLE_MS) return;
      refreshing = true;
      lastRefreshAt = at;
      refresh()
        .catch(() => undefined)
        .finally(() => {
          refreshing = false;
        });
    },
    /** Call on a timer and when the tab becomes visible again. */
    check() {
      if (!expired && isIdle()) expire();
    },
  };
}
