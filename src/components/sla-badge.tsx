import { Badge, badgeVariants } from "@/components/ui/badge";
import { cn, formatSeconds } from "@/lib/utils";
import type { SlaStatus } from "@/types";

interface Props {
  status: SlaStatus;
  /** Remaining time in milliseconds, as the ticket payload carries it. */
  remainingMs?: number | null;
  compact?: boolean;
  className?: string;
  onClick?: () => void;
  expanded?: boolean;
  controls?: string;
}

const MAP: Record<SlaStatus, { variant: "success" | "warning" | "destructive" | "secondary"; label: string; dot: string }> = {
  safe: { variant: "success", label: "On Track", dot: "bg-emerald-500" },
  on_track: { variant: "success", label: "On Track", dot: "bg-emerald-500" },
  warning: { variant: "warning", label: "Warning", dot: "bg-amber-500" },
  critical: { variant: "destructive", label: "Critical", dot: "bg-orange-500" },
  breached: { variant: "destructive", label: "Breached", dot: "bg-red-600" },
  no_sla: { variant: "secondary", label: "Unmonitored", dot: "bg-muted-foreground" },
  closed_on_time: { variant: "success", label: "Closed on time", dot: "bg-emerald-500" },
};

export function SlaBadge({ status, remainingMs, compact, className, onClick, expanded, controls }: Props) {
  const meta = MAP[status] ?? { variant: "secondary" as const, label: String(status || "Unknown"), dot: "bg-muted-foreground" };
  const remainingSecs = remainingMs == null ? null : remainingMs / 1000;
  const timeText =
    remainingSecs == null
      ? null
      : remainingSecs < 0
      ? `+${formatSeconds(Math.abs(remainingSecs))}`
      : formatSeconds(remainingSecs);
  const content = (
    <>
      <span className={cn("inline-block size-1.5 rounded-full", meta.dot)} aria-hidden="true" />
      {compact ? timeText ?? meta.label : `${meta.label}${timeText ? ` · ${timeText}` : ""}`}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-expanded={expanded}
        aria-controls={controls}
        aria-haspopup="dialog"
        aria-label={`${meta.label} SLA — open detail`}
        className={cn(badgeVariants({ variant: meta.variant }), "gap-1.5 cursor-pointer", className)}
      >
        {content}
      </button>
    );
  }
  return <Badge variant={meta.variant} className={cn("gap-1.5", className)}>{content}</Badge>;
}
