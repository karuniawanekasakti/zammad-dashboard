import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { automaticSyncRequest, default: SettingsPage } = await vite.ssrLoadModule("/src/pages/settings.tsx") as typeof import("./src/pages/settings.tsx");

  assert.equal(automaticSyncRequest(undefined, null), null);
  assert.equal(automaticSyncRequest({ automatic: { eligible: true, required_kind: "full", blockers: [], next_eligible_at: null } }, null), null);
  assert.equal(automaticSyncRequest({ automatic: { eligible: false, required_kind: null, blockers: [], next_eligible_at: null }, freshness: { status: "up_to_date", last_success_at: null, checkpoint_source: null } }, null), null);
  const request = automaticSyncRequest({ automatic: { eligible: true, required_kind: "full", blockers: [], next_eligible_at: null }, freshness: { status: "never_synced", last_success_at: null, checkpoint_source: null } }, null);
  assert.deepEqual(request, { key: "full:never:none", kind: "full" });
  assert.equal(automaticSyncRequest({ automatic: { eligible: true, required_kind: "full", blockers: [], next_eligible_at: null }, freshness: { status: "never_synced", last_success_at: null, checkpoint_source: null } }, request?.key ?? null), null);

  const queryClient = new QueryClient();
  queryClient.setQueryData(["settings", "status"], {
    health: { database: "ok", redis: "ok", zammad: "ok" },
    worker: { reachable: true },
  });

  assert.doesNotThrow(() => renderToString(
    createElement(QueryClientProvider, { client: queryClient }, createElement(SettingsPage)),
  ));
} finally {
  await vite.close();
}

console.log("Settings page compatibility OK");
