import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";
import type * as ApiModule from "./src/lib/api.ts";
import type * as SlaDetailModule from "./src/pages/sla-detail.tsx";

process.env.VITE_USE_MOCK = "true";
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { api } = await vite.ssrLoadModule("/src/lib/api.ts") as typeof ApiModule;
  const { default: SlaDetailPage } = await vite.ssrLoadModule("/src/pages/sla-detail.tsx") as typeof SlaDetailModule;
  const scope = { role: "agent" as const, group_ids: [], user_id: "" };
  const id = "tkt-000001";
  const [ticket, history, monitor] = await Promise.all([
    api.getTicket(id),
    api.getTicketHistory(id),
    api.listSlaMonitor(scope),
  ]);

  assert.ok(ticket, "mock and real API contract requires ticket data or null");
  assert.ok(Array.isArray(ticket.articles));
  assert.ok(Array.isArray(history));
  assert.ok(Array.isArray(monitor.tickets));

  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  queryClient.setQueryData(["ticket", id], ticket);
  queryClient.setQueryData(["ticket-history", id], history);
  queryClient.setQueryData(["sla", "monitor", scope], monitor);
  const originalError = console.error;
  console.error = () => undefined;
  const markup = renderToStaticMarkup(createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(MemoryRouter, null, createElement(SlaDetailPage, { isInline: true, ticketId: id })),
  ));
  console.error = originalError;
  assert.match(markup, /Overall SLA status/);
  assert.match(markup, /Ticket context/);
  assert.match(markup, new RegExp(ticket.ticket.customer_name));
  assert.match(markup, /Milestone performance/);
  assert.doesNotMatch(markup, /Ticket not found/);
} finally {
  await vite.close();
}

console.log("SLA detail data flow OK");
