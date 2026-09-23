import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";
import type { TicketArticle, TicketHistory } from "./src/types/index.ts";

process.env.VITE_USE_MOCK = "true";
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { buildMockSlaMonitor } = await vite.ssrLoadModule("/src/lib/api.ts") as typeof import("./src/lib/api.ts");
  const { liveTickets } = await vite.ssrLoadModule("/src/lib/mock-data.ts") as typeof import("./src/lib/mock-data.ts");
  const { SlaDetailRoute } = await vite.ssrLoadModule("/src/pages/sla-detail.tsx") as typeof import("./src/pages/sla-detail.tsx");
  const { mergeEventsAndArticles } = await vite.ssrLoadModule("/src/lib/sla-timeline.ts") as typeof import("./src/lib/sla-timeline.ts");
  const { SlaProgressBar } = await vite.ssrLoadModule("/src/components/milestone-progress-bar.tsx") as typeof import("./src/components/milestone-progress-bar.tsx");
  const { ManagerMetricsSummary } = await vite.ssrLoadModule("/src/components/sla/manager-metrics-summary.tsx") as typeof import("./src/components/sla/manager-metrics-summary.tsx");
  const { VirtualizedArticleList } = await vite.ssrLoadModule("/src/components/tickets/virtualized-article-list.tsx") as typeof import("./src/components/tickets/virtualized-article-list.tsx");
  const { ARTICLE_PAGE_SIZE } = await vite.ssrLoadModule("/src/lib/article-pagination.ts") as typeof import("./src/lib/article-pagination.ts");

  const history = [
    { id: "start", type: "sla_start", title: "Resolution", created_at: "2026-01-01T09:00:00Z" },
    { id: "pause", attribute: "state", value_from: "open", value_to: "pending", created_at: "2026-01-01T10:00:00Z" },
    { id: "resume", attribute: "state", value_from: "pending", value_to: "open", created_at: "2026-01-01T11:00:00Z" },
    { id: "breach", type: "sla_breach", title: "Resolution", created_at: "2026-01-01T13:00:00Z" },
  ] as unknown as TicketHistory[];
  const articles = [{ id: "article", created_at: "2026-01-01T12:00:00Z", author_name: "Ari", author_role: "agent", type: "note", internal: false, body: "Update" }] as TicketArticle[];
  const timeline = mergeEventsAndArticles(history, articles);
  assert.deepEqual(timeline.map(({ type }) => type), ["sla_start", "sla_pause", "sla_resume", "article", "sla_breach"]);
  assert.match(timeline[1].label, /paused due to pending state/);

  for (const total of [0, 20, 85, 101, 145]) {
    const chunks = Array.from({ length: Math.ceil(total / ARTICLE_PAGE_SIZE) }, (_, index) => Math.min(ARTICLE_PAGE_SIZE, total - index * ARTICLE_PAGE_SIZE));
    assert.equal(chunks.reduce((sum, size) => sum + size, 0), total);
    assert.ok(chunks.every((size) => size > 0 && size <= ARTICLE_PAGE_SIZE));
    if (total) assert.equal(chunks.at(-1), total % ARTICLE_PAGE_SIZE || ARTICLE_PAGE_SIZE);
  }

  const empty = renderToStaticMarkup(createElement(VirtualizedArticleList, { articles: [], total: 0, hasMore: false, loadingMore: false, onLoadMore: () => undefined, renderArticle: () => null }));
  assert.match(empty, /No articles found for this ticket/);

  let seed = 45;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let index = 0; index < 20; index++) {
    const compliance = Math.round(random() * 1000) / 10;
    const breaches = Math.floor(random() * 20);
    const average = Math.floor(random() * 600);
    const monitor = buildMockSlaMonitor(liveTickets(new Date("2026-09-08T12:00:00Z")), new Date("2026-09-08T12:00:00Z"));
    monitor.manager_metrics!.month = { compliance_rate: compliance, active_breaches: breaches, trend_percentage: 0, average_breach_time_minutes: average };
    const markup = renderToStaticMarkup(createElement(ManagerMetricsSummary, { monitor, scope: "admin" }));
    assert.match(markup, new RegExp(`${compliance.toFixed(1)}%`));
    assert.match(markup, new RegExp(`>${breaches}<`));
    assert.match(markup, new RegExp(average < 60 ? `${average}m` : `${Math.floor(average / 60)}h`));
  }

  const ticket = liveTickets(new Date("2026-09-08T12:00:00Z"))[0];
  const progress = renderToStaticMarkup(createElement(SlaProgressBar, { label: "Resolution", history, deadline: new Date("2026-01-02T09:00:00Z"), now: new Date("2026-01-01T13:00:00Z"), status: "warning", progressPct: 50, ticketCreated: new Date("2026-01-01T09:00:00Z") }));
  assert.match(progress, /Resolution SLA progress/);
  assert.match(progress, /Paused for 1h 0m due to pending state/);

  const monitor = buildMockSlaMonitor([ticket], new Date("2026-09-08T12:00:00Z"));
  monitor.freshness = { ...monitor.freshness, status: "out_of_date" };
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  queryClient.setQueryData(["ticket", ticket.id], { ticket, articles: [] });
  queryClient.setQueryData(["ticket-history", ticket.id], []);
  const scope = { role: "agent", group_ids: [], user_id: "" } as const;
  queryClient.setQueryData(["sla", "monitor", scope], monitor);
  const detail = renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient }, createElement(MemoryRouter, null, createElement(SlaDetailRoute, { isInline: true, ticketId: ticket.id }))));
  assert.match(detail, /SLA verdicts are unavailable/);
  assert.match(detail, /Status<\/span><span[^>]*>unavailable/);
  assert.match(detail, /Remaining<\/span><span[^>]*>Unavailable/);
} finally {
  await vite.close();
}

console.log("SLA detail page OK");
