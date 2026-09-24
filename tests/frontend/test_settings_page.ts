import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { automaticSyncRequest, default: SettingsPage } = await vite.ssrLoadModule("/src/pages/settings.tsx") as typeof import("../../src/pages/settings.tsx");

  assert.equal(automaticSyncRequest(undefined, null), null);
  assert.equal(automaticSyncRequest({ automatic: { eligible: true, required_kind: "full", blockers: [], next_eligible_at: null } }, null), null);
  assert.equal(automaticSyncRequest({ automatic: { eligible: false, required_kind: null, blockers: [], next_eligible_at: null }, freshness: { status: "up_to_date", last_success_at: null, checkpoint_source: null } }, null), null);
  const request = automaticSyncRequest({ automatic: { eligible: true, required_kind: "full", blockers: [], next_eligible_at: null }, freshness: { status: "never_synced", last_success_at: null, checkpoint_source: null } }, null);
  assert.deepEqual(request, { key: "full:never:none", kind: "full" });
  assert.equal(automaticSyncRequest({ automatic: { eligible: true, required_kind: "full", blockers: [], next_eligible_at: null }, freshness: { status: "never_synced", last_success_at: null, checkpoint_source: null } }, request?.key ?? null), null);

  const render = (queryClient: QueryClient) => renderToString(
    createElement(QueryClientProvider, { client: queryClient }, createElement(SettingsPage)),
  );

  const pending = render(new QueryClient());
  assert.ok((pending.match(/aria-label="Loading"/g) ?? []).length >= 2, "independent settings regions show their own loading indicators");
  assert.doesNotMatch(pending, /Never Synced|Idle|No sync attempt recorded yet|No sync run recorded yet|300|21600/);

  const queryClient = new QueryClient();
  queryClient.setQueryData(["settings", "bundle"], {
    schedules: { incremental_seconds: 600, full_reconcile_seconds: 43200 },
    zammad_base_url: "https://support.example.test",
    data_retention_days: 45,
  });
  queryClient.setQueryData(["settings", "status"], {
    health: { database: "ok", redis: "ok", zammad: "ok" },
    worker: { reachable: true },
    freshness: { status: "up_to_date", last_success_at: "2026-09-23T10:00:00Z", checkpoint_source: "watermark" },
    execution: null,
    latest_attempt: null,
  });
  const loaded = render(queryClient);
  assert.match(loaded, /Up to Date/);
  assert.match(loaded, /Idle/);
  assert.match(loaded, /No sync attempt recorded yet/);

} finally {
  await vite.close();
}

console.log("Settings page compatibility OK");
