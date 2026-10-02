import assert from "node:assert/strict";
import { refreshSessionToken } from "../../src/lib/session-refresh.ts";
import { createServer } from "vite";

// The auth store persists to localStorage and the client reads its token back
// from there, so an in-memory stand-in must exist before either module loads.
const storage = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
};

process.env.VITE_USE_MOCK = "true";
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { api } = (await vite.ssrLoadModule("/src/lib/api.ts")) as typeof import("../../src/lib/api.ts");
  const { apiClient } = (await vite.ssrLoadModule("/src/lib/api-client.ts")) as typeof import("../../src/lib/api-client.ts");
  const { useAuth } = (await vite.ssrLoadModule("/src/stores/auth.ts")) as typeof import("../../src/stores/auth.ts");
  const { users } = (await vite.ssrLoadModule("/src/lib/mock-data.ts")) as typeof import("../../src/lib/mock-data.ts");

  // Mock mode: `me` resolves a known user and returns null for an unknown one
  // (the signal the app uses to sign a stale session out).
  assert.equal((await api.me(users[0].id))?.id, users[0].id);
  assert.equal(await api.me("usr-does-not-exist"), null);

  // Real client: refresh swaps the bearer token, and later requests use the new one.
  const requests: { url: string; method?: string; authorization?: string }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({
      url,
      method: init?.method,
      authorization: (init?.headers as Record<string, string>).Authorization,
    });
    return new Response(JSON.stringify({ success: true, data: { token: "fresh-token" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  useAuth.getState().setToken("old-token");
  await refreshSessionToken({ token: useAuth.getState().token, setToken: useAuth.getState().setToken });
  assert.ok(requests[0].url.endsWith("/auth/refresh"), requests[0].url);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].authorization, "Bearer old-token");
  assert.equal(useAuth.getState().token, "fresh-token");
  assert.equal(JSON.parse(String(storage.get("zm-auth"))).state.token, "fresh-token");

  await apiClient.me("ignored");
  assert.equal(requests[1].authorization, "Bearer fresh-token", "later requests must use the refreshed token");
} finally {
  await vite.close();
}

console.log("Session API OK");
