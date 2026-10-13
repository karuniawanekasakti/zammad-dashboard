import assert from "node:assert/strict";
import { refreshSessionToken } from "../../src/lib/session-refresh.ts";

interface FetchCall {
  url: string;
  init: RequestInit;
}

function stubFetch(respond: () => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  return calls;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function rejects(promise: Promise<void>, message: string) {
  try {
    await promise;
  } catch {
    return;
  }
  throw new Error(message);
}

const realFetch = globalThis.fetch;
try {
  // Success: POSTs to /auth/refresh with the current bearer token and stores the new one.
  {
    const calls = stubFetch(() => jsonResponse({ data: { token: "new-token" } }));
    const stored: string[] = [];
    await refreshSessionToken({ token: "old-token", setToken: (t) => void stored.push(t) });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/v1/auth/refresh");
    assert.equal(calls[0].init.method, "POST");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer old-token");
    assert.deepEqual(stored, ["new-token"]);
  }

  // No token: nothing is sent.
  {
    const calls = stubFetch(() => jsonResponse({ data: { token: "x" } }));
    const stored: string[] = [];
    await rejects(refreshSessionToken({ token: null, setToken: (t) => void stored.push(t) }), "must reject without a token");
    assert.equal(calls.length, 0);
    assert.deepEqual(stored, []);
  }

  // Server error (e.g. 401): rejects and keeps the old token.
  {
    stubFetch(() => jsonResponse({ detail: "Invalid token" }, 401));
    const stored: string[] = [];
    await rejects(refreshSessionToken({ token: "old", setToken: (t) => void stored.push(t) }), "must reject on 401");
    assert.deepEqual(stored, []);
  }

  // Malformed body: rejects and keeps the old token.
  {
    stubFetch(() => jsonResponse({ data: {} }));
    const stored: string[] = [];
    await rejects(refreshSessionToken({ token: "old", setToken: (t) => void stored.push(t) }), "must reject without a token in the response");
    assert.deepEqual(stored, []);
  }

  // Network failure: rejects and keeps the old token.
  {
    stubFetch(() => {
      throw new TypeError("network down");
    });
    const stored: string[] = [];
    await rejects(refreshSessionToken({ token: "old", setToken: (t) => void stored.push(t) }), "must reject on network failure");
    assert.deepEqual(stored, []);
  }
} finally {
  globalThis.fetch = realFetch;
}

console.log("Session refresh OK");
