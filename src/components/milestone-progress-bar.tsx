import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, formatSeconds } from "@/lib/utils";
import { buildSlaSegments } from "@/lib/sla-progress";
import type { SlaActivity, SlaSegment } from "@/lib/sla-progress";
import type { SlaStatus, TicketHistory } from "@/types";
import { Clock, Pause, RefreshCw } from "lucide-react";
import type { CSSProperties } from "react";

interface MilestoneProgressProps {
  label: string;
  history: TicketHistory[];
  deadline?: Date | null;
  now: Date;
  status: SlaStatus;
  progressPct: number;
  ticketCreated: Date;
}

const STATUS_STYLES: Record<SlaStatus, { activeBar: string; text: string }> = {
  safe: { activeBar: "bg-emerald-500", text: "text-emerald-600" },
  on_track: { activeBar: "bg-blue-500", text: "text-blue-600" },
  warning: { activeBar: "bg-amber-500", text: "text-amber-600" },
  critical: { activeBar: "bg-red-500", text: "text-red-600" },
  breached: { activeBar: "bg-red-900", text: "text-red-900 dark:text-red-300" },
  no_sla: { activeBar: "bg-muted-foreground", text: "text-muted-foreground" },
  closed_on_time: { activeBar: "bg-emerald-500", text: "text-emerald-600" },
};

const PAUSE_STYLE: CSSProperties = {
  backgroundColor: "transparent",
  backgroundImage: "repeating-linear-gradient(45deg, transparent 0, transparent 3px, currentColor 3px, currentColor 4px)",
};

export function MilestoneProgressBar({ label, history, deadline, now, status, progressPct, ticketCreated }: MilestoneProgressProps) {
  const { segments, activities } = buildSlaSegments(history, ticketCreated, now);
  const scale = Math.max(0, Math.min(100, progressPct)) / 100;
  const hasPause = segments.some((segment) => segment.kind === "paused");
  let offset = 0;

  return (
    <div className="space-y-2" aria-label={`${label} SLA progress`}>
      <div className="flex items-center justify-between text-xs font-medium">
        <span className={cn("flex items-center gap-1.5", STATUS_STYLES[status].text)}>
          <Clock className="size-3.5" />
          {label}: {deadline ? `${Math.max(0, Math.round(progressPct))}%` : "Unmonitored"}
        </span>
        {hasPause && <span className="flex items-center gap-1 text-muted-foreground"><Pause className="size-3" /> Paused</span>}
      </div>

      <TooltipProvider>
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
          {segments.map((segment, index) => {
            const width = segment.percent * scale;
            const left = offset;
            offset += width;
            return (
              <MilestoneSegment
                key={`${segment.start}-${index}`}
                segment={segment}
                className={STATUS_STYLES[status].activeBar}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            );
          })}
        </div>
      </TooltipProvider>

      <ActivityLegend activities={activities} />
    </div>
  );
}

function MilestoneSegment({ segment, className, style }: { segment: SlaSegment; className: string; style: CSSProperties }) {
  const pausedLabel = segment.kind === "paused"
    ? `Paused for ${formatSeconds((segment.durationMs ?? 0) / 1000)} due to ${segment.reason}`
    : null;
  const marker = (
    <span
      className={cn("absolute inset-y-0", segment.kind === "active" ? className : "text-muted-foreground/60")}
      style={segment.kind === "paused" ? { ...style, ...PAUSE_STYLE } : style}
      aria-label={pausedLabel ?? "Active SLA time"}
      tabIndex={segment.kind === "paused" ? 0 : undefined}
    />
  );

  return segment.kind === "paused" ? (
    <Tooltip>
      <TooltipTrigger asChild>{marker}</TooltipTrigger>
      <TooltipContent><p>{pausedLabel}</p></TooltipContent>
    </Tooltip>
  ) : marker;
}

function ActivityLegend({ activities }: { activities: SlaActivity[] }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 text-[10px] text-muted-foreground" aria-label="SLA activity legend">
      {activities.map((activity, index) => (
        <span key={`${activity.kind}-${activity.at}-${index}`} className="flex flex-col items-center gap-0.5">
          <span className="flex items-center gap-1 capitalize">
            {activity.kind === "pause" && <Pause className="size-3" />}
            {activity.kind === "resume" && <RefreshCw className="size-3" />}
            {activity.kind === "start" && <span className="size-1.5 rounded-full bg-emerald-500" />}
            {activity.kind === "current" && <span className="size-1.5 rounded-full bg-primary" />}
            {activity.kind}
          </span>
          <time dateTime={activity.at}>{new Date(activity.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        </span>
      ))}
    </div>
  );
}
