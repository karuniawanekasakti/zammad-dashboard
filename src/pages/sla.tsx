import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { slaVerdictsAvailable } from "@/lib/sla-deadline";
import { parseSlaNavigation, serializeSlaNavigation, type SlaNavigationState } from "@/lib/sla-navigation";
import { useScope } from "@/stores/auth";
import { PageHeader } from "@/components/page-header";
import { PageLoader } from "@/components/spinner";
import { ChartCard } from "@/components/chart-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SeverityBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { cn, formatNumber, formatPercent } from "@/lib/utils";
import { SEVERITY_OPTIONS } from "@/lib/ticket-fields";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SlaMonitorData, SlaMonitorRow, Ticket } from "@/types";
import { ManagerMetricsSummary } from "@/components/sla/manager-metrics-summary";
import { SlaDashboardList } from "@/components/sla/sla-dashboard-list";


const SLA_STATUS_PAGE_SIZE = 5;

export function slaStatusPage(rowCount: number, pageIndex: number) {
  const pageCount = Math.max(1, Math.ceil(rowCount / SLA_STATUS_PAGE_SIZE));
  const index = Math.min(Math.max(pageIndex, 0), pageCount - 1);
  return { index, pageCount, start: index * SLA_STATUS_PAGE_SIZE };
}

const FALLBACK_ZAMMAD_BASE = (import.meta.env.VITE_ZAMMAD_BASE_URL ?? "").replace(/\/$/, "");

const FRESHNESS_LABELS = {
  never_synced: "Never Synced",
  up_to_date: "Up to Date",
  out_of_date: "Out of Date",
} as const;



const CHART_COLORS = {
  safe: "hsl(142 71% 45%)",
  warning: "hsl(38 92% 50%)",
  breached: "hsl(0 72% 51%)",
  empty: "hsl(var(--muted))",
};

export default function SlaPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = parseSlaNavigation(searchParams);
  const setNavigation = (change: Partial<SlaNavigationState>) => {
    setSearchParams(serializeSlaNavigation({ ...navigation, ...change }), { replace: true });
  };

  const scope = useScope();
  const config = useQuery({ queryKey: ["system", "public-config"], queryFn: () => api.getPublicConfig() });
  const groups = useQuery({ queryKey: ["groups", "filter", scope], queryFn: () => api.listAllGroupsForFilter() });
  const monitor = useQuery({ queryKey: ["sla", "monitor", scope, navigation.group], queryFn: () => api.listSlaMonitor(scope, navigation.group), refetchInterval: 60_000 });

  const data = monitor.data;
  const tableRows = data?.tickets ?? [];
  const zammadBase = (config.data?.zammad_base_url ?? FALLBACK_ZAMMAD_BASE).replace(/\/$/, "");
  const severityRows = severityMonitorRows(tableRows);
  const { index: severityPageIndex, pageCount: severityPageCount, start: severityPageStart } = slaStatusPage(severityRows.length, navigation.severityPage);
  const pagedSeverityRows = severityRows.slice(severityPageStart, severityPageStart + SLA_STATUS_PAGE_SIZE);
  const sortedGroupRows = [...(data?.sla_rows ?? [])].sort((a, b) => b.total - a.total);
  const { index: groupPageIndex, pageCount: groupPageCount, start: groupPageStart } = slaStatusPage(sortedGroupRows.length, navigation.page);
  const groupRows = sortedGroupRows.slice(groupPageStart, groupPageStart + SLA_STATUS_PAGE_SIZE);
  // A live verdict is only as trustworthy as the row it describes. When the
  // dataset is not Up to Date the page must not present stale figures as
  // current — "no breaches" and "no data" are different answers. A response with
  // no freshness field at all (an older backend) is treated as not up to date.
  const freshness = data?.freshness ?? null;
  const verdictsAvailable = slaVerdictsAvailable(freshness);
  const freshnessLabel = FRESHNESS_LABELS[freshness?.status ?? "never_synced"];

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

      {!verdictsAvailable && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 py-4 text-sm">
            <Badge variant={freshness?.status === "out_of_date" ? "warning" : "secondary"}>Data freshness: {freshnessLabel}</Badge>
            <span className="font-medium">SLA verdicts are unavailable — the synchronized dataset is not up to date.</span>
            <span className="text-muted-foreground">
              {config.isError
                ? "The Zammad base URL lookup also failed, so external links are unavailable. This page shows last-known data."
                : freshness?.last_success_at
                  ? `Last successful sync ${formatDistanceToNow(new Date(freshness.last_success_at), { addSuffix: true })}. The figures below describe that older dataset, not the present moment.`
                  : "No successful synchronization checkpoint is available, so there is no data to judge."}
            </span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <span className="text-sm font-medium">Group</span>
          <Select value={navigation.group} onValueChange={(value) => setNavigation({ group: value, page: 0 })}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="All groups" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All groups</SelectItem>
              {(groups.data ?? []).map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {verdictsAvailable && (
        <ManagerMetricsSummary
          monitor={data}
          scope={scope.role}
          period={navigation.period}
          onPeriodChange={(period) => setNavigation({ period })}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SLA Status per Severity</CardTitle>
            <CardDescription>Compliance rate tiket aktif berdasarkan severity.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {pagedSeverityRows.map((row) => <ComplianceRow key={row.id} row={row} verdictsAvailable={verdictsAvailable} />)}
            {severityPageCount > 1 && (
              <div className="flex items-center justify-between border-t pt-4 text-sm text-muted-foreground">
                <span>Page {severityPageIndex + 1} of {severityPageCount}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setNavigation({ severityPage: severityPageIndex - 1 })} disabled={severityPageIndex === 0}>Previous</Button>
                  <Button variant="outline" size="sm" onClick={() => setNavigation({ severityPage: severityPageIndex + 1 })} disabled={severityPageIndex === severityPageCount - 1}>Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SLA Status per Group</CardTitle>
            <CardDescription>Compliance rate tiket aktif berdasarkan group terpilih.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {groupRows.length ? groupRows.map((row) => <ComplianceRow key={row.id} row={row} verdictsAvailable={verdictsAvailable} />) : <div className="py-8 text-center text-sm text-muted-foreground">Tidak ada tiket dalam scope ini.</div>}
            {groupPageCount > 1 && (
              <div className="flex items-center justify-between border-t pt-4 text-sm text-muted-foreground">
                <span>Page {groupPageIndex + 1} of {groupPageCount}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setNavigation({ page: groupPageIndex - 1 })} disabled={groupPageIndex === 0}>Previous</Button>
                  <Button variant="outline" size="sm" onClick={() => setNavigation({ page: groupPageIndex + 1 })} disabled={groupPageIndex === groupPageCount - 1}>Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {verdictsAvailable ? (
        <SlaDashboardList tickets={tableRows} scope={scope.role} />
      ) : (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">SLA verdicts are unavailable while the dataset is not up to date.</CardContent></Card>
      )}

      <ChartCard title="Tren Compliance" description="Compliance rate harian tiket closed dalam 7 hari terakhir.">
        {verdictsAvailable ? (
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
        ) : (
          <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">Compliance trend unavailable while the dataset is not up to date.</div>
        )}
      </ChartCard>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Breach heatmap</CardTitle>
          <CardDescription>Breached tickets by escalation/update hour — day × hour (darker = more tickets)</CardDescription>
        </CardHeader>
        <CardContent>
          {verdictsAvailable ? <Heatmap grid={data.heatmap.grid} max={data.heatmap.max} /> : <div className="py-8 text-center text-sm text-muted-foreground">Breach heatmap unavailable while the dataset is not up to date.</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="text-base">Breach Log</CardTitle>
            <CardDescription>Riwayat tiket terminal dengan bukti pelanggaran SLA.</CardDescription>
          </div>
          {verdictsAvailable && data.breach_log.length > 20 && <Button variant="outline" size="sm" onClick={() => setNavigation({ showAllBreaches: !navigation.showAllBreaches })}>{navigation.showAllBreaches ? "Tampilkan 20" : "Lihat semua"}</Button>}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Bukti Breach</TableHead>
                  <TableHead>Diselesaikan pada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!verdictsAvailable && <EmptyRow colSpan={7} text="Breach log unavailable — the dataset is not up to date, so absence of breaches cannot be claimed." />}
                {verdictsAvailable && data.breach_log.length === 0 && <EmptyRow colSpan={7} text="Belum ada breach log." />}
                {verdictsAvailable && data.breach_log.slice(0, navigation.showAllBreaches ? data.breach_log.length : 20).map((t) => <BreachLogRow key={t.id} ticket={t} zammadBase={zammadBase} />)}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ComplianceRow({ row, verdictsAvailable }: { row: SlaMonitorRow; verdictsAvailable: boolean }) {
  const rate = verdictsAvailable ? row.compliance_rate : null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium capitalize">{row.name}</span>
        <span className="text-muted-foreground">
          {!verdictsAvailable ? "Unavailable" : rate == null ? "-" : formatPercent(rate, 0)} · {formatNumber(row.total)} tiket
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <div className={cn("h-full rounded-full", rate == null ? "bg-muted-foreground" : rate >= 90 ? "bg-emerald-500" : rate >= 80 ? "bg-amber-500" : "bg-red-600")} style={{ width: `${rate == null ? 0 : Math.min(100, rate)}%` }} />
      </div>
    </div>
  );
}


function BreachLogRow({ ticket, zammadBase }: { ticket: Ticket; zammadBase: string }) {
  const title = zammadBase ? <a className="hover:underline" href={`${zammadBase}/#ticket/zoom/${ticket.zammad_id}`} target="_blank" rel="noreferrer">{ticket.title}</a> : <Link className="hover:underline" to={`/tickets/${ticket.id}`}>{ticket.title}</Link>;
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">#{ticket.number}</TableCell>
      <TableCell className="max-w-sm truncate">{title}</TableCell>
      <TableCell><SeverityBadge severity={ticket.severity} label={ticket.severity_label} /></TableCell>
      <TableCell className="text-sm">{ticket.group_name}</TableCell>
      <TableCell className="text-sm">{ticket.owner_name ?? "-"}</TableCell>
      <TableCell className="text-sm font-medium text-red-600 dark:text-red-400">{breachEvidence(ticket)}</TableCell>
      <TableCell className="text-sm">{formatDate(ticket.close_at ?? ticket.closed_at)}</TableCell>
    </TableRow>
  );
}
export function severityMonitorRows(tickets: Ticket[]): SlaMonitorRow[] {
  return SEVERITY_OPTIONS
    .map((severity) => slaMonitorRow(severity.value, severity.label, tickets.filter((ticket) => ticket.severity === severity.value)))
    .sort((a, b) => b.total - a.total);
}

function slaMonitorRow(id: string, name: string, tickets: Ticket[]): SlaMonitorRow {
  const monitored = tickets.filter((ticket) => ticket.live_sla_status !== "no_sla");
  const breached = monitored.filter((ticket) => ticket.live_sla_status === "breached").length;
  return {
    id,
    name,
    total: tickets.length,
    total_with_sla: monitored.length,
    on_track: monitored.filter((ticket) => ticket.live_sla_status === "safe" || ticket.live_sla_status === "on_track").length,
    warning: monitored.filter((ticket) => ticket.live_sla_status === "warning").length,
    critical: monitored.filter((ticket) => ticket.live_sla_status === "critical").length,
    at_risk: monitored.filter((ticket) => ticket.live_sla_status === "warning" || ticket.live_sla_status === "critical").length,
    breached,
    no_sla: tickets.length - monitored.length,
    compliance_rate: monitored.length ? ((monitored.length - breached) / monitored.length) * 100 : null,
  };
}


function breachEvidence(ticket: Ticket) {
  if (ticket.close_diff_in_min != null && ticket.close_diff_in_min < 0) return `Resolusi lewat ${formatMinutes(Math.abs(ticket.close_diff_in_min))}`;
  if (ticket.update_diff_in_min != null && ticket.update_diff_in_min < 0) return `Update lewat ${formatMinutes(Math.abs(ticket.update_diff_in_min))}`;
  if (ticket.close_breached) return "Resolusi melanggar SLA";
  if (ticket.first_response_breached) return "Respons pertama melanggar SLA";
  return "Pelanggaran SLA tersimpan";
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

function formatMinutes(minutes: number | null) {
  if (minutes == null) return "-";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours ? `${hours}j ${mins}m` : `${mins}m`;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}
