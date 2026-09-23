import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import type { TicketArticle } from "./src/types/index.ts";

const article = (id: string): TicketArticle => ({
  id,
  ticket_id: "1",
  type: "email",
  author_name: `Author ${id}`,
  author_role: "agent",
  internal: false,
  body: `Article ${id}`,
  created_at: new Date(Date.UTC(2026, 8, 21, 0, Number(id) % 60)).toISOString(),
});

const articles = Array.from({ length: 85 }, (_, index) => article(String(index + 1)));

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { appendArticlePage, VirtualizedArticleList } =
    await vite.ssrLoadModule("/src/components/tickets/virtualized-article-list.tsx") as typeof import("./src/components/tickets/virtualized-article-list.tsx");
  const { ARTICLE_PAGE_SIZE } =
    await vite.ssrLoadModule("/src/lib/article-pagination.ts") as typeof import("./src/lib/article-pagination.ts");

  assert.equal(ARTICLE_PAGE_SIZE, 20);

  // Page-by-page loading of an 85-article ticket: exactly 20 + 20 + 20 + 20 + 5.
  let loaded: TicketArticle[] = [];
  const totals: number[] = [];
  for (let offset = 0; offset < articles.length; offset += ARTICLE_PAGE_SIZE) {
    loaded = appendArticlePage(loaded, articles.slice(offset, offset + ARTICLE_PAGE_SIZE));
    totals.push(loaded.length);
    assert.equal(new Set(loaded.map((row) => row.id)).size, loaded.length, "articles must never repeat");
  }
  assert.deepEqual(totals, [20, 40, 60, 80, 85]);

  // A repeated or overlapping page (a retried request) adds nothing.
  assert.equal(appendArticlePage(loaded, articles.slice(60, 85)).length, 85);
  assert.deepEqual(appendArticlePage(loaded, []), loaded);

  const markup = (articles: TicketArticle[], total: number) =>
    renderToStaticMarkup(createElement(VirtualizedArticleList, {
      articles,
      total,
      hasMore: articles.length < total,
      loadingMore: false,
      onLoadMore: () => undefined,
      renderArticle: (row: TicketArticle) => createElement("div", { "data-article-id": row.id }, row.body),
    }));

  const empty = markup([], 0);
  assert.match(empty, /No articles found for this ticket/);
  assert.doesNotMatch(empty, /Load More/);

  const first = markup(articles.slice(0, ARTICLE_PAGE_SIZE), articles.length);
  assert.equal(first.match(/data-article-id=/g)?.length, ARTICLE_PAGE_SIZE);
  assert.match(first, /Showing 20 of 85 articles/);
  assert.match(first, /Load More/);
  assert.doesNotMatch(first, /Article 21/);

  const last = markup(articles, articles.length);
  assert.doesNotMatch(last, /Load More/);

  // 101 articles crosses the windowing threshold: fewer rows render than exist,
  // and the spacers keep the scrollbar sized to the whole collection.
  const virtualized = markup(Array.from({ length: 101 }, (_, index) => article(String(index + 1))), 101);
  assert.match(virtualized, /data-virtualized="true"/);
  assert.ok((virtualized.match(/data-article-id=/g)?.length ?? 0) < 101, "windowing must render only a slice");
} finally {
  await vite.close();
}

console.log("Article pagination OK: 20 + 20 + 20 + 20 + 5, unique rows, empty state, and virtualized window");
