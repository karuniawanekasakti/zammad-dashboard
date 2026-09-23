import type { ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/spinner";
import { cn } from "@/lib/utils";

interface Props {
  /**
   * What failed to load, phrased for a human (e.g. "agent list").
   * Rendered as "Failed to load {title}."
   */
  title?: string;
  /** Optional technical hint, e.g. the endpoint or the underlying error message. */
  detail?: string;
  /** Retry handler — when provided a retry button is rendered. */
  onRetry?: () => void;
  /**
   * `page` wraps the message in a Card for full-page/section failures.
   * `inline` renders a compact bordered block for secondary charts and lists.
   */
  variant?: "page" | "inline";
  className?: string;
}

/**
 * Explicit error state for a failed data query.
 *
 * Every query must have pending AND error behavior: silently falling back to an
 * empty array would render "no data" for what is actually a failure. Use this
 * before any no-data branch so a request error is never mistaken for an empty
 * result.
 */
export function DataError({ title, detail, onRetry, variant = "inline", className }: Props) {
  const message = (
    <div className={cn("space-y-1 text-center", variant === "page" && "py-10")}>
      <div className="flex items-center justify-center gap-2 font-medium text-destructive">
        <AlertTriangle className="size-4 shrink-0" />
        <span>{title ? `Failed to load ${title}.` : "Failed to load data."}</span>
      </div>
      {detail && <div className="text-sm text-muted-foreground">{detail}</div>}
      {onRetry && (
        <div className="pt-2">
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCw className="size-4" />
            Retry
          </Button>
        </div>
      )}
    </div>
  );

  if (variant === "page") {
    return (
      <Card className={className}>
        <CardContent className="pt-6">{message}</CardContent>
      </Card>
    );
  }

  return (
    <div className={cn("rounded-lg border border-dashed p-6 text-sm", className)}>{message}</div>
  );
}

interface QueryBodyProps {
  /** Query is still in flight — render the shared spinner. */
  isLoading: boolean;
  /** Query failed — render DataError instead of falling back to empty data. */
  isError: boolean;
  /** Query succeeded but returned no rows. */
  isEmpty?: boolean;
  /** Retry handler forwarded to DataError. */
  onRetry?: () => void;
  /** Human label for what failed, e.g. "first reply trend". */
  label?: string;
  /** Shown when the query succeeded but produced no rows. */
  emptyMessage?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Pending/error/empty gate for a secondary chart or list.
 *
 * Prevents a chart from silently rendering an empty array while its own query
 * is pending or has failed, which would misrepresent a load failure as
 * "no data".
 */
export function QueryBody({
  isLoading,
  isError,
  isEmpty,
  onRetry,
  label,
  emptyMessage = "No data available.",
  className,
  children,
}: QueryBodyProps) {
  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center py-10", className)}>
        <Spinner className="size-5" />
      </div>
    );
  }
  if (isError) {
    return <DataError title={label} onRetry={onRetry} className={className} />;
  }
  if (isEmpty) {
    return (
      <div className={cn("rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground", className)}>
        {emptyMessage}
      </div>
    );
  }
  return <>{children}</>;
}
