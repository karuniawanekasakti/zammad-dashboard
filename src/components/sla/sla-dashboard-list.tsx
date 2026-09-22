import { useState } from "react";
import { ChevronDown, ChevronRight, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SlaMonitorTicket, SlaStatus, Ticket } from "@/types";

// Worst-first, matching the dashboard contract exactly.
const URGENCY_RANK: Record<string, number> = {
  breached: 0,
  critical: 1,
  warning: 2,
  on_track: 3,
  safe: 4,
  no_sla: 5,
  closed_on_time: 6,
};

const STATUS_META: Record<SlaStatus, { label: string; text: string; dot: string }> = {
  breached: { label: "Breached", text: "text-red-600 dark:text-red-400", dot: "bg-red-600" },
  critical: { label: "Critical", text: "text-orange-600 dark:text-orange-400", dot: "bg-orange-500" },
  warning: { label: "Warning", text: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
  on_track: { label: "On Track", text: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
  safe: { label: "Safe", text: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
  no_sla: { label: "No SLA", text: "text-muted-foreground", dot: "bg-muted-foreground" },
  closed_on_time: { label: "Closed On Time", text: "text-muted-foreground", dot: "bg-muted" },
};

// Agent key for grouping: the owner when there is one, otherwise the shared
// unassigned bucket. Every ticket lands in exactly one section.
function agentKey(ticket: SlaMonitorTicket): string {
  return ticket.owner_id ?? "unassigned";
}

function agentLabel(ticket: SlaMonitorTicket): string {
  return ticket.owner_name ?? "Unassigned";
}

export function sortByUrgency(rows: SlaMonitorTicket[]): SlaMonitorTicket[] {
  return [...rows].sort((a, b) => {
    const rank = (URGENCY_RANK[a.live_sla_status] ?? URGENCY_RANK.no_sla) - (URGENCY_RANK[b.live_sla_status] ?? URGENCY_RANK.no_sla);
    if (rank) return rank;
    // Same urgency: whichever is closest to (or furthest past) its deadline is
    // the one a manager should look at first. Unknown deadlines sink.
    return (a.sla_remaining_ms ?? Infinity) - (b.sla_remaining_ms ?? Infinity);
  });
}

function formatRemaining(ms: number | null): string {
  if (ms == null) return "-";
  const minutes = Math.abs(Math.round(ms / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const span = hours ? `${hours}h ${rest}m` : `${rest}m`;
  return ms < 0 ? `${span} overdue` : `${span} left`;
}

// Collapse state is keyed by agent, and a section with no entry is the default
// open state; the first click writes an entry. Kept as a small reducer so the
// meaning of an absent key stays true at every call site.
function toggleSection(state: Record<string, true>, key: string, expanded: boolean): Record<string, true> {
  if (expanded) return { ...state, [key]: true };
  const next = { ...state };
  delete next[key];
  return next;
}

interface Props {
  tickets: SlaMonitorTicket[];
  scope: string | null;
  groupByAgent?: boolean;
  onGroupByAgentChange?: (grouped: boolean) => void;
}

export function SlaDashboardList({ tickets, scope, groupByAgent, onGroupByAgentChange }: Props) {
  const [localGrouping, setLocalGrouping] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, true>>({});
  const grouped = groupByAgent ?? localGrouping;

  const toggleGrouping = () => {
    const next = !grouped;
    setLocalGrouping(next);
    onGroupByAgentChange?.(next);
  };

  const ordered = sortByUrgency(tickets);
  const counts = {
    onTrack: tickets.filter((ticket) => ticket.live_sla_status === "on_track").length,
    atRisk: tickets.filter((ticket) => ticket.live_sla_status === "warning" || ticket.live_sla_status === "critical").length,
    breached: tickets.filter((ticket) => ticket.live_sla_status === "breached").length,
  };

  const sections = new Map<string, SlaMonitorTicket[]>();
  for (const ticket of ordered) {
    const key = agentKey(ticket);
    const bucket = sections.get(key);
    if (bucket) bucket.push(ticket);
    else sections.set(key, [ticket]);
  }
  // Sections inherit their worst ticket's place: the agent with a breach is
  // read before the agent whose tickets are all on track.
  const sectionList = [...sections.entries()].sort((a, b) => {
    const rank = (rows: SlaMonitorTicket[]) => Math.min(...rows.map((row) => URGENCY_RANK[row.live_sla_status] ?? URGENCY_RANK.no_sla));
    return rank(a[1]) - rank(b[1]) || agentLabel(a[1][0]).localeCompare(agentLabel(b[1][0]));
  });

  return (
    <section aria-label="SLA dashboard list" className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="On Track" value={counts.onTrack} className="text-emerald-600 dark:text-emerald-400" />
        <StatCard title="At-Risk" value={counts.atRisk} className="text-amber-600 dark:text-amber-400" />
        <StatCard title="Breached" value={counts.breached} className="text-red-600 dark:text-red-400" />
      </div>
      <p className="text-xs text-muted-foreground">Warning ≤ 2 jam · Critical ≤ 30 menit</p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          size="sm"
          variant={grouped ? "default" : "outline"}
          aria-pressed={grouped}
          className="gap-2"
          onClick={toggleGrouping}
        >
          <Users className="size-4" /> Group by Agent
        </Button>
        {scope && (
          <Select value={scope} onValueChange={() => undefined}>
            <SelectTrigger aria-label="Scope" className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={scope}>{scope}</SelectItem></SelectContent>
          </Select>
        )}
      </div>

      {!ordered.length && (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Tidak ada tiket dalam scope ini.</div>
      )}

      {ordered.length > 0 && !grouped && (
        <TicketTable rows={ordered} />
      )}

      {ordered.length > 0 && grouped && (
        <div className="space-y-3">
          {sectionList.map(([key, rows]) => {
            const expanded = collapsed[key] === undefined;
            return (
              <Card key={key} className="overflow-hidden">
                <button
                  type="button"
                  aria-expanded={expanded}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent/50"
                  onClick={() => setCollapsed((current) => toggleSection(current, key, expanded))}
                >
                  <span className="flex items-center gap-2 font-medium">
                    {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    {agentLabel(rows[0])}
                  </span>
                  <span className="text-sm text-muted-foreground">{rows.length} tiket</span>
                </button>
                {expanded && <TicketTable rows={rows} />}
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

function StatCard({ title, value, className }: { title: string; value: number; className?: string }) {
  return (
    <Card className="p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className={cn("text-2xl font-bold leading-tight", className)}>{value}</div>
    </Card>
  );
}

function TicketTable({ rows }: { rows: SlaMonitorTicket[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Ticket</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead>Group</TableHead>
          <TableHead>Remaining</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((ticket) => {
          const meta = STATUS_META[ticket.live_sla_status];
          return (
            <TableRow key={ticket.id}>
              <TableCell className="font-mono text-xs">
                <Link className="hover:underline" to={`/sla/detail/${ticket.id}`}>#{ticket.number}</Link>
                <span className="ml-2 font-sans text-sm">{ticket.title}</span>
              </TableCell>
              <TableCell>
                <span className={cn("inline-flex items-center gap-2 text-sm font-medium", meta.text)}>
                  <span className={cn("size-2 rounded-full", meta.dot)} />
                  {meta.label}
                </span>
              </TableCell>
              <TableCell className="text-sm">{ticket.owner_name ?? "-"}</TableCell>
              <TableCell className="text-sm">{ticket.group_name}</TableCell>
              <TableCell className="text-sm">{formatRemaining(ticket.sla_remaining_ms)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// A breach log row is a closed ticket, not a live countdown, so it renders the
// evidence of the miss rather than a remaining-time column.
export function SlaDashboardBreachRow({ ticket }: { ticket: Ticket }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">#{ticket.number}</TableCell>
      <TableCell>{ticket.title}</TableCell>
      <TableCell className="text-sm">{ticket.owner_name ?? "-"}</TableCell>
      <TableCell className="text-sm">{ticket.group_name}</TableCell>
    </TableRow>
  );
}
