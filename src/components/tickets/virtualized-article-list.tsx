import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TicketArticle } from "@/types";
import { VIRTUALIZE_ARTICLES_ABOVE } from "@/lib/article-pagination";

// An article history loads in fixed pages so a long conversation never renders
// (or fetches) more than the reader asked for; beyond the windowing threshold
// the list renders only the visible rows, keeping the DOM bounded.
const ROW_HEIGHT = 180;
const OVERSCAN = 3;

/** Appends a fetched page, dropping ids already loaded so overlapping or
 *  repeated pages can never duplicate a row. */
export function appendArticlePage(current: TicketArticle[], incoming: TicketArticle[]): TicketArticle[] {
  if (!incoming.length) return current;
  const seen = new Set(current.map((article) => article.id));
  const fresh = incoming.filter((article) => !seen.has(article.id));
  return fresh.length ? [...current, ...fresh] : current;
}


type Props = {
  articles: TicketArticle[];
  /** Total Zammad holds for this ticket, which is >= what has loaded. */
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  renderArticle: (article: TicketArticle) => ReactNode;
};

export function VirtualizedArticleList({ articles, total, hasMore, loadingMore, onLoadMore, renderArticle }: Props) {
  if (!total && !articles.length) {
    return <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">No articles found for this ticket</div>;
  }

  const virtualized = articles.length > VIRTUALIZE_ARTICLES_ABOVE;

  return (
    <div className="space-y-4">
      {virtualized ? (
        <VirtualizedRows articles={articles} renderArticle={renderArticle} />
      ) : (
        articles.map((article) => <div key={article.id}>{renderArticle(article)}</div>)
      )}
      <div className="flex items-center justify-between gap-2 border-t pt-4 text-xs text-muted-foreground">
        <span>
          Showing {articles.length} of {total} articles
        </span>
        {hasMore && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1 rounded-full px-3 text-xs"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            <ChevronDown className="size-3.5" />
            {loadingMore ? "Loading…" : "Load More"}
          </Button>
        )}
      </div>
    </div>
  );
}

// Windowing over row offsets: the rendered slice is translated to its offset
// and the outer height keeps the scrollbar sized to the whole history, so the
// DOM holds only the visible rows no matter how far the reader has paged.
// ponytail: offsets start from an estimated row height and refine as rows are
// measured; swap in a measuring virtualizer if scroll jumps on very long tickets
// becomes a real complaint.
function VirtualizedRows({ articles, renderArticle }: { articles: TicketArticle[]; renderArticle: (article: TicketArticle) => ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measured = useRef(new Map<string, number>());
  const [measuredTick, setMeasuredTick] = useState(0);
  const [range, setRange] = useState(() => visibleRange(0, 0, [0]));

  const offsets = useMemo(() => rowOffsets(articles, measured.current), [articles, measuredTick]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const update = () => setRange(visibleRange(container.scrollTop, container.clientHeight, offsets));
    update();
    container.addEventListener("scroll", update, { passive: true });
    return () => container.removeEventListener("scroll", update);
  }, [articles.length, offsets]);
  const { start, end } = range;
  const totalHeight = offsets[offsets.length - 1] ?? 0;
  const startOffset = offsets[start] ?? 0;

  return (
    <div
      ref={containerRef}
      data-virtualized="true"
      className="relative max-h-[calc(100vh-14rem)] overflow-y-auto overscroll-contain"
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <div style={{ transform: `translateY(${startOffset}px)` }}>
          {articles.slice(start, end).map((article) => (
            <div
              key={article.id}
              ref={(node) => {
                if (!node) return;
                const height = node.getBoundingClientRect().height;
                if (Math.abs((measured.current.get(article.id) ?? 0) - height) > 1) {
                  measured.current.set(article.id, height);
                  setMeasuredTick((tick) => tick + 1);
                }
              }}
            >
              {renderArticle(article)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function visibleRange(scrollTop: number, viewport: number, offsets: number[]) {
  const firstBelow = offsets.findIndex((offset) => offset > scrollTop);
  const firstVisible = Math.max(0, (firstBelow < 0 ? offsets.length : firstBelow) - 1);
  const lastBelow = offsets.findIndex((offset) => offset > scrollTop + (viewport || 600));
  const lastVisible = lastBelow < 0 ? offsets.length - 1 : lastBelow;
  return {
    start: Math.max(0, firstVisible - OVERSCAN),
    end: Math.min(offsets.length - 1, lastVisible + OVERSCAN),
  };
}

function rowOffsets(articles: TicketArticle[], measured: Map<string, number>): number[] {
  const offsets = [0];
  for (let index = 0; index < articles.length; index++) {
    offsets.push(offsets[index] + (measured.get(articles[index].id) ?? ROW_HEIGHT));
  }
  return offsets;
}

