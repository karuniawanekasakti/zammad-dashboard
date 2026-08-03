import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Flame } from "lucide-react";
import { api } from "@/lib/api";
import { useScope } from "@/stores/auth";
import { PageHeader } from "@/components/page-header";
import { PageLoader } from "@/components/spinner";
import { KpiCard } from "@/components/kpi-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SlaBadge } from "@/components/sla-badge";
import { PriorityBadge } from "@/components/status-badges";
import { cn, formatNumber } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function SlaPage() {
  const scope = useScope();
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const groups = useQuery({ queryKey: ["groups-filter"], queryFn: () => api.listAllGroupsForFilter() });
  const atRisk = useQuery({ queryKey: ["at_risk", scope], queryFn: () => api.listAtRisk(scope) });

  const rows = useMemo(() => {
    const r = atRisk.data ?? [];
    return groupFilter === "all" ? r : r.filter((t) => t.group_id === groupFilter);
  }, [atRisk.data, groupFilter]);

  const counts = useMemo(() => {
    const r = atRisk.data ?? [];
    return {
      breached: r.filter((t) => t.sla_status === "breached").length,
      critical: r.filter((t) => t.sla_status === "critical").length,
      warning: r.filter((t) => t.sla_status === "warning").length,
    };
  }, [atRisk.data]);

  // Heatmap (day × hour) of breach concentration — derived from at-risk/breached ticket creation hours
  const heatmap = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    (atRisk.data ?? []).forEach((t) => {
      const d = new Date(t.zammad_created_at);
      const dow = (d.getDay() + 6) % 7; // Mon=0
      grid[dow][d.getHours()] += 1;
    });
    const max = Math.max(1, ...grid.flat());
    return { grid, max };
  }, [atRisk.data]);

  if (atRisk.isLoading) return <PageLoader />;

  return (
    <div className="space-y-4">
      <PageHeader title="SLA Monitor" description="Real-time SLA compliance and breach monitoring." />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Breached" value={formatNumber(counts.breached)} icon={Flame} iconClassName="bg-destructive/15 text-destructive" />
        <KpiCard title="Critical" value={formatNumber(counts.critical)} icon={AlertTriangle} iconClassName="bg-orange-500/15 text-orange-500" />
        <KpiCard title="Warning" value={formatNumber(counts.warning)} icon={AlertTriangle} iconClassName="bg-warning/15 text-warning" />
        <KpiCard title="On Track" value={formatNumber((atRisk.data?.length ?? 0) - counts.breached - counts.critical - counts.warning)} icon={CheckCircle2} iconClassName="bg-success/15 text-success" />
      </div>

      <Card>
        <CardHeader className="flex-row justify-between items-end">
          <div>
            <CardTitle className="text-base">At-Risk & Breached Tickets</CardTitle>
            <CardDescription>Sorted by nearest SLA deadline</CardDescription>
          </div>
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter by group" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All groups</SelectItem>
              {(groups.data ?? []).map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>SLA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                      No at-risk tickets in this scope.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">
                      <Link className="hover:underline" to={`/tickets/${t.id}`}>#{t.number}</Link>
                    </TableCell>
                    <TableCell className="max-w-sm truncate">{t.title}</TableCell>
                    <TableCell><PriorityBadge priority={t.priority} /></TableCell>
                    <TableCell className="text-sm">{t.group_name}</TableCell>
                    <TableCell className="text-sm">{t.owner_name ?? "Unassigned"}</TableCell>
                    <TableCell>
                      <SlaBadge status={t.sla_status} remainingSecs={t.first_response_remaining_secs} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Breach heatmap</CardTitle>
          <CardDescription>Breach concentration — day × hour (darker = more breaches)</CardDescription>
        </CardHeader>
        <CardContent>
          <Heatmap grid={heatmap.grid} max={heatmap.max} />
        </CardContent>
      </Card>
    </div>
  );
}

function Heatmap({ grid, max }: { grid: number[][]; max: number }) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <div className="overflow-x-auto">
      <table className="text-[10px] border-separate border-spacing-0.5">
        <thead>
          <tr>
            <th className="w-10" />
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} className="w-5 font-normal text-muted-foreground text-center">
                {h % 3 === 0 ? h : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, d) => (
            <tr key={d}>
              <td className="pr-2 text-muted-foreground text-right">{days[d]}</td>
              {row.map((v, h) => {
                const intensity = v / max;
                return (
                  <td
                    key={h}
                    className={cn("w-5 h-5 rounded-sm", v === 0 ? "bg-muted" : "")}
                    style={
                      v > 0
                        ? { backgroundColor: `hsl(0 84% ${70 - intensity * 35}%)` }
                        : undefined
                    }
                    title={`${days[d]} ${h}:00 — ${v} breaches`}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
