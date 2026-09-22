import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import type * as InlinePanelModule from "./src/components/sla/inline-sla-panel.tsx";
import type * as SlaBadgeModule from "./src/components/sla-badge.tsx";
import type * as SlaNavigationModule from "./src/lib/sla-navigation.ts";
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const {
    INLINE_SLA_PANEL_DEFAULT_WIDTH,
    INLINE_SLA_PANEL_MAX_WIDTH,
    INLINE_SLA_PANEL_MIN_WIDTH,
    InlineSlaPanel,
    clampInlineSlaPanelWidth,
    createSingleFire,
    resizeInlineSlaPanel,
  } = await vite.ssrLoadModule("/src/components/sla/inline-sla-panel.tsx") as typeof InlinePanelModule;
  const { SlaBadge } = await vite.ssrLoadModule("/src/components/sla-badge.tsx") as typeof SlaBadgeModule;
  const { parseSlaNavigation, serializeSlaNavigation } = await vite.ssrLoadModule("/src/lib/sla-navigation.ts") as typeof SlaNavigationModule;

  assert.equal(clampInlineSlaPanelWidth(-1), INLINE_SLA_PANEL_MIN_WIDTH);
  assert.equal(clampInlineSlaPanelWidth(Number.MAX_SAFE_INTEGER), INLINE_SLA_PANEL_MAX_WIDTH);
  assert.equal(resizeInlineSlaPanel(INLINE_SLA_PANEL_DEFAULT_WIDTH, -40), INLINE_SLA_PANEL_DEFAULT_WIDTH + 40);
  assert.equal(resizeInlineSlaPanel(INLINE_SLA_PANEL_DEFAULT_WIDTH, 40), INLINE_SLA_PANEL_DEFAULT_WIDTH - 40);

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


  const dashboardState = {
    group: "support",
    priority: "high" as const,
    period: "quarter" as const,
    page: 2,
    showAllBreaches: true,
  };
  const query = serializeSlaNavigation(dashboardState);
  assert.equal(query.toString(), "group=support&priority=high&period=quarter&page=2&breaches=all");
  assert.deepEqual(parseSlaNavigation(query), dashboardState, "dashboard query parameters must survive detail navigation and browser Back");
  const staticBadge = renderToStaticMarkup(createElement(SlaBadge, { status: "safe" }));
  assert.doesNotMatch(staticBadge, /^<button/, "non-interactive badges must remain presentation-only");
} finally {
  await vite.close();
}

console.log("SLA detail navigation OK");
