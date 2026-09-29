/**
 * Sign out while telling the server about it.
 *
 * Kept separate from `@/stores/auth` so the dependency runs one way: entering
 * the store must not pull in the API client (which reaches back to the store,
 * forming an import cycle). This module reaches *into* the store's persisted
 * shape only through its arguments.
 */

interface SessionDisposer {
  /** The current JWT, sent as a Bearer header on the keepalive request. */
  token: string | null;
  /** Synchronous cleanup, run whether or not the request succeeds. */
  clear: () => void;
}

/**
 * POST the logout best-effort, then clear local state synchronously.
 *
 * The request uses `keepalive` so it survives the navigation to `/login` that
 * follows. It never rejects and never throws: an unreachable backend must not
 * leave the user stuck on a page they asked to leave.
 */
export function logoutSessionAndClear({ token, clear }: SessionDisposer): void {
  const base = import.meta.env.VITE_API_BASE ?? "/api/v1";
  try {
    void fetch(`${base}/internal/logout`, {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }).catch(() => undefined);
  } catch {
    // A synchronous fetch failure (offline, blocked) must not block sign-out.
  }
  clear();
}
