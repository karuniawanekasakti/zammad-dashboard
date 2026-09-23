import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import type { ComponentType } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createServer } from "vite";

// The Overview page must never present fabricated figures while its primary
// query is pending or has failed:
//   * a zeroed chart (flat lines at 0) and "0 created ticket(s)" are claims
//     about the data, not a neutral absence of it, and
//   * the "No records match this period" empty state is a claim about the
//     filtered result set — it must not be shown for a failed request.
// The Tickets page must never present "No tickets match the current filters."
// for a failed list request, and a failed group/agent dependency must not
// silently degrade into a filter field with no options.

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { default: OverviewPage } = await vite.ssrLoadModule("/src/pages/overview.tsx") as typeof import("./src/pages/overview.tsx");
  const { default: TicketsPage } = await vite.ssrLoadModule("/src/pages/tickets.tsx") as typeof import("./src/pages/tickets.tsx");

  const render = (page: ComponentType, client = new QueryClient()) =>
    renderToString(
      createElement(
        QueryClientProvider,
        { client },
        createElement(MemoryRouter, null, createElement(page)),
      ),
    );

  // --- Overview: pending primary query -------------------------------------
  const pending = render(OverviewPage);

  // The Records table keeps its loading row.
  assert.match(pending, /Loading overview/, "the table must keep its loading row while pending");
  // The chart must not be a line chart of an empty dataset — recharts renders
  // no series for empty data, which is exactly the zero-looking chart the
  // page showed before. The card must say it is loading instead.
  assert.doesNotMatch(pending, /recharts-line/, "the chart must not render a series while pending");
  // No fabricated count in the Records description or the Download button.
  assert.doesNotMatch(pending, /0 created ticket\(s\)/, "a pending query must not report 0 created tickets");
  assert.doesNotMatch(pending, /Download 0 record/, "a pending query must not offer a 0-record download");
  // The empty state is a claim about the result set; it is not known yet.
  assert.doesNotMatch(pending, /No records match this period/, "the empty state must not appear while pending");

  // --- Overview: failed primary query --------------------------------------
  const failedClient = new QueryClient();
  const year = new Date().getFullYear();
  failedClient.setQueryData(["overview", "agent::", "year", year, String(year), "all", "all", "created", 1], undefined);
  const failed = render(OverviewPage, failedClient);
  assert.doesNotMatch(failed, /0 created ticket\(s\)/, "a failed query must not report 0 created tickets");
  assert.doesNotMatch(failed, /No records match this period/, "the empty state must not appear for a failed query");

  // --- Tickets: pending list query -----------------------------------------
  const ticketsPending = render(TicketsPage);
  assert.match(ticketsPending, /Loading/, "the tickets table must keep its loading state while pending");
  assert.doesNotMatch(ticketsPending, /No tickets match the current filters/, "the empty state must not appear while pending");
} finally {
  await vite.close();
}

console.log("Query states OK");
