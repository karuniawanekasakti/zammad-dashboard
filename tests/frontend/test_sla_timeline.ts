import assert from "node:assert/strict";
import type * as MockData from "../../src/lib/mock-data.ts";
import type * as SlaTimeline from "../../src/lib/sla-timeline.ts";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { articlesForTicket, historyForTicket, tickets } =
  await vite.ssrLoadModule("/src/lib/mock-data.ts") as typeof MockData;
const { mergeSlaTimeline } =
  await vite.ssrLoadModule("/src/lib/sla-timeline.ts") as typeof SlaTimeline;

const ticket = tickets[0];
const articles = articlesForTicket(ticket.id);
const timeline = mergeSlaTimeline(historyForTicket(ticket.id), articles);
const types = timeline.map((entry) => entry.type);

assert.ok(types.includes("article"), "full history includes ticket articles");
for (const type of [
  "sla_start",
  "sla_pause",
  "sla_resume",
  "sla_warning",
  "sla_critical",
  "sla_breach",
  "sla_milestone_complete",
] as const) {
  assert.ok(types.includes(type), `mock history includes ${type}`);
}
assert.deepEqual(
  timeline.map((entry) => entry.timestamp),
  timeline.map((entry) => entry.timestamp).toSorted(),
  "merged timeline is chronological",
);
assert.equal(new Set(timeline.map((entry) => entry.id)).size, timeline.length, "merged entries have unique ids");
assert.ok(
  timeline.filter((entry) => entry.type !== "article").every((entry) => entry.label.length > 0),
  "every SLA event has a human-readable label",
);
const article = timeline.find((entry) => entry.type === "article");
assert.equal(article?.authorName, articles[0]?.author_name);
assert.equal(article?.authorRole, articles[0]?.author_role);
await vite.close();

console.log("Merged SLA timeline OK");
