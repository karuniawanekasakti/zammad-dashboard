import assert from "node:assert/strict";
import { buildSlaSegments } from "../../src/lib/sla-progress.ts";
import type { TicketHistory } from "../../src/types/index.ts";

const start = new Date("2026-09-21T08:00:00Z");
const current = new Date("2026-09-21T12:00:00Z");
const pendingHistory: TicketHistory[] = [
  { id: "1", attribute: "state", value_from: "open", value_to: "pending", created_at: "2026-09-21T09:00:00Z" },
  { id: "2", attribute: "state", value_from: "pending", value_to: "open", created_at: "2026-09-21T11:15:00Z" },
];

assert.deepEqual(buildSlaSegments(pendingHistory, start, current), {
  segments: [
    { kind: "active", start: "2026-09-21T08:00:00.000Z", end: "2026-09-21T09:00:00.000Z", percent: 25 },
    { kind: "paused", start: "2026-09-21T09:00:00.000Z", end: "2026-09-21T11:15:00.000Z", percent: 56.25, reason: "pending state", durationMs: 8_100_000 },
    { kind: "active", start: "2026-09-21T11:15:00.000Z", end: "2026-09-21T12:00:00.000Z", percent: 18.75 },
  ],
  activities: [
    { kind: "start", at: "2026-09-21T08:00:00.000Z" },
    { kind: "pause", at: "2026-09-21T09:00:00.000Z", reason: "pending state" },
    { kind: "resume", at: "2026-09-21T11:15:00.000Z" },
    { kind: "current", at: "2026-09-21T12:00:00.000Z" },
  ],
});

const replyHistory: TicketHistory[] = [
  { id: "3", type: "customer_reply", created_at: "2026-09-21T10:00:00Z" },
  { id: "4", type: "agent_reply", created_at: "2026-09-21T10:30:00Z" },
];
const customerPause = buildSlaSegments(replyHistory, start, current);
assert.deepEqual(customerPause.segments[1], {
  kind: "paused",
  start: "2026-09-21T10:00:00.000Z",
  end: "2026-09-21T10:30:00.000Z",
  percent: 12.5,
  reason: "customer reply",
  durationMs: 1_800_000,
});

assert.deepEqual(buildSlaSegments([], start, current), {
  segments: [{ kind: "active", start: "2026-09-21T08:00:00.000Z", end: "2026-09-21T12:00:00.000Z", percent: 100 }],
  activities: [
    { kind: "start", at: "2026-09-21T08:00:00.000Z" },
    { kind: "current", at: "2026-09-21T12:00:00.000Z" },
  ],
});

console.log("SLA progress segment generation OK");
