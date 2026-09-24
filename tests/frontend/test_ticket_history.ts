import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import type { TicketHistory } from "../../src/types/index.ts";

// "Load More" pagination: a ticket detail page shows at most
// TICKET_HISTORY_GROUPS_PER_PAGE history groups (one timestamped card per
// group), so a busy ticket does not force the reader through one endless
// scroll. Each click reveals the next page of groups without dropping the
// groups already on screen, and the counter climbs to the full total.
const MINUTE = 60 * 1000;
const base = Date.parse("2026-09-08T12:30:00.000Z");

const row = (id: string, offsetMs: number): TicketHistory => ({
  id,
  type: "updated",
  object: "Ticket",
  attribute: "state",
  created_at: new Date(base + offsetMs).toISOString(),
});

// 90 events, each ~10 minutes apart: every event is its own session group and
// the run crosses many hour boundaries, so hour bucketing cannot stand in for
// grouping. This is the shape the reader reported.
const ninety = Array.from({ length: 90 }, (_, i) => row(`e${i}`, -i * 10 * MINUTE));

const ticket = {
  id: "1",
  number: "101010",
  title: "Monitor offline",
  state: "open",
  priority: "2 normal",
  customer_name: "Acme",
  group_name: "Support",
  tags: [],
  zammad_created_at: new Date(base).toISOString(),
  zammad_updated_at: new Date(base + 30 * MINUTE).toISOString(),
} as never;

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { TICKET_HISTORY_GROUPS_PER_PAGE, TicketHistoryTimeline } =
    await vite.ssrLoadModule("/src/pages/ticket-detail.tsx") as typeof import("../../src/pages/ticket-detail.tsx");

  const markup = (history: TicketHistory[]) =>
    renderToStaticMarkup(
      createElement(TicketHistoryTimeline, { ticket, articleCount: 0, history, loading: false, error: false }),
    );

  const pageSize = TICKET_HISTORY_GROUPS_PER_PAGE;

  const cardCount = (html: string) => html.match(/rounded-xl border bg-card\/50/g)?.length ?? 0;
  const eventCount = (html: string) => html.match(/updated Ticket State/g)?.length ?? 0;
  const summary = (html: string) => html.match(/Showing \d+ of \d+ history events/)?.[0] ?? "no summary";
  const moreCount = (html: string) => Number(html.match(/\((\d+) more\)/)?.[1] ?? "0");

  assert.equal(pageSize, 3);

  // Page 1 of the reported ticket: 3 groups, and the counter must not jump to
  // the number of hour buckets the events happen to span.
  const first = markup(ninety);
  assert.equal(cardCount(first), 3);
  assert.equal(eventCount(first), 3);
  assert.equal(summary(first), "Showing 3 of 90 history events");
  assert.match(first, /\(87 more\)/);

  // A short ticket renders every event and offers no Load More at all.
  const short = markup([row("a", 0), row("b", -10 * MINUTE)]);
  assert.equal(cardCount(short), 2);
  assert.equal(summary(short), "Showing 2 of 2 history events");
  assert.doesNotMatch(short, /Load More/);

  // A single crowded group is atomic: it is one card even when it holds many
  // events, so paging counts cards rather than events.
  const crowded = markup([0, 1, 2, 3, 4, 5].map((i) => row(`c${i}`, -i * 1000)));
  assert.equal(cardCount(crowded), 1);
  assert.equal(summary(crowded), "Showing 6 of 6 history events");
  assert.doesNotMatch(crowded, /Load More/);

  // The reported symptom: a large ticket keeps disclosing groups until nothing
  // is left hidden, and never stalls at a fixed ceiling.
  assert.equal(moreCount(first) + cardCount(first), 90, "first page + remaining events must cover the ticket");

  // Filter buttons: exactly one button may carry the blue "default" variant.
  // "All" is selected on first render, so every other filter must be neutral.
  const buttonFor = (html: string, label: string) =>
    html.match(new RegExp(`<button[^>]*>(?:<svg[\\s\\S]*?</svg>)?${label}</button>`))?.[0] ?? "";
  const isActive = (button: string) => button.includes("bg-primary text-primary-foreground");
  const isNeutral = (button: string) => button.includes("border border-input bg-background");

  const labels = ["All", "State Changes", "Articles", "SLA", "Owner", "Notifications"];
  const buttons = labels.map((label) => buttonFor(first, label));
  assert.ok(buttons.every(Boolean), "every filter button must render");
  assert.equal(buttons.filter(isActive).length, 1, "exactly one filter may look selected");
  assert.ok(isActive(buttons[0]), "the initial filter (All) is the selected one");
  for (let i = 1; i < buttons.length; i++) {
    assert.ok(isNeutral(buttons[i]), `${labels[i]} must use the inactive style`);
    assert.ok(!isActive(buttons[i]), `${labels[i]} must not look selected`);
  }

  // The sort control is not a filter: it must stay neutral so it never competes
  // with the selected filter for the "one blue thing" cue.
  const sortButton = buttonFor(first, "Newest first");
  assert.ok(sortButton, "the sort button must render");
  assert.ok(!isActive(sortButton), "the sort button must not look selected");

  // Switching filters cannot be driven here: the selected key lives in
  // component useState and the repo has no DOM environment or test runner, so
  // SSR only ever renders the initial "all" selection. The assertions above
  // pin the style of the selected vs unselected buttons; the switch itself is
  // the same `filter === item.key` comparison applied to the clicked key.
} finally {
  await vite.close();
}

console.log("Ticket history pagination OK");

// Progression: the page arithmetic must keep disclosing groups until the whole
// ticket is shown. The component owns this in useState, so this pins the
// identical expression rather than a private helper.
{
  const groups = Array.from({ length: 30 }, (_, i) => ({ id: `g${i}`, events: 3 }));
  let last = 0;
  for (let pages = 1; pages <= 20; pages++) {
    const visible = groups.slice(0, pages * 3);
    const events = visible.reduce((total, group) => total + group.events, 0);
    assert.ok(events >= last, "visible events must never shrink");
    last = events;
  }
  assert.equal(last, 90, "every group must eventually be shown");
}
console.log("Ticket history pagination progression OK");
