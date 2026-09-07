import assert from "node:assert/strict";
import { slaDeadline, slaProgress, slaRemainingMs, slaStatus } from "./src/lib/sla-deadline.ts";

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
  update_escalation_at: null,
  close_escalation_at: resolution,
})?.toISOString(), resolution);

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
  close_escalation_at: null,
  state: "open" as const,
  close_at: null,
  closed_at: null,
  first_response_breached: false,
  close_breached: false,
  sla_status: "safe" as const,
  zammad_created_at: "2026-09-08T04:00:00.000Z",
  ...overrides,
});

assert.equal(slaStatus(ticket("2026-09-08T08:30:00.000Z"), now), "critical");
assert.equal(slaStatus(ticket("2026-09-08T08:30:01.000Z"), now), "warning");
assert.equal(slaStatus(ticket("2026-09-08T10:00:00.000Z"), now), "warning");
assert.equal(slaStatus(ticket("2026-09-08T10:00:01.000Z"), now), "on_track");
assert.equal(slaStatus(ticket("2026-09-08T12:00:00.000Z", { first_response_breached: true }), now), "breached");
assert.equal(slaStatus(ticket(null), now), "no_sla");
assert.equal(slaRemainingMs(ticket("2026-09-08T12:00:00.000Z"), now), 4 * 60 * 60 * 1000);
assert.equal(slaProgress(ticket("2026-09-08T12:00:00.000Z"), now), 50);

console.log("Mock SLA deadline OK");
