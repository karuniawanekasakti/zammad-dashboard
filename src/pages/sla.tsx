import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Flame } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { useScope } from "@/stores/auth";
import { PageHeader } from "@/components/page-header";
import { PageLoader } from "@/components/spinner";
import { KpiCard } from "@/components/kpi-card";
import { ChartCard } from "@/components/chart-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PriorityBadge } from "@/components/status-badges";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn, formatNumber, formatPercent } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SlaMonitorData, SlaMonitorRow, SlaMonitorTicket, SlaStatus, Ticket } from "@/types";

type TabValue = "all" | "on_track" | "warning" | "critical" | "breached";

const FALLBACK_ZAMMAD_BASE = (import.meta.env.VITE_ZAMMAD_BASE_URL ?? "").replace(/\/$/, "");

const STATUS_META: Record<SlaStatus, { label: string; bar: string; text: string; icon: string }> = {
  safe: { label: "On track", bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", icon: "bg-emerald-500" },
  on_track: { label: "On track", bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", icon: "bg-emerald-500" },
  warning: { label: "Warning", bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", icon: "bg-amber-500" },
  critical: { label: "Critical", bar: "bg-orange-500", text: "text-orange-600 dark:text-orange-400", icon: "bg-orange-500" },
  breached: { label: "Breached", bar: "bg-red-600", text: "text-red-600 dark:text-red-400", icon: "bg-red-600" },
  no_sla: { label: "No SLA", bar: "bg-muted-foreground", text: "text-muted-foreground", icon: "bg-muted-foreground" },
  closed_on_time: { label: "Closed on time", bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", icon: "bg-emerald-500" },
};

const CHART_COLORS = {
  safe: "hsl(142 71% 45%)",
  warning: "hsl(38 92% 50%)",
  breached: "hsl(0 72% 51%)",
  empty: "hsl(var(--muted))",
};

export default function SlaPage() {
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [statusTab, setStatusTab] = useState<TabValue>("all");
  const [showAllBreaches, setShowAllBreaches] = useState(false);

  const scope = useScope();
  const config = useQuery({ queryKey: ["system", "public-config"], queryFn: () => api.getPublicConfig() });
  const groups = useQuery({ queryKey: ["groups", "filter"], queryFn: () => api.listAllGroupsForFilter() });
  const monitor = useQuery({ queryKey: ["sla", "monitor", scope, groupFilter], queryFn: () => api.listSlaMonitor(scope, groupFilter) });

  const data = monitor.data;
  const tableRows = useMemo(() => {
    const rows = data?.tickets ?? [];
    return statusTab === "all" ? rows : rows.filter((t) => t.live_sla_status === statusTab);
  }, [data?.tickets, statusTab]);
  const zammadBase = (config.data?.zammad_base_url ?? FALLBACK_ZAMMAD_BASE).replace(/\/$/, "");

  if (monitor.isLoading) return <PageLoader />;
  if (monitor.isError || !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="SLA Monitor" description="Real-time SLA compliance and breach monitoring." />
        <Card>
          <CardContent className="space-y-2 py-10 text-center">
            <div className="font-medium text-destructive">Failed to load SLA monitor data.</div>
            <div className="text-sm text-muted-foreground">Request gagal: GET /tickets/sla-monitor</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="SLA Monitor" description="SLA compliance dihitung dari semua tiket tersinkron dalam scope/group." />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <span className="text-sm font-medium">Group</span>
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="All groups" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All groups</SelectItem>
              {(groups.data ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {groups.isError && <span className="text-sm text-amber-600 dark:text-amber-400">Daftar group gagal dimuat.</span>}
        </CardContent>
      </Card>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Compliance Rate" value={formatPercent(data.summary.compliance_rate, 0)} helper={`${formatNumber(data.summary.on_track)} of ${formatNumber(data.summary.total_with_sla)} tiket met SLA`} icon={CheckCircle2} iconClassName={complianceIcon(data.summary.compliance_rate)} />
        <KpiCard title="On Track" value={formatNumber(data.summary.on_track)} helper="within SLA deadline" icon={CheckCircle2} iconClassName="bg-emerald-500/15 text-emerald-600" />
        <KpiCard title="At-Risk" value={formatNumber(data.summary.at_risk)} helper="deadline < 30 menit" icon={AlertTriangle} iconClassName="bg-amber-500/15 text-amber-600" />
        <KpiCard title="Breached" value={formatNumber(data.summary.breached)} helper="SLA deadline passed" icon={Flame} iconClassName="bg-red-500/15 text-red-600" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SLA Status per Prioritas</CardTitle>
            <CardDescription>Compliance rate tiket aktif berdasarkan prioritas.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.priority_rows.map((row) => <ComplianceRow key={row.name} row={row} />)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SLA Status per Group</CardTitle>
            <CardDescription>Compliance rate tiket aktif berdasarkan group terpilih.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.sla_rows.some((row) => row.total > 0) ? data.sla_rows.filter((row) => row.total > 0).slice(0, 4).map((row) => <ComplianceRow key={row.name} row={row} />) : <div className="py-8 text-center text-sm text-muted-foreground">Tidak ada tiket ber-SLA.</div>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="text-base">Tiket Mendekati Breach</CardTitle>
            <CardDescription>Breached di atas, lalu deadline terdekat.</CardDescription>
          </div>
          <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as TabValue)}>
            <TabsList>
              <TabsTrigger value="all">Semua</TabsTrigger>
              <TabsTrigger value="on_track">On Track</TabsTrigger>
              <TabsTrigger value="warning">Warning</TabsTrigger>
              <TabsTrigger value="critical">Critical</TabsTrigger>
              <TabsTrigger value="breached">Breached</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableRows.length === 0 && <EmptyRow colSpan={7} text={emptyText(statusTab)} />}
                {tableRows.map((t) => <RiskRow key={t.id} ticket={t} />)}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <ChartCard title="Tren Compliance" description="Compliance rate harian tiket closed dalam 7 hari terakhir.">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.trend} margin={{ left: -12, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="day" tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip content={<TrendTooltip />} />
            <ReferenceLine y={90} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" label={{ value: "Target 90%", fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
              {data.trend.map((d) => <Cell key={d.date} fill={d.total === 0 ? CHART_COLORS.empty : d.rate >= 90 ? CHART_COLORS.safe : d.rate >= 75 ? CHART_COLORS.warning : CHART_COLORS.breached} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Breach heatmap</CardTitle>
          <CardDescription>Breached tickets by escalation/update hour — day × hour (darker = more tickets)</CardDescription>
        </CardHeader>
        <CardContent><Heatmap grid={data.heatmap.grid} max={data.heatmap.max} /></CardContent>
      </Card>

      <Card>
        <CardHeader className="sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="text-base">Breach Log</CardTitle>
            <CardDescription>Riwayat tiket closed yang melewati solution SLA.</CardDescription>
          </div>
          {data.breach_log.length > 20 && <Button variant="outline" size="sm" onClick={() => setShowAllBreaches((v) => !v)}>{showAllBreaches ? "Tampilkan 20" : "Lihat semua"}</Button>}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Waktu Breach</TableHead>
                  <TableHead>Diselesaikan pada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.breach_log.length === 0 && <EmptyRow colSpan={7} text="Belum ada breach log." />}
                {data.breach_log.slice(0, showAllBreaches ? data.breach_log.length : 20).map((t) => <BreachLogRow key={t.id} ticket={t} zammadBase={zammadBase} />)}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ComplianceRow({ row }: { row: SlaMonitorRow }) {
  const rate = row.compliance_rate;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium capitalize">{row.name}</span>
        <span className="text-muted-foreground">{rate == null ? "-" : formatPercent(rate, 0)} · {formatNumber(row.total)} tiket</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <div className={cn("h-full rounded-full", rate == null ? "bg-muted-foreground" : rate >= 90 ? "bg-emerald-500" : rate >= 80 ? "bg-amber-500" : "bg-red-600")} style={{ width: `${rate == null ? 0 : Math.min(100, rate)}%` }} />
      </div>
    </div>
  );
}

function RiskRow({ ticket }: { ticket: SlaMonitorTicket }) {
  const meta = STATUS_META[ticket.live_sla_status];
  return (
    <TableRow>
      <TableCell className="font-mono text-xs"><Link className="hover:underline" to={`/tickets/${ticket.id}`}>#{ticket.number}</Link></TableCell>
      <TableCell className="max-w-sm truncate">{ticket.title}</TableCell>
      <TableCell><PriorityBadge priority={ticket.priority} /></TableCell>
      <TableCell className="text-sm">{ticket.group_name}</TableCell>
      <TableCell className="text-sm">{ticket.owner_name ?? "-"}</TableCell>
      <TableCell className="text-sm">{formatDate(ticket.escalation_at ?? ticket.first_response_escalation_at ?? ticket.close_escalation_at)}</TableCell>
      <TableCell className="min-w-[170px]">
        <div className={cn("mb-1 flex items-center gap-2 text-sm font-medium", meta.text)}>
          <span className={cn("size-2 rounded-full", meta.icon)} />
          <span>{meta.label}</span>
          <span className="text-muted-foreground">· {formatSlaDelta(ticket.sla_remaining_ms)}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className={cn("h-full rounded-full", meta.bar)} style={{ width: `${ticket.sla_progress}%` }} /></div>
      </TableCell>
    </TableRow>
  );
}

function BreachLogRow({ ticket, zammadBase }: { ticket: Ticket; zammadBase: string }) {
  const title = zammadBase ? <a className="hover:underline" href={`${zammadBase}/#ticket/zoom/${ticket.zammad_id}`} target="_blank" rel="noreferrer">{ticket.title}</a> : <Link className="hover:underline" to={`/tickets/${ticket.id}`}>{ticket.title}</Link>;
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">#{ticket.number}</TableCell>
      <TableCell className="max-w-sm truncate">{title}</TableCell>
      <TableCell><PriorityBadge priority={ticket.priority} /></TableCell>
      <TableCell className="text-sm">{ticket.group_name}</TableCell>
      <TableCell className="text-sm">{ticket.owner_name ?? "-"}</TableCell>
      <TableCell className="text-sm font-medium text-red-600 dark:text-red-400">lewat {formatMinutes(Math.abs(ticket.close_diff_in_min ?? 0))}</TableCell>
      <TableCell className="text-sm">{formatDate(ticket.close_at ?? ticket.closed_at)}</TableCell>
    </TableRow>
  );
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return <TableRow><TableCell colSpan={colSpan} className="py-10 text-center text-muted-foreground">{text}</TableCell></TableRow>;
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: SlaMonitorData["trend"][number] }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover p-3 text-xs shadow-sm">
      <div className="font-medium">{d.date}</div>
      <div>Compliance: {d.total ? formatPercent(d.rate, 0) : "tidak ada tiket"}</div>
      <div>Breach: {formatNumber(d.breach)}</div>
    </div>
  );
}

function Heatmap({ grid, max }: { grid: number[][]; max: number }) {
  const days = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
  return (
    <div className="overflow-x-auto">
      <table className="text-[10px] border-separate border-spacing-0.5">
        <thead>
          <tr>
            <th className="w-10" />
            {Array.from({ length: 24 }, (_, h) => <th key={h} className="w-5 text-center font-normal text-muted-foreground">{h % 3 === 0 ? h : ""}</th>)}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, d) => (
            <tr key={d}>
              <td className="pr-2 text-right text-muted-foreground">{days[d]}</td>
              {row.map((v, h) => {
                const intensity = v / max;
                return <td key={h} className={cn("h-5 w-5 rounded-sm", v === 0 ? "bg-muted" : "")} style={v > 0 ? { backgroundColor: `hsl(0 72% ${72 - intensity * 36}%)` } : undefined} title={`${days[d]} ${h}:00 — ${v} tickets`} />;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function emptyText(tab: TabValue) {
  return tab === "all" ? "Tidak ada tiket dalam scope ini." : `Tidak ada tiket ${tab.replace("_", " ")} dalam scope ini.`;
}

function formatSlaDelta(ms: number | null) {
  if (ms == null) return "-";
  return ms < 0 ? `+${formatMinutes(Math.ceil(Math.abs(ms) / 60000))} lewat` : `${formatMinutes(Math.floor(ms / 60000))} tersisa`;
}

function formatMinutes(minutes: number | null) {
  if (minutes == null) return "-";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours ? `${hours}j ${mins}m` : `${mins}m`;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

function complianceIcon(rate: number) {
  return rate >= 90 ? "bg-emerald-500/15 text-emerald-600" : rate >= 75 ? "bg-amber-500/15 text-amber-600" : "bg-red-500/15 text-red-600";
}
