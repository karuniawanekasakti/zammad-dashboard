import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Role, TicketPriority, TicketState } from "@/types";

const STATE_MAP: Record<TicketState, { label: string; className: string }> = {
  new: { label: "New", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30" },
  open: { label: "Open", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
  pending: { label: "Pending", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" },
  closed: { label: "Closed", className: "bg-muted text-muted-foreground" },
  merged: { label: "Merged", className: "bg-muted text-muted-foreground" },
};

export function StateBadge({ state, className }: { state: TicketState; className?: string }) {
  const m = STATE_MAP[state];
  return (
    <Badge variant="outline" className={cn("font-medium", m.className, className)}>
      {m.label}
    </Badge>
  );
}

const PRIORITY_MAP: Record<TicketPriority, { label: string; className: string }> = {
  low: { label: "Low", className: "bg-muted text-muted-foreground" },
  normal: { label: "Normal", className: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30" },
  high: { label: "High", className: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30" },
  "very high": {
    label: "Very High",
    className: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  },
};

export function PriorityBadge({ priority, className }: { priority: TicketPriority; className?: string }) {
  const m = PRIORITY_MAP[priority];
  return (
    <Badge variant="outline" className={cn("font-medium", m.className, className)}>
      {m.label}
    </Badge>
  );
}

const ROLE_MAP: Record<Role, { label: string; className: string }> = {
  admin: { label: "Admin", className: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/30" },
  team_lead: { label: "Team Lead", className: "bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/30" },
  project_manager: { label: "Project Manager", className: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/30" },
  agent: { label: "Agent", className: "bg-muted text-muted-foreground" },
};

export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  const m = ROLE_MAP[role];
  return (
    <Badge variant="outline" className={cn("font-medium", m.className, className)}>
      {m.label}
    </Badge>
  );
}
