// SSR harness: the theme provider and auth store touch browser storage on read.
(globalThis as Record<string, unknown>).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { Header } = await vite.ssrLoadModule("/src/components/layout/header.tsx");
  const { ThemeProvider } = await vite.ssrLoadModule("/src/components/theme-provider.tsx");
  const { useAuth } = await vite.ssrLoadModule("/src/stores/auth.ts");

  useAuth.setState({
    user: {
      id: "1",
      firstname: "Ada",
      lastname: "Lovelace",
      email: "ada@example.com",
      role: "admin",
      group_ids: [],
    } as never,
  });

  const render = (client: QueryClient) =>
    renderToString(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          MemoryRouter,
          null,
          createElement(ThemeProvider, null, createElement(Header, { onToggleSidebar: () => {} })),
        ),
      ),
    );

  const bell = (html: string) => {
    const at = html.indexOf('aria-label="Notifications"');
    const end = html.indexOf("</button>", at);
    return html.slice(at, end);
  };

  // --- Header: pending notifications ---
  const pendingBell = bell(render(new QueryClient()));
  assert.match(pendingBell, /aria-label="Loading notifications"/, "pending shows a local loading dot");
  assert.doesNotMatch(pendingBell, /bg-destructive/, "pending must not imply an unread count");

  // NOTE: an error state cannot be observed through SSR — React Query's SSR
  // snapshot renders "pending" for an errored cache entry, so the retry branch
  // is verified in the browser instead (it shares the same `resolved` guard
  // the two cases below pin down).

  // --- Header: resolved with unread ---
  const okClient = new QueryClient();
  okClient.setQueryData(["notifications"], [
    { id: "n1", status: "pending", rule_name: "r", ticket_id: null, ticket_number: null, channel: "in_app", message: "m", created_at: new Date().toISOString(), read_at: null },
  ]);
  const okBell = bell(render(okClient));
  assert.doesNotMatch(okBell, /aria-label="Loading notifications"/, "resolved drops the loading dot");
  assert.match(okBell, /min-w-4/, "resolved shows the unread badge");
  assert.match(okBell, />1</, "resolved badge shows 1 unread");

  console.log("header notification states OK");
} finally {
  await vite.close();
}
