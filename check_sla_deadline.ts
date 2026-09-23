import assert from "node:assert/strict";
import { createServer } from "vite";
import { slaDeadline, slaProgress, slaRemainingMs, slaStatus, slaVerdictsAvailable } from "./src/lib/sla-deadline.ts";
import type { Ticket } from "./src/types/index.ts";

const current = "2026-09-08T12:00:00.000Z";
const staleResponse = "2026-09-08T06:00:00.000Z";
const update = "2026-09-08T10:00:00.000Z";
const resolution = "2026-09-08T14:00:00.000Z";

assert.equal(slaDeadline({
  escalation_at: current,
  first_response_at: "2026-09-08T05:00:00.000Z",
  first_response_escalation_at: staleResponse,
  first_response_diff_in_min: 60,
  update_escalation_at: update,
  close_escalation_at: resolution,
})?.toISOString(), current);

assert.equal(slaDeadline({
  escalation_at: null,
  first_response_at: null,
  first_response_escalation_at: current,
  first_response_diff_in_min: null,
  update_escalation_at: update,
  close_escalation_at: resolution,
})?.toISOString(), current);

assert.equal(slaDeadline({
  escalation_at: null,
  first_response_at: null,
  first_response_escalation_at: staleResponse,
  first_response_diff_in_min: 30,
  update_escalation_at: update,
  close_escalation_at: resolution,
})?.toISOString(), update);

assert.equal(slaDeadline({
  escalation_at: null,
  first_response_at: "2026-09-08T05:00:00.000Z",
  first_response_escalation_at: staleResponse,
  first_response_diff_in_min: 60,
  update_escalation_at: resolution,
  close_escalation_at: update,
})?.toISOString(), update);

assert.equal(slaDeadline({
  escalation_at: null,
  first_response_at: null,
  first_response_escalation_at: null,
  first_response_diff_in_min: null,
  update_escalation_at: null,
  close_escalation_at: null,
}), null);

const now = new Date("2026-09-08T08:00:00.000Z");
const ticket = (deadline: string | null, overrides = {}) => ({
  escalation_at: deadline,
  first_response_at: null,
  first_response_escalation_at: null,
  first_response_diff_in_min: null,
  update_escalation_at: null,
  update_diff_in_min: null,
  close_escalation_at: null,
  state: "open" as const,
  close_at: null,
  closed_at: null,
  first_response_breached: false,
  close_breached: false,
  live_sla_status: "safe" as const,
  sla_remaining_ms: deadline ? new Date(deadline).getTime() - now.getTime() : null,
  zammad_created_at: "2026-09-08T04:00:00.000Z",
  ...overrides,
});

assert.equal(slaStatus(ticket("2026-09-08T08:30:00.000Z"), now), "critical");
assert.equal(slaStatus(ticket("2026-09-08T08:30:01.000Z"), now), "warning");
assert.equal(slaStatus(ticket("2026-09-08T10:00:00.000Z"), now), "warning");
assert.equal(slaStatus(ticket("2026-09-08T10:00:01.000Z"), now), "on_track");
assert.equal(slaStatus(ticket("2026-09-08T12:00:00.000Z", { first_response_breached: true }), now), "breached");
assert.equal(slaStatus(ticket(null, { first_response_breached: true }), now), "breached");
// The verdict is derived from the ticket's own facts, never from a verdict
// field: a stale "breached" with no breach evidence is not a breach.
const staleVerdict = ticket(null, { live_sla_status: "breached" as const, sla_remaining_ms: -15 * 60 * 1000 });
assert.equal(slaStatus(staleVerdict, now), "no_sla");
assert.equal(staleVerdict.sla_remaining_ms, -15 * 60 * 1000);
assert.equal(slaStatus(ticket(null, { state: "closed", close_at: current, first_response_diff_in_min: 5, close_diff_in_min: 10 }), now), "closed_on_time");
assert.equal(slaStatus(ticket(null, { state: "closed", close_at: current, first_response_diff_in_min: 5, update_diff_in_min: -1, close_diff_in_min: 10 }), now), "breached");
assert.equal(slaStatus(ticket(null), now), "no_sla");
assert.equal(slaRemainingMs(ticket("2026-09-08T12:00:00.000Z"), now), 4 * 60 * 60 * 1000);
assert.equal(slaProgress(ticket("2026-09-08T12:00:00.000Z"), now), 50);

assert.equal(slaVerdictsAvailable({ status: "up_to_date" }), true);
assert.equal(slaVerdictsAvailable({ status: "out_of_date" }), false);
assert.equal(slaVerdictsAvailable({ status: "never_synced" }), false);
assert.equal(slaVerdictsAvailable(null), false);
assert.equal(slaVerdictsAvailable(undefined), false);

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { buildMockSlaMonitor } = await vite.ssrLoadModule("/src/lib/api.ts") as typeof import("./src/lib/api.ts");
const { liveTickets, tickets } = await vite.ssrLoadModule("/src/lib/mock-data.ts") as typeof import("./src/lib/mock-data.ts");
const changingTicket = tickets.find((row) => row.state !== "closed" && row.state !== "merged");
assert.ok(changingTicket);
changingTicket.first_response_breached = false;
changingTicket.close_breached = false;
changingTicket.first_response_diff_in_min = null;
changingTicket.update_diff_in_min = null;
changingTicket.close_diff_in_min = null;
changingTicket.escalation_at = "2026-09-08T10:00:00.000Z";
assert.equal(liveTickets(new Date("2026-09-08T08:30:00.000Z")).find((row) => row.id === changingTicket.id)?.live_sla_status, "warning");
assert.equal(liveTickets(new Date("2026-09-08T10:01:00.000Z")).find((row) => row.id === changingTicket.id)?.live_sla_status, "breached");
assert.equal(liveTickets(new Date("2026-09-08T10:01:00.000Z")).find((row) => row.id === changingTicket.id)?.sla_remaining_ms, -60_000);
const mockTicket = (id: string, overrides: Partial<Ticket>): Ticket => ({
  ...ticket(null),
  id,
  zammad_id: Number(id),
  number: id,
  title: `Ticket ${id}`,
  priority: "unknown",
  priority_id: "",
  state_id: "2",
  severity: null,
  severity_label: null,
  ticket_category: null,
  ticket_category_label: null,
  group_id: "g-missing",
  group_name: "Unknown",
  owner_id: null,
  owner_name: null,
  customer_name: "Customer",
  tags: [],
  first_response_in_min: null,
  close_in_min: null,
  close_diff_in_min: null,
  update_diff_in_min: null,
  reopen_count: 0,
  first_reply_time_secs: null,
  resolution_time_secs: null,
  zammad_updated_at: now.toISOString(),
  ...overrides,
});
const historicalClose = "2026-09-08T07:00:00.000Z";
const mock = buildMockSlaMonitor([
  mockTicket("1", { escalation_at: current, state: "open" }),
  mockTicket("2", { state: "closed", state_id: "4", close_at: historicalClose, closed_at: historicalClose, first_response_breached: true }),
  mockTicket("3", { state: "merged", state_id: "5", close_at: historicalClose, closed_at: historicalClose }),
  mockTicket("4", { state: "closed", state_id: "4", close_at: historicalClose, closed_at: historicalClose, first_response_diff_in_min: 5, close_diff_in_min: 10 }),
  mockTicket("5", { state: "closed", state_id: "4", close_at: historicalClose, closed_at: historicalClose, first_response_diff_in_min: 5, update_diff_in_min: -1, close_diff_in_min: 10 }),
], now);
assert.equal(mock.summary.total_active, 1);
assert.equal(mock.by_group["g-missing"].total, 1);
assert.equal(mock.by_priority.unknown.total, 1);
assert.equal(mock.trend.find((point) => point.date === "2026-09-08")?.total, 3);
assert.deepEqual(mock.breach_log.map((row) => row.id), ["2", "5"]);
assert.equal(mock.breach_log.find((row) => row.id === "5")?.sla_remaining_ms, -60_000);
assert.equal(slaVerdictsAvailable(mock.freshness), true);
assert.equal(mock.freshness.status, "up_to_date");
assert.equal(mock.freshness.checkpoint_source, "dedicated");
assert.ok(mock.freshness.stale_after, "a synced mock dataset must publish stale_after");
assert.equal(slaVerdictsAvailable({ ...mock.freshness, status: "out_of_date" }), false);
assert.equal(slaVerdictsAvailable({ ...mock.freshness, status: "never_synced" }), false);
await vite.close();

console.log("Mock SLA deadline OK");
