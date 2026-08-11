import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import { useScope } from "@/stores/auth";
import { PageHeader } from "@/components/page-header";
import { ChartCard } from "@/components/chart-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PriorityBadge, StateBadge } from "@/components/status-badges";
import { formatNumber } from "@/lib/utils";
import type { OverviewPeriod, Ticket } from "@/types";

const PAGE_SIZE = 20;
const EXPORT_SIZE = 100;
const COLORS = {
  created: "hsl(var(--primary))",
  closed: "hsl(142 76% 45%)",
  backlog: "hsl(200 80% 55%)",
  reopened: "hsl(32 95% 50%)",
};
const METRICS = [
  { key: "created", label: "Created" },
  { key: "closed", label: "Closed" },
  { key: "backlog", label: "Backlog" },
  { key: "reopened", label: "Reopened" },
] as const;
const PERIODS: { value: OverviewPeriod; label: string }[] = [
  { value: "year", label: "Year" },
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
];

type Metric = (typeof METRICS)[number]["key"];

export default function OverviewPage() {
  const scope = useScope();
  const scopeKey = `${scope.role}:${scope.user_id}:${scope.group_ids.join(",")}`;
  const [period, setPeriod] = useState<OverviewPeriod>("year");
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [week, setWeek] = useState(weekInputValue(new Date()));
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [page, setPage] = useState(1);
  const [tableMetric, setTableMetric] = useState<Exclude<Metric, "backlog">>("created");
  const [visible, setVisible] = useState<Record<Metric, boolean>>({
    created: true,
    closed: true,
    backlog: false,
    reopened: false,
  });
  const [groupFilter, setGroupFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");

  const groups = useQuery({ queryKey: ["groups-filter", scopeKey], queryFn: () => api.listAllGroupsForFilter() });
  const agents = useQuery({ queryKey: ["agents-filter", scopeKey], queryFn: () => api.listAllAgentsForFilter() });
  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);
  const months = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: new Date(2000, i, 1).toLocaleString("en", { month: "long" }) }));
  const rangeKey = period === "year" ? String(year) : period === "month" ? `${year}-${month}` : period === "week" ? week : day;
  const overview = useQuery({
    queryKey: ["overview", scopeKey, period, year, rangeKey, groupFilter, agentFilter, page],
    queryFn: () => api.getOverview(scope, { period, year, month, week, day, group_id: groupFilter, owner_id: agentFilter, page, page_size: PAGE_SIZE }),
  });
  const data = overview.data;
  const rows = data?.tickets ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const resetRange = (nextPeriod: OverviewPeriod) => {
    setPeriod(nextPeriod);
    if (nextPeriod !== "year") setYear(new Date().getFullYear());
    setPage(1);
  };

  const downloadCsv = async () => {
    const exportData = await api.getOverview(scope, { period, year, month, week, day, group_id: groupFilter, owner_id: agentFilter, page: 1, page_size: EXPORT_SIZE });
    const header = ["Number", "Title", "State", "Priority", "Group", "Agent", "Created", "Closed", "Reopened"];
    const lines = [header, ...exportData.tickets.map(csvRow)].map((row) => row.map(csvCell).join(","));
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `overview-${period}-${year}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Overview" description="PostgreSQL-backed ticket reporting overview." />

      <Tabs value={period} onValueChange={(v) => resetRange(v as OverviewPeriod)}>
        <TabsList>
          {PERIODS.map((p) => (
            <TabsTrigger key={p.value} value={p.value}>{p.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ticket count</CardTitle>
            <CardDescription>Select series to show</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-3">
              {METRICS.map((metric) => (
                <label key={metric.key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={visible[metric.key]}
                    onCheckedChange={(checked) => setVisible((v) => ({ ...v, [metric.key]: checked === true }))}
                  />
                  <span>{metric.label}</span>
                </label>
              ))}
            </div>

            <div className="border-t pt-5 space-y-4">
              <div className="space-y-2">
                <Label>Group filter</Label>
                <Select value={groupFilter} onValueChange={(v) => { setGroupFilter(v); setPage(1); }}>
                  <SelectTrigger><SelectValue placeholder="All groups" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All groups</SelectItem>
                    {(groups.data ?? []).map((group) => (
                      <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Agent filter</Label>
                <Select value={agentFilter} onValueChange={(v) => { setAgentFilter(v); setPage(1); }}>
                  <SelectTrigger><SelectValue placeholder="All agents" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All agents</SelectItem>
                    {(agents.data ?? []).map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>{agent.firstname} {agent.lastname}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <ChartCard
          className="lg:col-span-2"
          title="Ticket count"
          description="Created, closed, backlog and reopened tickets over time."
          action={
            <PeriodFilter
              period={period}
              year={year}
              month={month}
              week={week}
              day={day}
              years={years}
              months={months}
              onYearChange={(value) => { setYear(value); setPage(1); }}
              onMonthChange={(value) => { setYear(new Date().getFullYear()); setMonth(value); setPage(1); }}
              onWeekChange={(value) => { if (value) setYear(Number(value.slice(0, 4))); setWeek(value); setPage(1); }}
              onDayChange={(value) => { if (value) setYear(Number(value.slice(0, 4))); setDay(value); setPage(1); }}
            />
          }
        >
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.chart ?? []} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend />
                {METRICS.filter((m) => visible[m.key]).map((metric) => (
                  <Line key={metric.key} type="monotone" dataKey={metric.key} name={metric.label} stroke={COLORS[metric.key]} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      <Tabs value={tableMetric} onValueChange={(v) => setTableMetric(v as typeof tableMetric)}>
        <TabsList>
          <TabsTrigger value="created">Created</TabsTrigger>
          <TabsTrigger value="closed">Closed</TabsTrigger>
          <TabsTrigger value="reopened">Reopened</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Records</CardTitle>
            <CardDescription>
              {formatNumber(data?.totals[tableMetric] ?? 0)} {tableMetric} ticket(s) in this view
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={downloadCsv} disabled={!total}>
            <Download className="size-3.5" />
            Download {formatNumber(Math.min(total, EXPORT_SIZE))} record(s)
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!overview.isLoading && rows.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">No records match this period.</TableCell></TableRow>
                )}
                {overview.isLoading && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">Loading overview…</TableCell></TableRow>
                )}
                {rows.map((ticket) => (
                  <TableRow key={ticket.id}>
                    <TableCell className="font-mono text-xs">#{ticket.number}</TableCell>
                    <TableCell className="max-w-md truncate font-medium">{ticket.title}</TableCell>
                    <TableCell><StateBadge state={ticket.state} /></TableCell>
                    <TableCell><PriorityBadge priority={ticket.priority} /></TableCell>
                    <TableCell>{ticket.group_name}</TableCell>
                    <TableCell>{ticket.owner_name ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{dateFor(ticket, tableMetric)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div>Showing {total ? (page - 1) * PAGE_SIZE + 1 : 0}–{Math.min(page * PAGE_SIZE, total)} of {total}</div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
              <span>Page {page} of {pageCount}</span>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PeriodFilter({
  period,
  year,
  month,
  week,
  day,
  years,
  months,
  onYearChange,
  onMonthChange,
  onWeekChange,
  onDayChange,
}: {
  period: OverviewPeriod;
  year: number;
  month: number;
  week: string;
  day: string;
  years: number[];
  months: { value: number; label: string }[];
  onYearChange: (value: number) => void;
  onMonthChange: (value: number) => void;
  onWeekChange: (value: string) => void;
  onDayChange: (value: string) => void;
}) {
  if (period === "month") {
    return (
      <Select value={String(month)} onValueChange={(v) => onMonthChange(Number(v))}>
        <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {months.map((m) => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }
  if (period === "week") {
    return <Input type="week" className="w-[150px]" value={week} onChange={(e) => onWeekChange(e.target.value)} />;
  }
  if (period === "day") {
    return <Input type="date" className="w-[150px]" value={day} onChange={(e) => onDayChange(e.target.value)} />;
  }
  return (
    <Select value={String(year)} onValueChange={(v) => onYearChange(Number(v))}>
      <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
      <SelectContent>
        {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function weekInputValue(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function csvRow(ticket: Ticket) {
  return [
    ticket.number,
    ticket.title,
    ticket.state,
    ticket.priority,
    ticket.group_name,
    ticket.owner_name ?? "Unassigned",
    ticket.zammad_created_at,
    ticket.closed_at ?? "",
    String(ticket.reopen_count),
  ];
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function dateFor(ticket: Ticket, metric: Exclude<Metric, "backlog">) {
  const value = metric === "closed" ? ticket.closed_at : metric === "reopened" ? ticket.zammad_updated_at : ticket.zammad_created_at;
  return value ? new Date(value).toLocaleString() : "—";
}
