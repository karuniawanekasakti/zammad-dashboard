import { useMemo, useState, type ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gauge,
  RotateCcw,
  Timer,
  Ticket as TicketIcon,
  UserCheck,
  Users as UsersIcon,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { useScope } from "@/stores/auth";
import { fullName } from "@/lib/mock-data";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { ChartCard } from "@/components/chart-card";
import { PageLoader, Spinner } from "@/components/spinner";
import { DataError, QueryBody } from "@/components/data-error";
import type { Group, User } from "@/types";
import { RoleBadge, SeverityBadge, StateBadge } from "@/components/status-badges";
import { SlaBadge } from "@/components/sla-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserAvatar } from "@/components/user-avatar";
import { formatPercent, formatSeconds, formatNumber } from "@/lib/utils";
import { SEVERITY_OPTIONS } from "@/lib/ticket-fields";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(142 76% 45%)",
  "hsl(32 95% 50%)",
  "hsl(0 84% 60%)",
  "hsl(280 70% 60%)",
  "hsl(200 80% 55%)",
];

const TICKET_COUNT_COLORS = {
  created: "hsl(var(--primary))",
  closed: "hsl(142 76% 45%)",
  backlog: "hsl(200 80% 55%)",
  open: "hsl(32 95% 50%)",
};

export default function DashboardPage() {
  const user = useAuth((s) => s.user)!;
  const scope = useScope();

  const showFilters = user.role !== "agent";
  const allGroups = useQuery({ queryKey: ["groups-filter"], queryFn: () => api.listAllGroupsForFilter(), enabled: showFilters });
  const allAgents = useQuery({ queryKey: ["agents-filter"], queryFn: () => api.listAllAgentsForFilter(), enabled: showFilters });

  const [groupFilter, setGroupFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  // Build a filtered scope for queries
  const filteredScope = useMemo(() => {
    const base = { ...scope };
    if (groupFilter !== "all") base.group_ids = [groupFilter];
    return base;
  }, [scope, groupFilter]);

  // Agents visible in the selected group (for agent dropdown)
  const agentsInGroup = useMemo(() => {
    const list = allAgents.data ?? [];
    if (groupFilter === "all") return list;
    return list.filter((a) => a.group_ids.includes(groupFilter));
  }, [allAgents.data, groupFilter]);
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${user.firstname}`}
        description="Role-aware real-time overview of your helpdesk."
        action={<RoleBadge role={user.role} />}
      />

      {showFilters && (
        <FilterBar
          groups={allGroups}
          agents={allAgents}
          agentsInGroup={agentsInGroup}
          groupFilter={groupFilter}
          agentFilter={agentFilter}
          onGroupChange={(v) => { setGroupFilter(v); setAgentFilter("all"); }}
          onAgentChange={setAgentFilter}
        />
      )}

      {user.role === "admin" && <AdminDashboard scope={filteredScope} agentFilter={agentFilter} chart={<TicketCountChart scope={filteredScope} groupFilter={groupFilter} agentFilter={agentFilter} />} />}
      {user.role === "team_lead" && <TeamLeadDashboard scope={filteredScope} agentFilter={agentFilter} chart={<TicketCountChart scope={filteredScope} groupFilter={groupFilter} agentFilter={agentFilter} />} />}
      {user.role === "project_manager" && <ProjectManagerDashboard scope={filteredScope} agentFilter={agentFilter} chart={<TicketCountChart scope={filteredScope} groupFilter={groupFilter} agentFilter={agentFilter} />} />}
      {user.role === "agent" && <AgentDashboard scope={scope} userId={user.id} chart={<TicketCountChart scope={scope} groupFilter="all" agentFilter="all" />} />}
    </div>
  );
}

// ---------- Top-level scope filters -----------------------------------------
// The group/agent dropdowns are backed by their own queries. While either is in
// flight or has failed the selects must not advertise an empty "All groups /
// All agents" list as though it were the real one.
function FilterBar({
  groups,
  agents,
  agentsInGroup,
  groupFilter,
  agentFilter,
  onGroupChange,
  onAgentChange,
}: {
  groups: UseQueryResult<Group[]>;
  agents: UseQueryResult<User[]>;
  agentsInGroup: User[];
  groupFilter: string;
  agentFilter: string;
  onGroupChange: (value: string) => void;
  onAgentChange: (value: string) => void;
}) {
  const isLoading = groups.isLoading || agents.isLoading;
  const isError = groups.isError || agents.isError;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground" role="status">
        <Spinner className="size-4" />
        Loading filters…
      </div>
    );
  }

  if (isError) {
    return (
      <DataError
        title="dashboard filters"
        detail="GET /groups?summary=true · GET /agents?summary=true"
        onRetry={() => {
          if (groups.isError) groups.refetch();
          if (agents.isError) agents.refetch();
        }}
      />
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Select value={groupFilter} onValueChange={onGroupChange}>
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="All groups" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All groups</SelectItem>
          {(groups.data ?? []).map((g) => (
            <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={agentFilter} onValueChange={onAgentChange}>
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="All agents" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All agents</SelectItem>
          {agentsInGroup.map((a) => (
            <SelectItem key={a.id} value={a.id}>{a.firstname} {a.lastname}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ---------- Admin Dashboard -------------------------------------------------
function AdminDashboard({ scope, agentFilter, chart }: { scope: ReturnType<typeof useScope>; agentFilter: string; chart: ReactNode }) {
  const kpi = useQuery({ queryKey: ["kpi", "admin", scope, agentFilter], queryFn: () => api.kpiSummary(scope) });
  const volume = useQuery({ queryKey: ["trend", "volume", 30], queryFn: () => api.ticketVolumeTrend(30) });
  const breach = useQuery({ queryKey: ["trend", "breach", 30], queryFn: () => api.slaBreachTrend(30) });
  const agents = useQuery({ queryKey: ["agents", scope], queryFn: () => api.listAgents(scope) });
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: () => api.listNotifications() });
  const settings = useQuery({ queryKey: ["dashboard", "system-settings"], queryFn: () => api.getSystemSettings() });

  const top = (agents.data ?? [])
    .filter((s) => agentFilter === "all" || s.agent.id === agentFilter)
    .slice(0, 6);
  const recent = (notifications.data ?? []).slice(0, 5);

  if (kpi.isLoading) return <PageLoader label="Loading KPIs…" />;
  if (kpi.isError || !kpi.data) {
    return <DataError title="admin KPIs" detail="GET /kpi/summary" onRetry={() => kpi.refetch()} variant="page" />;
  }

  return (
    <>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Open tickets"
          value={formatNumber(kpi.data.total_open_tickets)}
          helper={`${formatNumber(kpi.data.new_today)} new today`}
          icon={TicketIcon}
          trend={{ value: 3.2, direction: "down", goodIs: "down" }}
        />
        <KpiCard
          title="Agents online"
          value={`${kpi.data.agents_online} / ${kpi.data.total_agents}`}
          helper="Active in last 15 min"
          icon={UserCheck}
          iconClassName="bg-emerald-500/15 text-emerald-500"
        />
        <KpiCard
          title="SLA breach rate"
          value={formatPercent(kpi.data.sla_breach_rate)}
          helper="Across last 30 days"
          icon={AlertTriangle}
          iconClassName="bg-destructive/15 text-destructive"
          trend={{ value: 1.4, direction: "down", goodIs: "down" }}
        />
        <KpiCard
          title="Avg resolution"
          value={formatSeconds(kpi.data.avg_resolution_secs)}
          helper="Last 7 days"
          icon={Timer}
          iconClassName="bg-amber-500/15 text-amber-500"
          trend={{ value: 4.8, direction: "up", goodIs: "down" }}
        />
      </div>

      {chart}

      <div className="grid gap-4 lg:grid-cols-2">
        <QueryBody isLoading={volume.isLoading} isError={volume.isError} onRetry={() => volume.refetch()} label="ticket volume">
          <ChartCard title="Ticket volume" description="New tickets per day (last 30d)">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={volume.data ?? []}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </QueryBody>
        <QueryBody isLoading={breach.isLoading} isError={breach.isError} onRetry={() => breach.refetch()} label="SLA breach trend">
          <ChartCard title="SLA breach trend" description="Daily breach count, last 30d">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={breach.data ?? []}>
                <defs>
                  <linearGradient id="breachGrad" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Area type="monotone" dataKey="value" stroke="hsl(var(--destructive))" fill="url(#breachGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </QueryBody>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Agent workload" description="Top 6 agents by open tickets" className="lg:col-span-2">
          <QueryBody isLoading={agents.isLoading} isError={agents.isError} onRetry={() => agents.refetch()} label="agent workload">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <TableHead className="text-right">At Risk</TableHead>
                  <TableHead className="text-right">Breached</TableHead>
                  <TableHead className="text-right">Avg 1st reply</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {top.map((s) => (
                  <TableRow key={s.agent.id}>
                    <TableCell className="flex items-center gap-2">
                      <UserAvatar user={s.agent} size="sm" />
                      <span className="font-medium">{fullName(s.agent)}</span>
                    </TableCell>
                    <TableCell className="text-right font-mono">{s.open_tickets}</TableCell>
                    <TableCell className="text-right">
                      {s.at_risk > 0 ? <Badge variant="warning">{s.at_risk}</Badge> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.breached > 0 ? <Badge variant="destructive">{s.breached}</Badge> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatSeconds(s.avg_first_reply_secs)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </QueryBody>
        </ChartCard>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent alerts</CardTitle>
            <CardDescription>Latest notifications feed</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {notifications.isLoading ? (
              <div className="flex items-center justify-center py-10" role="status">
                <Spinner className="size-5" />
              </div>
            ) : notifications.isError ? (
              <DataError title="recent alerts" detail="GET /notifications" onRetry={() => notifications.refetch()} />
            ) : (
              <>
                {recent.length === 0 && <div className="text-sm text-muted-foreground">No recent alerts</div>}
                {recent.map((n) => (
                  <div key={n.id} className="flex gap-2 text-sm">
                    <div className="size-2 mt-1.5 rounded-full bg-destructive shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{n.rule_name}</div>
                      <div className="text-xs text-muted-foreground truncate">{n.message}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="py-4">
          {settings.isLoading ? (
            <div className="flex items-center justify-center py-4" role="status">
              <Spinner className="size-5" />
            </div>
          ) : settings.isError || !settings.data ? (
            <DataError title="sync health" detail="GET /settings" onRetry={() => settings.refetch()} />
          ) : (
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-sm">
                <Activity className="size-4 text-emerald-500" />
                <div>
                  <div className="font-medium">Sync health</div>
                  <div className="text-xs text-muted-foreground">
                    Last sync{" "}
                    {settings.data.last_sync_at
                      ? formatDistanceToNow(new Date(settings.data.last_sync_at), { addSuffix: true })
                      : "—"}{" "}
                    · Zammad API:{" "}
                    {settings.data.zammad_online ? (
                      <span className="text-emerald-500 font-medium">Online</span>
                    ) : (
                      <span className="text-destructive font-medium">Offline</span>
                    )}
                  </div>
                </div>
              </div>
              <Badge variant="success">All systems operational</Badge>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ---------- Team Lead Dashboard --------------------------------------------
function TeamLeadDashboard({ scope, agentFilter, chart }: { scope: ReturnType<typeof useScope>; agentFilter: string; chart: ReactNode }) {
  const kpi = useQuery({ queryKey: ["kpi", "tl", scope, agentFilter], queryFn: () => api.kpiSummary(scope) });
  const agents = useQuery({ queryKey: ["agents", scope], queryFn: () => api.listAgents(scope) });
  const atRisk = useQuery({ queryKey: ["at_risk", scope], queryFn: () => api.listAtRisk(scope) });

  const workload = (agents.data ?? [])
    .filter((s) => agentFilter === "all" || s.agent.id === agentFilter)
    .slice(0, 8)
    .map((s) => ({
      name: s.agent.firstname,
      open: s.open_tickets,
      at_risk: s.at_risk,
      breached: s.breached,
    }));

  if (kpi.isLoading || agents.isLoading) return <PageLoader label="Loading group KPIs…" />;
  if (kpi.isError || agents.isError || !kpi.data || !agents.data) {
    return (
      <DataError
        title="group KPIs"
        detail="GET /kpi/summary · GET /agents"
        onRetry={() => {
          if (kpi.isError) kpi.refetch();
          if (agents.isError) agents.refetch();
        }}
        variant="page"
      />
    );
  }

  return (
    <>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Group open tickets" value={formatNumber(kpi.data.total_open_tickets)} icon={TicketIcon} />
        <KpiCard title="Agents in group" value={`${agents.data.length}`} helper="Active agents" icon={UsersIcon} />
        <KpiCard title="Group SLA breach" value={formatPercent(kpi.data.sla_breach_rate)} icon={AlertTriangle} iconClassName="bg-destructive/15 text-destructive" />
        <KpiCard title="Avg first reply" value={formatSeconds(kpi.data.avg_first_reply_secs)} icon={Clock} />
      </div>

      {chart}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Agent workload" description="Open / at-risk / breached per agent">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={workload}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="open" stackId="a" fill="hsl(var(--primary))" />
              <Bar dataKey="at_risk" stackId="a" fill="hsl(32 95% 50%)" />
              <Bar dataKey="breached" stackId="a" fill="hsl(0 84% 60%)" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="SLA at-risk tickets" description="Closest deadlines first">
          <QueryBody
            isLoading={atRisk.isPending}
            isError={atRisk.isError}
            isEmpty={!atRisk.data?.length}
            onRetry={() => atRisk.refetch()}
            label="at-risk tickets"
            emptyMessage="No at-risk tickets 🎉"
          >
            <div className="space-y-2">
              {(atRisk.data ?? []).slice(0, 6).map((t) => (
                <div key={t.id} className="flex items-center gap-2 border rounded-md p-2 text-sm">
                  <div className="font-mono text-xs text-muted-foreground w-12">#{t.number}</div>
                  <div className="flex-1 truncate">{t.title}</div>
                  <SlaBadge status={t.live_sla_status} remainingMs={t.sla_remaining_ms} />
                </div>
              ))}
            </div>
          </QueryBody>
        </ChartCard>
      </div>

      <ChartCard title="Top breached this week" description="Agents ranked by breach count">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead className="text-right">Open</TableHead>
              <TableHead className="text-right">Breached</TableHead>
              <TableHead className="text-right">Breach rate</TableHead>
              <TableHead className="text-right">Avg resolution</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(agents.data ?? [])
              .filter((s) => agentFilter === "all" || s.agent.id === agentFilter)
              .slice()
              .sort((a, b) => b.breached - a.breached)
              .slice(0, 5)
              .map((s) => (
                <TableRow key={s.agent.id}>
                  <TableCell className="flex items-center gap-2">
                    <UserAvatar user={s.agent} size="sm" />
                    {fullName(s.agent)}
                  </TableCell>
                  <TableCell className="text-right font-mono">{s.open_tickets}</TableCell>
                  <TableCell className="text-right">
                    {s.breached > 0 ? <Badge variant="destructive">{s.breached}</Badge> : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatPercent(s.sla_breach_rate)}</TableCell>
                  <TableCell className="text-right font-mono">{formatSeconds(s.avg_resolution_secs)}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </ChartCard>
    </>
  );
}

// ---------- Project Manager Dashboard --------------------------------------
function ProjectManagerDashboard({ scope, agentFilter, chart }: { scope: ReturnType<typeof useScope>; agentFilter: string; chart: ReactNode }) {
  const kpi = useQuery({ queryKey: ["kpi", "pm", scope, agentFilter], queryFn: () => api.kpiSummary(scope) });
  const resTrend = useQuery({ queryKey: ["trend", "res", 14], queryFn: () => api.resolutionTimeTrend(14) });
  const tickets = useQuery({
    queryKey: ["tickets", scope, "pm", agentFilter],
    queryFn: () => api.listTickets(scope, { owner_id: agentFilter, page: 1, page_size: 200 }),
  });

  // The KPIs, tag/severity charts and the state summary are all derived from
  // these two queries. Rendering them with `?? 0` / `?? []` while a query is
  // in flight or has failed presents a fabricated zero and an empty chart as
  // though they were the data.
  const pending = kpi.isPending || tickets.isPending;
  const errored = kpi.isError || tickets.isError;
  const retry = () => {
    if (kpi.isError) void kpi.refetch();
    if (tickets.isError) void tickets.refetch();
  };
  const rows = tickets.data?.rows ?? [];
  const isEmpty = !errored && !pending && (tickets.data?.total ?? 0) === 0;

  if (pending) return <PageLoader label="Loading project KPIs…" />;
  if (errored || !kpi.data || !tickets.data) {
    return <DataError title="project KPIs" detail="GET /kpi/summary · GET /tickets" onRetry={retry} variant="page" />;
  }

  const byTag = (() => {
    const map = new Map<string, number>();
    rows.forEach((t) => t.tags.forEach((tag) => map.set(tag, (map.get(tag) ?? 0) + 1)));
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  })();

  const bySeverity = (() => {
    return SEVERITY_OPTIONS.map((severity) => ({
      name: severity.label,
      new: rows.filter((t) => t.severity === severity.value && t.state === "new").length,
      open: rows.filter((t) => t.severity === severity.value && t.state === "open").length,
      pending: rows.filter((t) => t.severity === severity.value && t.state === "pending").length,
    }));
  })();

  const totalClosed = rows.filter((t) => t.state === "closed").length;

  return (
    <>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Total tickets" value={isEmpty ? "No tickets" : formatNumber(tickets.data.total)} icon={TicketIcon} />
        <KpiCard title="Resolved today" value={formatNumber(kpi.data.total_closed_today)} icon={CheckCircle2} iconClassName="bg-emerald-500/15 text-emerald-500" />
        <KpiCard title="SLA breach rate" value={formatPercent(kpi.data.sla_breach_rate)} icon={Gauge} />
        <KpiCard title="Reopen rate" value={formatPercent(kpi.data.reopen_rate)} icon={RotateCcw} />
      </div>

      {chart}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Tickets by tag" description="Top project/category tags">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={byTag.slice(0, 6)}
                dataKey="value"
                nameKey="name"
                innerRadius={55}
                outerRadius={90}
                label={(e) => e.name}
              >
                {byTag.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Resolution time trend" description="Avg seconds, last 14 days">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={resTrend.data ?? []}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatSeconds(v)} />
              <Tooltip
                formatter={(v: number) => formatSeconds(v)}
                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
              />
              <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Severity distribution" description="Active tickets by severity">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={bySeverity}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="new" stackId="a" fill="hsl(var(--primary))" />
              <Bar dataKey="open" stackId="a" fill="hsl(142 76% 45%)" />
              <Bar dataKey="pending" stackId="a" fill="hsl(32 95% 50%)" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Group ticket summary" description="State breakdown across tickets">
          <div className="grid grid-cols-2 gap-3 pt-2">
            <SummaryStat label="New" value={(tickets.data?.rows ?? []).filter((t) => t.state === "new").length} />
            <SummaryStat label="Open" value={(tickets.data?.rows ?? []).filter((t) => t.state === "open").length} />
            <SummaryStat label="Pending" value={(tickets.data?.rows ?? []).filter((t) => t.state === "pending").length} />
            <SummaryStat label="Closed" value={totalClosed} />
          </div>
        </ChartCard>
      </div>
    </>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border rounded-lg p-4">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function TicketCountChart({ scope, groupFilter, agentFilter }: { scope: ReturnType<typeof useScope>; groupFilter: string; agentFilter: string }) {
  const nav = useNavigate();
  const year = new Date().getFullYear();
  const overview = useQuery({
    queryKey: ["overview", scope, "year", year, groupFilter, agentFilter, "dashboard-mini-chart"],
    queryFn: () => api.getOverview(scope, { period: "year", year, group_id: groupFilter, owner_id: agentFilter, page: 1, page_size: 1 }),
  });
  const latest = useQuery({
    queryKey: ["tickets", "latest-updated", scope, groupFilter, agentFilter],
    queryFn: () => api.listTickets(scope, { group_id: groupFilter, owner_id: agentFilter, sort_by: "updated", sort_dir: "desc", page: 1, page_size: 5 }),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card
        role="button"
        tabIndex={0}
        onClick={() => nav("/overview")}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") nav("/overview"); }}
        className="flex h-full cursor-pointer flex-col transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Ticket count</CardTitle>
          <CardDescription>Click to open overview</CardDescription>
        </CardHeader>
        <CardContent className="min-h-[240px] flex-1 pb-4">
          <QueryBody
            isLoading={overview.isPending}
            isError={overview.isError}
            isEmpty={!overview.data?.chart?.length}
            onRetry={() => overview.refetch()}
            label="ticket count chart"
            emptyMessage="No ticket activity in this scope."
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={overview.data?.chart ?? []} margin={{ left: -18, right: 8, top: 8, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Line type="monotone" dataKey="created" name="Created" stroke={TICKET_COUNT_COLORS.created} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="closed" name="Closed" stroke={TICKET_COUNT_COLORS.closed} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </QueryBody>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Latest updated tickets</CardTitle>
          <CardDescription>Most recently updated in this scope</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <QueryBody
            isLoading={latest.isPending}
            isError={latest.isError}
            isEmpty={!latest.data?.rows.length}
            onRetry={() => latest.refetch()}
            label="latest updated tickets"
            emptyMessage="No tickets found."
          >
            {(latest.data?.rows ?? []).map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                onClick={() => nav(`/tickets/${ticket.id}`)}
                className="flex w-full items-center gap-3 rounded-md border p-2 text-left text-sm transition-colors hover:bg-muted/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs text-muted-foreground">#{ticket.number}</span>
                  <span className="block truncate font-medium">{ticket.title}</span>
                </span>
                <span className="hidden shrink-0 items-center gap-2 md:flex">
                  <SeverityBadge severity={ticket.severity} label={ticket.severity_label} />
                  <StateBadge state={ticket.state} />
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(ticket.zammad_updated_at), { addSuffix: true })}
                  </span>
                </span>
              </button>
            ))}
          </QueryBody>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- Agent Dashboard -------------------------------------------------
function AgentDashboard({ scope, userId, chart }: { scope: ReturnType<typeof useScope>; userId: string; chart: ReactNode }) {
  const nav = useNavigate();
  const kpi = useQuery({ queryKey: ["kpi", "agent", userId], queryFn: () => api.kpiSummary(scope) });
  const mine = useQuery({
    queryKey: ["tickets", "mine", userId],
    queryFn: () => api.listTickets(scope, { state: "open", page_size: 10 }),
  });
  const reply = useQuery({ queryKey: ["trend", "reply", 7], queryFn: () => api.firstReplyTrend(7) });
  const res = useQuery({ queryKey: ["trend", "res", 7], queryFn: () => api.resolutionTimeTrend(7) });
  // Both the KPI cards and the open-ticket table read their own query. A
  // pending or failed request must not render as 0 / "All caught up!".
  if (kpi.isPending) return <PageLoader label="Loading your KPIs…" />;
  if (kpi.isError || !kpi.data) {
    return <DataError title="your KPIs" detail="GET /kpi/summary" onRetry={() => kpi.refetch()} variant="page" />;
  }

  return (
    <>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard title="My open tickets" value={formatNumber(kpi.data.total_open_tickets)} icon={TicketIcon} />
        <KpiCard title="My at-risk" value={formatNumber(kpi.data.at_risk)} icon={AlertTriangle} iconClassName="bg-warning/15 text-warning" />
        <KpiCard title="Avg 1st reply" value={formatSeconds(kpi.data.avg_first_reply_secs)} icon={Clock} />
        <KpiCard title="Reopen rate" value={formatPercent(kpi.data.reopen_rate)} icon={RotateCcw} />
      </div>

      {chart}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">My open tickets</CardTitle>
          <CardDescription>Click any row to view detail</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>SLA</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(mine.data?.rows ?? []).map((t) => (
                <TableRow
                  key={t.id}
                  onClick={() => nav(`/tickets/${t.id}`)}
                  className="cursor-pointer"
                >
                  <TableCell className="font-mono">#{t.number}</TableCell>
                  <TableCell className="max-w-xs truncate">{t.title}</TableCell>
                  <TableCell><SeverityBadge severity={t.severity} label={t.severity_label} /></TableCell>
                  <TableCell><SlaBadge status={t.live_sla_status} remainingMs={t.sla_remaining_ms} /></TableCell>
                  <TableCell><StateBadge state={t.state} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(t.zammad_updated_at), { addSuffix: true })}
                  </TableCell>
                </TableRow>
              ))}
              {mine.isPending ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <Spinner />
                      Loading your tickets…
                    </div>
                  </TableCell>
                </TableRow>
              ) : mine.isError ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10">
                    <DataError title="your open tickets" detail="GET /tickets" onRetry={() => mine.refetch()} />
                  </TableCell>
                </TableRow>
              ) : !mine.data?.rows.length ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    All caught up! ✨
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="First reply trend" description="Last 7 days">
          <QueryBody
            isLoading={reply.isPending}
            isError={reply.isError}
            isEmpty={!reply.data?.length}
            onRetry={() => reply.refetch()}
            label="first reply trend"
          >
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={reply.data ?? []}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatSeconds(v)} />
                <Tooltip formatter={(v: number) => formatSeconds(v)} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </QueryBody>
        </ChartCard>
        <ChartCard title="Resolution trend" description="Last 7 days">
          <QueryBody
            isLoading={res.isPending}
            isError={res.isError}
            isEmpty={!res.data?.length}
            onRetry={() => res.refetch()}
            label="resolution trend"
          >
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={res.data ?? []}>
                <defs>
                  <linearGradient id="resGrad" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="hsl(142 76% 45%)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(142 76% 45%)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatSeconds(v)} />
                <Tooltip formatter={(v: number) => formatSeconds(v)} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Area type="monotone" dataKey="value" stroke="hsl(142 76% 45%)" fill="url(#resGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </QueryBody>
        </ChartCard>
      </div>
    </>
  );
}
