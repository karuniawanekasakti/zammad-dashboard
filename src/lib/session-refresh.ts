/**
 * Renew the session token while telling the store about it.
 *
 * Kept separate from `@/lib/api` and `@/lib/api-client` for the same reason as
 * `./session-logout`: the store is reached only through arguments, so there is no
 * import cycle and this can be tested without React or a browser.
 */

interface SessionRefresher {
  /** The current JWT, sent as a Bearer header. */
  token: string | null;
  /** Stores the freshly issued token. */
  setToken: (token: string) => void;
}

/**
 * POST /auth/refresh and store the new token.
 *
 * Rejects on any failure (no token, network error, non-2xx, malformed body) so
 * the idle session can throttle the retry. A 401 is not handled here: the next
 * request through the API client sees it and signs the user out.
 */
export async function refreshSessionToken({ token, setToken }: SessionRefresher): Promise<void> {
  if (!token) throw new Error("refresh: no session token");
  const base = import.meta.env?.VITE_API_BASE ?? "/api/v1";
  const res = await fetch(`${base}/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error(`refresh: server answered ${res.status}`);
  const body = (await res.json()) as { data?: { token?: unknown } };
  const next = body.data?.token;
  if (typeof next !== "string" || next === "") throw new Error("refresh: response carried no token");
  setToken(next);
}
