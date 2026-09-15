import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createServer } from "vite";
import type { Ticket } from "./src/types/index.ts";

// The Overview records table reports a ticket's Severity (the Zammad
// `priority_case` custom field, e.g. "P1 - Critical"), not its Zammad
// Priority (low/normal/high/very high). The two are distinct fields and the
// Tickets page already labels this one "Severity".
const ticket = (overrides: Partial<Ticket>): Ticket => ({
  id: "1",
  zammad_id: 101,
  number: "101010",
  title: "Monitor offline",
  state: "open",
  priority: "high",
  priority_id: "3",
  state_id: "2",
  severity: "p01",
  severity_label: "P1 - Critical",
  ticket_category: null,
  ticket_category_label: null,
  group_id: "g1",
  group_name: "Support",
  owner_id: null,
  owner_name: null,
  customer_name: "Acme",
  tags: [],
  sla_status: "safe",
  escalation_at: null,
  first_response_at: null,
  first_response_escalation_at: null,
  first_response_in_min: null,
  first_response_diff_in_min: null,
  close_at: null,
  close_escalation_at: null,
  close_in_min: null,
  close_diff_in_min: null,
  update_escalation_at: null,
  update_diff_in_min: null,
  first_response_remaining_secs: null,
  first_response_breached: false,
  close_breached: false,
  reopen_count: 0,
  first_reply_time_secs: null,
  resolution_time_secs: null,
  zammad_created_at: "2026-01-05T00:00:00.000Z",
  zammad_updated_at: "2026-01-05T00:00:00.000Z",
  closed_at: null,
  ...overrides,
});

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { default: OverviewPage, EXPORT_HEADERS, csvRow } =
    await vite.ssrLoadModule("/src/pages/overview.tsx") as typeof import("./src/pages/overview.tsx");

  const render = (rows: Ticket[]) => {
    const queryClient = new QueryClient();
    const year = new Date().getFullYear();
    queryClient.setQueryData(["overview", "agent::", "year", year, String(year), "all", "all", "created", 1], {
      chart: [{ label: "Jan", created: rows.length, closed: 0, open: rows.length, reopened: 0, backlog: rows.length }],
      totals: { created: rows.length, closed: 0, open: rows.length, reopened: 0, backlog: rows.length },
      tickets: rows,
      total: rows.length,
      groups: ["Support"],
      agents: [],
    });
    return renderToString(
      createElement(QueryClientProvider, { client: queryClient }, createElement(OverviewPage)),
    );
  };

  const html = render([ticket({})]);
  const tableHeaders = (html.match(/<th[^>]*>([^<]*)<\/th>/g) ?? []).map((th) => th.replace(/<[^>]+>/g, ""));

  // The reported symptom: the column was labelled "Priority".
  assert.ok(tableHeaders.includes("Severity"), `expected a Severity column, got: ${tableHeaders.join(" | ")}`);
  assert.ok(!tableHeaders.includes("Priority"), `the Priority column must be gone, got: ${tableHeaders.join(" | ")}`);

  // The header is only honest if the cell shows severity, not priority. The
  // fixture deliberately gives the two fields different labels ("high" vs
  // "P1 - Critical") so a mis-wired cell cannot pass.
  assert.match(html, /P1 - Critical/, "the Severity column must render the severity label");
  assert.doesNotMatch(html, />High</, "the Priority badge must no longer render in the table");

  // A ticket without severity shows a dash rather than falling back to priority.
  const empty = render([ticket({ severity: null, severity_label: null })]);
  assert.doesNotMatch(empty, />High</, "a severity-less ticket must not fall back to its priority");
  assert.match(empty, /—/, "a severity-less ticket shows an em dash");

  // The Records card's Download button exports this same table, so the CSV
  // must carry Severity too rather than re-introducing a Priority column.
  assert.ok(EXPORT_HEADERS.includes("Severity"), `CSV headers must include Severity: ${EXPORT_HEADERS.join(",")}`);
  assert.ok(!EXPORT_HEADERS.includes("Priority"), `CSV headers must not include Priority: ${EXPORT_HEADERS.join(",")}`);
  const row = csvRow(ticket({}));
  assert.ok(row.includes("P1 - Critical"), `CSV row must carry the severity label: ${row.join(",")}`);
  assert.ok(!row.includes("high"), `CSV row must not carry the priority: ${row.join(",")}`);
} finally {
  await vite.close();
}

console.log("Overview Severity column OK");
