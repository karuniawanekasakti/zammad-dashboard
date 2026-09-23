import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";
import type { SlaMonitorData, SlaMonitorTicket, Ticket } from "./src/types/index.ts";
import type * as SlaPageModule from "./src/pages/sla.tsx";

// Issue #42. A manager opening the SLA detail page sees a metrics header
// (compliance rate, active breaches, trend vs the previous period, average
// time to breach) and a dashboard list that puts the worst tickets first.
//
// These assertions live at the component seam: the rendered markup is the only
// thing a manager can observe, so the numbers, the arrows, and the collapse
// state are pinned as text rather than by reaching into component state.
const MINUTE = 60 * 1000;

const tickets: SlaMonitorTicket[] = [
  // Unsorted on purpose: the list must impose urgency order itself.
  { id: "pr-1", number: "1", title: "Safe ticket", state: "open", live_sla_status: "safe", sla_remaining_ms: 20 * 60 * MINUTE, owner_id: "a1", owner_name: "Adi Nugroho", group_name: "Support", priority: "normal", sla_progress: 10, actionable_deadline: null },
  { id: "pr-2", number: "2", title: "On track ticket", state: "open", live_sla_status: "on_track", sla_remaining_ms: 9 * 60 * MINUTE, owner_id: "a2", owner_name: "Bunga Sari", group_name: "Support", priority: "normal", sla_progress: 20, actionable_deadline: null },
  { id: "pr-3", number: "3", title: "Warning ticket", state: "open", live_sla_status: "warning", sla_remaining_ms: 90 * MINUTE, owner_id: "a1", owner_name: "Adi Nugroho", group_name: "Support", priority: "high", sla_progress: 60, actionable_deadline: null },
  { id: "pr-4", number: "4", title: "Critical ticket", state: "open", live_sla_status: "critical", sla_remaining_ms: 20 * MINUTE, owner_id: "a2", owner_name: "Bunga Sari", group_name: "Support", priority: "high", sla_progress: 85, actionable_deadline: null },
  { id: "pr-5", number: "5", title: "Breached ticket", state: "open", live_sla_status: "breached", sla_remaining_ms: -3 * 60 * MINUTE, owner_id: "a3", owner_name: "Citra Dewi", group_name: "Support", priority: "very high", sla_progress: 100, actionable_deadline: null },
] as unknown as SlaMonitorTicket[];

// A manager reviewing the quarter: 25 monitored tickets, 20 met, 5 breached.
// 80% compliance, and the same window a quarter ago sat at 65% — an improving
// 15-point trend. Breaches ran 2h and 4h late, so the average is 3h.
const monitor = {
  compliance_rate: 80,
  total_with_sla: 25,
  total_closed_on_time: 40,
  on_track: 12,
  warning: 5,
  critical: 3,
  at_risk: 8,
  breached: 5,
  no_sla: 2,
  avg_resolution_minutes: 120,
  freshness: { status: "up_to_date", last_success_at: null, checkpoint_source: "watermark" },
  summary: {
    total: 27,
    total_active: 27,
    total_with_sla: 25,
    sla_total: 25,
    compliance_rate: 80,
    total_closed_on_time: 40,
    on_track: 12,
    warning: 5,
    critical: 3,
    at_risk: 8,
    breached: 5,
    no_sla: 2,
    avg_resolution_minutes: 120,
    avg_resolution_mins: 120,
  },
  by_priority: {},
  by_group: {},
  priority_rows: [],
  sla_rows: [],
  trend: [],
  heatmap: { grid: [], max: 1 },
  tickets,
  risk_rows: [],
  breach_log: [],
  manager_metrics: {
    week: { compliance_rate: 78, active_breaches: 6, trend_percentage: -4, average_breach_time_minutes: 90 },
    month: { compliance_rate: 80, active_breaches: 5, trend_percentage: 15, average_breach_time_minutes: 180 },
    quarter: { compliance_rate: 74, active_breaches: 3, trend_percentage: 0, average_breach_time_minutes: null },
    year: { compliance_rate: 71, active_breaches: 9, trend_percentage: 22, average_breach_time_minutes: 260 },
  },
} as unknown as SlaMonitorData;

// Components render router-aware links, so every tree gets a router around it.
const markupFor = (element: unknown) => renderToStaticMarkup(createElement(MemoryRouter, null, element) as never);
const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;
const positions = (html: string, needles: string[]) => needles.map((needle) => {
  const at = html.indexOf(needle);
  assert.notEqual(at, -1, `expected to render ${needle}`);
  return at;
});

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { ManagerMetricsSummary } = await vite.ssrLoadModule("/src/components/sla/manager-metrics-summary.tsx") as typeof import("./src/components/sla/manager-metrics-summary.tsx");
  const { SlaDashboardList } = await vite.ssrLoadModule("/src/components/sla/sla-dashboard-list.tsx") as typeof import("./src/components/sla/sla-dashboard-list.tsx");
  const { severityMonitorRows } = await vite.ssrLoadModule("/src/pages/sla.tsx") as typeof SlaPageModule;

  // --- Manager metrics header ------------------------------------------------
  const header = markupFor(createElement(ManagerMetricsSummary, { monitor, scope: null }));
  assert.match(header, /Compliance Rate/);
  assert.match(header, /Active Breaches/);
  assert.match(header, /Trend vs Last Period/);
  assert.match(header, /Average Time to Breach/);
  // Value carries the % suffix, and the helper states the count out of the total.
  assert.match(header, /80\.0%/, "compliance rate must render with a % suffix");
  assert.match(header, /20 of 25/, "helper must state the count out of the total");
  // 5 breaches crosses the threshold; the badge turns orange.
  assert.match(header, /bg-orange-500/, "an active-breach badge at >= 3 must turn orange");
  // 15 points up is an improving trend.
  assert.match(header, /↑/, "a positive trend must show an up arrow");
  assert.match(header, /15\.0% vs prior period/);
  // 180 minutes reads as human time, not a raw minute count.
  assert.match(header, /3h/, "average breach time must be human-readable");

  // --- Period selector drives the figures ------------------------------------
  const week = markupFor(createElement(ManagerMetricsSummary, { monitor, scope: null, period: "week" }));
  assert.match(week, /78\.0%/);
  assert.match(week, /↓/, "a negative trend must show a down arrow");
  assert.match(week, /1h 30m/);
  assert.match(week, /6/);

  const quarter = markupFor(createElement(ManagerMetricsSummary, { monitor, scope: null, period: "quarter" }));
  assert.match(quarter, /74\.0%/);
  assert.doesNotMatch(quarter, /↑|↓/, "a flat trend must show neither arrow");
  assert.match(quarter, /N\/A/, "a null average breach time must read N/A");
  // Exactly three breaches is the boundary: orange starts here.
  assert.match(quarter, /bg-orange-500/);

  const twoBreaches = markupFor(createElement(ManagerMetricsSummary, {
    monitor: { ...monitor, manager_metrics: { ...monitor.manager_metrics, month: { ...monitor.manager_metrics.month, active_breaches: 2 } } },
    scope: null,
  }));
  assert.doesNotMatch(twoBreaches, /bg-orange-500/, "two breaches must not cross the orange threshold");

  // Periods keyed to the selected period: changing the selection changes the
  // numbers the manager reads, which is the whole point of the selector.
  const year = markupFor(createElement(ManagerMetricsSummary, { monitor, scope: null, period: "year" }));
  assert.match(year, /71\.0%/);

  // --- Severity ordering -----------------------------------------------------
  const severityRows = severityMonitorRows([
    { severity: "p01" },
    { severity: "p02" },
    { severity: "p02" },
    { severity: "p03" },
    { severity: "p03" },
    { severity: "p03" },
  ] as Ticket[]);
  assert.deepEqual(severityRows.slice(0, 3).map((row) => [row.id, row.total]), [["p03", 3], ["p02", 2], ["p01", 1]], "severity rows must be ordered by ticket count descending");

  // --- Urgency ordering ------------------------------------------------------
  const list = markupFor(createElement(SlaDashboardList, { tickets, scope: null }));
  const order = positions(list, ["Breached ticket", "Critical ticket", "Warning ticket", "On track ticket", "Safe ticket"]);
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i - 1] < order[i], "rows must be ordered breached → critical → warning → on-track → safe");
  }

  // --- Quick stats mirror the SLA monitor page ------------------------------
  assert.match(list, /On Track/);
  assert.match(list, /At-Risk/);
  assert.match(list, /Breached/);
  assert.match(list, /Warning ≤ 2 jam · Critical ≤ 30 menit/);

  // --- Group by agent --------------------------------------------------------
  // The collapse state lives in the mounted page, not in the props, so it is
  // only observable on a page that has actually been clicked. What renders
  // here is the section inventory: every agent gets one, ordered by ticket
  // count descending so the busiest users are visible first.
  assert.match(list, /Group by Agent/, "the grouping toggle must render");
  assert.doesNotMatch(list, /aria-expanded/, "the ungrouped list has no sections to expand");
  const grouped = markupFor(createElement(SlaDashboardList, { tickets, scope: null, groupByAgent: true }));
  assert.equal(count(grouped, /aria-expanded/g), 3, "one expandable section per agent");
  assert.equal(count(grouped, /class="font-sans text-sm"[^>]*>/g), 0, "grouped rows keep the ticket title in one cell");
  // Every ticket is still present exactly once: grouping rearranges, it does
  // not duplicate or drop work.
  const flatTitles = count(list, /<td class="p-3 align-middle font-mono text-xs">/g);
  const groupedTitles = count(grouped, /<td class="p-3 align-middle font-mono text-xs">/g);
  assert.equal(flatTitles, tickets.length, "the flat list shows every ticket");
  assert.equal(groupedTitles, tickets.length, "the grouped list shows every ticket");
  // Adi and Bunga each own two tickets; Citra owns one. Ties are alphabetical.
  const groupedOrder = positions(grouped, ["Adi Nugroho", "Bunga Sari", "Citra Dewi"]);
  assert.ok(groupedOrder[0] < groupedOrder[1] && groupedOrder[1] < groupedOrder[2], "agent sections must be ordered by ticket count descending, then name");

  // --- Entry modes -----------------------------------------------------------
  const inline = markupFor(createElement(ManagerMetricsSummary, { monitor, scope: null, mode: "inline" }));
  assert.equal(inline, "", "inline mode omits the metrics header entirely");
  const split = markupFor(createElement(ManagerMetricsSummary, { monitor, scope: null, mode: "split" }));
  assert.match(split, /Compliance Rate/, "split-view mode includes the metrics header");
} finally {
  await vite.close();
}

console.log("SLA manager metrics and dashboard list OK");
