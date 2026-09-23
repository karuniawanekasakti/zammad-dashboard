import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

import type * as InlinePanelModule from "./src/components/sla/inline-sla-panel.tsx";
import type * as SlaBadgeModule from "./src/components/sla-badge.tsx";
import type * as SlaDashboardListModule from "./src/components/sla/sla-dashboard-list.tsx";
import type * as SlaNavigationModule from "./src/lib/sla-navigation.ts";
import type * as SlaPageModule from "./src/pages/sla.tsx";
import type { SlaMonitorTicket } from "./src/types/index.ts";

// Opening a ticket from the /sla dashboard must not throw away the filters the
// manager is looking through, and the inline detail panel must behave like a
// modal: Tab stays inside it and it closes exactly once. Both are asserted here
// at the public seam — the rendered markup plus the exported URL builder — not
// by reaching into component state.
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const {
    INLINE_SLA_PANEL_DEFAULT_WIDTH,
    INLINE_SLA_PANEL_MAX_WIDTH,
    INLINE_SLA_PANEL_MIN_WIDTH,
    InlineSlaPanel,
    clampInlineSlaPanelWidth,
    containFocus,
    createSingleFire,
    resizeInlineSlaPanel,
  } = await vite.ssrLoadModule("/src/components/sla/inline-sla-panel.tsx") as typeof InlinePanelModule;
  const { SlaBadge } = await vite.ssrLoadModule("/src/components/sla-badge.tsx") as typeof SlaBadgeModule;
  const { SlaDashboardList, slaTicketDetailHref } = await vite.ssrLoadModule("/src/components/sla/sla-dashboard-list.tsx") as typeof SlaDashboardListModule;
  const { parseSlaNavigation, serializeSlaNavigation } = await vite.ssrLoadModule("/src/lib/sla-navigation.ts") as typeof SlaNavigationModule;
  const { slaStatusPage } = await vite.ssrLoadModule("/src/pages/sla.tsx") as typeof SlaPageModule;

  assert.equal(clampInlineSlaPanelWidth(-1), INLINE_SLA_PANEL_MIN_WIDTH);
  assert.equal(clampInlineSlaPanelWidth(Number.MAX_SAFE_INTEGER), INLINE_SLA_PANEL_MAX_WIDTH);
  assert.equal(resizeInlineSlaPanel(INLINE_SLA_PANEL_DEFAULT_WIDTH, -40), INLINE_SLA_PANEL_DEFAULT_WIDTH + 40);
  assert.equal(resizeInlineSlaPanel(INLINE_SLA_PANEL_DEFAULT_WIDTH, 40), INLINE_SLA_PANEL_DEFAULT_WIDTH - 40);

  // --- Focus containment ------------------------------------------------------
  // The trap decides from the panel's own focusable elements. Tab on the last
  // one wraps to the first, Shift+Tab on the first wraps to the last, and a Tab
  // that stays between them returns null so the browser moves focus normally.
  const first = { name: "back", focus: () => undefined };
  const middle = { name: "body", focus: () => undefined };
  const last = { name: "handle", focus: () => undefined };
  const inside = [first, middle, last];
  assert.equal(containFocus(inside, last, false), first, "Tab on the last focusable must wrap to the first");
  assert.equal(containFocus(inside, first, true), last, "Shift+Tab on the first focusable must wrap to the last");
  assert.equal(containFocus(inside, middle, false), null, "Tab in the middle must not be intercepted");
  assert.equal(containFocus(inside, middle, true), null, "Shift+Tab in the middle must not be intercepted");
  // Focus that starts outside the panel (or was never placed) is pulled to the
  // edge the key is heading towards, so the modal never leaks focus behind it.
  assert.equal(containFocus(inside, null, false), first, "Tab from outside the panel must land on the first focusable");
  assert.equal(containFocus(inside, null, true), last, "Shift+Tab from outside the panel must land on the last focusable");
  assert.equal(containFocus(inside, { name: "behind", focus: () => undefined }, false), first, "a focus target behind the panel counts as outside");
  assert.equal(containFocus([], null, false), null, "an empty panel has nothing to trap");

  let closeCount = 0;
  const close = createSingleFire(() => { closeCount += 1; });
  close();
  close();
  assert.equal(closeCount, 1, "one collapse must notify the parent exactly once");

  const panel = renderToStaticMarkup(createElement(
    InlineSlaPanel,
    { onClose: () => undefined },
    createElement("div", null, "SLA facts"),
  ));
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /aria-modal="true"/);
  assert.match(panel, /role="separator"/);
  assert.match(panel, /aria-label="Resize SLA panel"/);
  assert.match(panel, /Back to Ticket/);
  assert.match(panel, new RegExp(`width:${INLINE_SLA_PANEL_DEFAULT_WIDTH}px`));
  // The trap needs at least two focusable stops to cycle between: the resize
  // handle and the Back button both have to be reachable from the markup.
  assert.match(panel, /role="separator"[^>]*tabindex="0"/, "the resize handle must be a focus stop");
  assert.match(panel, /<button[^>]*>/, "the Back to Ticket control must be a focus stop");

  const trigger = renderToStaticMarkup(createElement(SlaBadge, {
    status: "warning",
    onClick: () => undefined,
    expanded: false,
    controls: "sla-detail-inline-panel",
  }));
  assert.match(trigger, /^<button/);
  assert.match(trigger, /aria-expanded="false"/);
  assert.match(trigger, /aria-controls="sla-detail-inline-panel"/);
  assert.match(trigger, /aria-haspopup="dialog"/);

  assert.deepEqual(slaStatusPage(7, 0), { index: 0, pageCount: 2, start: 0 });
  assert.deepEqual(slaStatusPage(7, 1), { index: 1, pageCount: 2, start: 5 });
  assert.deepEqual(slaStatusPage(7, 99), { index: 1, pageCount: 2, start: 5 }, "an out-of-range severity page must clamp to the last page");

  // --- Dashboard query survives row navigation --------------------------------
  const dashboardState = {
    group: "support",
    priority: "high" as const,
    period: "quarter" as const,
    page: 2,
    severityPage: 1,
    showAllBreaches: true,
  };
  const query = serializeSlaNavigation(dashboardState);
  assert.equal(query.toString(), "group=support&priority=high&period=quarter&page=2&severityPage=1&breaches=all");
  assert.deepEqual(parseSlaNavigation(query), dashboardState, "dashboard query parameters must survive detail navigation and browser Back");

  // The dashboard renders its rows in a router whose current URL carries those
  // filters; opening the row has to keep them. The row's click and Enter paths
  // both navigate through slaTicketDetailHref, so the URL it builds is the
  // observable target of the interaction.
  const search = `?${query.toString()}`;
  const ticket = {
    id: "tkt-000042",
    number: "42",
    title: "Payment gateway timeout",
    state: "open",
    live_sla_status: "warning",
    sla_remaining_ms: 90 * 60 * 1000,
    owner_id: "a1",
    owner_name: "Adi Nugroho",
    group_name: "Support",
    priority: "high",
    sla_progress: 60,
    actionable_deadline: null,
  } as unknown as SlaMonitorTicket;
  const target = slaTicketDetailHref(ticket.id, search);
  assert.equal(target, `/sla/detail/${ticket.id}${search}`, "opening a ticket must carry the dashboard search string");
  assert.match(target, /group=support/);
  assert.match(target, /priority=high/);
  assert.match(target, /period=quarter/);
  assert.match(target, /page=2/);
  assert.match(target, /severityPage=1/);
  assert.match(target, /breaches=all/);
  assert.equal(slaTicketDetailHref(ticket.id, ""), `/sla/detail/${ticket.id}`, "a filterless dashboard still opens the plain detail route");

  const originalError = console.error;
  console.error = () => undefined;
  const list = renderToStaticMarkup(createElement(
    MemoryRouter,
    { initialEntries: [`/sla${search}`] },
    createElement(SlaDashboardList, { tickets: [ticket], scope: null }),
  ));
  console.error = originalError;
  assert.match(list, /#42/, "the row must render the ticket the manager clicked");
  assert.match(list, /role="link"/, "the row must stay an activatable link target");
  assert.match(list, /tabindex="0"/, "the row must be reachable by keyboard");

  const staticBadge = renderToStaticMarkup(createElement(SlaBadge, { status: "safe" }));
  assert.doesNotMatch(staticBadge, /^<button/, "non-interactive badges must remain presentation-only");
} finally {
  await vite.close();
}

console.log("SLA detail navigation OK");
