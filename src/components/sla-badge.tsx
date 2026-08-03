import { Badge } from "@/components/ui/badge";
import { cn, formatSeconds } from "@/lib/utils";
import type { SlaStatus } from "@/types";

interface Props {
  status: SlaStatus;
  remainingSecs?: number | null;
  compact?: boolean;
  className?: string;
}

const MAP: Record<SlaStatus, { variant: "success" | "warning" | "destructive" | "secondary"; label: string; dot: string }> = {
  safe: { variant: "success", label: "On Track", dot: "bg-emerald-500" },
  warning: { variant: "warning", label: "At Risk", dot: "bg-amber-500" },
  critical: { variant: "destructive", label: "Critical", dot: "bg-orange-500" },
  breached: { variant: "destructive", label: "Breached", dot: "bg-red-600" },
};

export function SlaBadge({ status, remainingSecs, compact, className }: Props) {
  const meta = MAP[status];
  const timeText =
    remainingSecs == null
      ? null
      : remainingSecs < 0
      ? `+${formatSeconds(Math.abs(remainingSecs))}`
      : formatSeconds(remainingSecs);
  return (
    <Badge variant={meta.variant} className={cn("gap-1.5", className)}>
      <span className={cn("inline-block size-1.5 rounded-full", meta.dot)} />
      {compact ? timeText ?? meta.label : `${meta.label}${timeText ? ` · ${timeText}` : ""}`}
    </Badge>
  );
}
