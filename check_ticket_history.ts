import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import type { TicketHistory } from "./src/types/index.ts";

// "Load More" pagination: a ticket detail page must show at most
// TICKET_HISTORY_EVENTS_PER_HOUR history events per hour, so a busy ticket does
// not force the reader through a single endless scroll.
const HOUR = 60 * 60 * 1000;
const base = Date.parse("2026-09-08T12:30:00.000Z");

const row = (id: string, offsetMs: number): TicketHistory => ({
  id,
  type: "updated",
  object: "Ticket",
  attribute: "state",
  created_at: new Date(base + offsetMs).toISOString(),
});

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
  zammad_updated_at: new Date(base + 30 * 60 * 1000).toISOString(),
} as never;

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { TICKET_HISTORY_EVENTS_PER_HOUR, historyByHour, historyHourStart, TicketHistoryTimeline } =
    await vite.ssrLoadModule("/src/pages/ticket-detail.tsx") as typeof import("./src/pages/ticket-detail.tsx");

  const render = (history: TicketHistory[]) =>
    renderToStaticMarkup(
      createElement(TicketHistoryTimeline, { ticket, articleCount: 0, history, loading: false, error: false }),
    );

  const count = (markup: string) => markup.match(/updated Ticket State/g)?.length ?? 0;
  const shown = (markup: string) => {
    const match = markup.match(/Showing (\d+) of (\d+) history events/);
    return match ? `Showing ${match[1]} of ${match[2]} history events` : "no summary";
  };

  assert.equal(TICKET_HISTORY_EVENTS_PER_HOUR, 3);

  // Hour buckets follow the viewer's local clock, not UTC.
  const noon = Date.parse("2026-09-08T12:00:00.000Z");
  const hourStart = historyHourStart(noon);
  assert.equal(hourStart, new Date(noon).setMinutes(0, 0, 0));
  assert.equal(historyHourStart(noon + HOUR - 1), hourStart);
  assert.equal(historyHourStart(noon + HOUR), hourStart + HOUR);

  // Event times passed newest-first stay grouped into one bucket per hour.
  const spans = historyByHour([
    { time: hourStart + 30 * 60 * 1000 },
    { time: hourStart + 10 * 60 * 1000 },
    { time: hourStart - 30 * 60 * 1000 },
  ]);
  assert.deepEqual(spans.map((bucket) => bucket.hour), [hourStart, hourStart - HOUR]);
  assert.deepEqual(spans.map((bucket) => bucket.events.length), [2, 1]);

  // One crowded hour (6 events) starts at 1 of 6 and never exceeds 3 rendered.
  const crowded = [0, 1, 2, 3, 4, 5].map((i) => row(`e${i}`, -i * 1000));
  const first = render(crowded);
  assert.equal(shown(first), "Showing 1 of 6 history events");
  assert.match(first, /\(1 more\)/);
  assert.equal(count(first), 1);

  // A quiet hour is never starved by a crowded one: each hour contributes 1.
  const mixed = [
    row("quiet-1", -HOUR - 1000),
    row("quiet-2", -HOUR - 2000),
    row("busy-1", -1000),
    row("busy-2", -2000),
    row("busy-3", -3000),
    row("busy-4", -4000),
  ];
  const second = render(mixed);
  assert.equal(shown(second), "Showing 2 of 6 history events");
  assert.match(second, /\(2 more\)/);
  assert.equal(count(second), 2);

  // Two hours of 4 events: 2 shown, then 4, then 6 once every hour hits the cap
  // and Load More disappears.
  const twoHours = [0, 1, 2, 3].map((i) => row(`a${i}`, -i * 1000)).concat(
    [0, 1, 2, 3].map((i) => row(`b${i}`, -HOUR - i * 1000)),
  );
  const third = render(twoHours);
  assert.equal(shown(third), "Showing 2 of 8 history events");
  assert.match(third, /\(2 more\)/);
  assert.equal(count(third), 2);

  // An hour holding fewer events than the cap renders all of them.
  const sparse = [row("only", -1000)];
  const fourth = render(sparse);
  assert.equal(shown(fourth), "Showing 1 of 1 history events");
  assert.doesNotMatch(fourth, /Load More/);
  assert.equal(count(fourth), 1);
} finally {
  await vite.close();
}

console.log("Ticket history pagination OK");
