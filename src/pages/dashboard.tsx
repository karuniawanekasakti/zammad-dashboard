import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { ChartCard } from "@/components/chart-card";
import { PageHeader } from "@/components/page-header";
import { RoleBadge, StateBadge, PriorityBadge } from "@/components/status-badges";
import { SlaBadge } from "@/components/sla-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserAvatar } from "@/components/user-avatar";
import { formatPercent, formatSeconds, formatNumber } from "@/lib/utils";
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

export default function DashboardPage() {
  const user = useAuth((s) => s.user)!;
  const scope = useScope();

  const allGroups = useQuery({ queryKey: ["groups-filter"], queryFn: () => api.listAllGroupsForFilter() });
  const allAgents = useQuery({ queryKey: ["agents-filter"], queryFn: () => api.listAllAgentsForFilter() });

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

  const showFilters = user.role !== "agent";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${user.firstname}`}
        description="Role-aware real-time overview of your helpdesk."
        action={<RoleBadge role={user.role} />}
      />

      {showFilters && (
        <div className="flex flex-wrap gap-3">
          <Select value={groupFilter} onValueChange={(v) => { setGroupFilter(v); setAgentFilter("all"); }}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All groups" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All groups</SelectItem>
              {(allGroups.data ?? []).map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={agentFilter} onValueChange={setAgentFilter}>
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
      )}

      {user.role === "admin" && <AdminDashboard scope={filteredScope} agentFilter={agentFilter} />}
      {user.role === "team_lead" && <TeamLeadDashboard scope={filteredScope} agentFilter={agentFilter} />}
      {user.role === "project_manager" && <ProjectManagerDashboard scope={filteredScope} agentFilter={agentFilter} />}
      {user.role === "agent" && <AgentDashboard scope={scope} userId={user.id} />}
    </div>
  );
}

// ---------- Admin Dashboard -------------------------------------------------
function AdminDashboard({ scope, agentFilter }: { scope: ReturnType<typeof useScope>; agentFilter: string }) {
  const kpi = useQuery({ queryKey: ["kpi", "admin", scope, agentFilter], queryFn: () => api.kpiSummary(scope) });
  const volume = useQuery({ queryKey: ["trend", "volume", 30], queryFn: () => api.ticketVolumeTrend(30) });
  const breach = useQuery({ queryKey: ["trend", "breach", 30], queryFn: () => api.slaBreachTrend(30) });
  const agents = useQuery({ queryKey: ["agents", scope], queryFn: () => api.listAgents(scope) });
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: () => api.listNotifications() });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.getSystemSettings() });

  const top = (agents.data ?? [])
    .filter((s) => agentFilter === "all" || s.agent.id === agentFilter)
    .slice(0, 6);
  const recent = (notifications.data ?? []).slice(0, 5);

  return (
    <>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Open tickets"
          value={formatNumber(kpi.data?.total_open_tickets ?? 0)}
          helper={`${formatNumber(kpi.data?.new_today ?? 0)} new today`}
          icon={TicketIcon}
          trend={{ value: 3.2, direction: "down", goodIs: "down" }}
        />
        <KpiCard
          title="Agents online"
          value={`${kpi.data?.agents_online ?? 0} / ${kpi.data?.total_agents ?? 0}`}
          helper="Active in last 15 min"
          icon={UserCheck}
          iconClassName="bg-emerald-500/15 text-emerald-500"
        />
        <KpiCard
          title="SLA breach rate"
          value={formatPercent(kpi.data?.sla_breach_rate ?? 0)}
          helper="Across last 30 days"
          icon={AlertTriangle}
          iconClassName="bg-destructive/15 text-destructive"
          trend={{ value: 1.4, direction: "down", goodIs: "down" }}
        />
        <KpiCard
          title="Avg resolution"
          value={formatSeconds(kpi.data?.avg_resolution_secs ?? 0)}
          helper="Last 7 days"
          icon={Timer}
          iconClassName="bg-amber-500/15 text-amber-500"
          trend={{ value: 4.8, direction: "up", goodIs: "down" }}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
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
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Agent workload" description="Top 6 agents by open tickets" className="lg:col-span-2">
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
        </ChartCard>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent alerts</CardTitle>
            <CardDescription>Latest notifications feed</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
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
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3 text-sm">
            <Activity className="size-4 text-emerald-500" />
            <div>
              <div className="font-medium">Sync health</div>
              <div className="text-xs text-muted-foreground">
                Last sync{" "}
                {settings.data?.last_sync_at
                  ? formatDistanceToNow(new Date(settings.data.last_sync_at), { addSuffix: true })
                  : "—"}{" "}
                · Zammad API:{" "}
                {settings.data?.zammad_online ? (
                  <span className="text-emerald-500 font-medium">Online</span>
                ) : (
                  <span className="text-destructive font-medium">Offline</span>
                )}
              </div>
            </div>
          </div>
          <Badge variant="success">All systems operational</Badge>
        </CardContent>
      </Card>
    </>
  );
}

// ---------- Team Lead Dashboard --------------------------------------------
function TeamLeadDashboard({ scope, agentFilter }: { scope: ReturnType<typeof useScope>; agentFilter: string }) {
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

  return (
    <>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Group open tickets" value={formatNumber(kpi.data?.total_open_tickets ?? 0)} icon={TicketIcon} />
        <KpiCard title="Agents in group" value={`${agents.data?.length ?? 0}`} helper="Active agents" icon={UsersIcon} />
        <KpiCard title="Group SLA breach" value={formatPercent(kpi.data?.sla_breach_rate ?? 0)} icon={AlertTriangle} iconClassName="bg-destructive/15 text-destructive" />
        <KpiCard title="Avg first reply" value={formatSeconds(kpi.data?.avg_first_reply_secs ?? 0)} icon={Clock} />
      </div>

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
          <div className="space-y-2">
            {(atRisk.data ?? []).slice(0, 6).map((t) => (
              <div key={t.id} className="flex items-center gap-2 border rounded-md p-2 text-sm">
                <div className="font-mono text-xs text-muted-foreground w-12">#{t.number}</div>
                <div className="flex-1 truncate">{t.title}</div>
                <SlaBadge status={t.sla_status} remainingSecs={t.first_response_remaining_secs} />
              </div>
            ))}
            {(atRisk.data ?? []).length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-6">No at-risk tickets 🎉</div>
            )}
          </div>
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
function ProjectManagerDashboard({ scope, agentFilter }: { scope: ReturnType<typeof useScope>; agentFilter: string }) {
  const kpi = useQuery({ queryKey: ["kpi", "pm", scope, agentFilter], queryFn: () => api.kpiSummary(scope) });
  const resTrend = useQuery({ queryKey: ["trend", "res", 14], queryFn: () => api.resolutionTimeTrend(14) });
  const tickets = useQuery({
    queryKey: ["tickets", scope, "pm", agentFilter],
    queryFn: () => api.listTickets(scope, { owner_id: agentFilter, page: 1, page_size: 200 }),
  });

  const byTag = (() => {
    const map = new Map<string, number>();
    (tickets.data?.rows ?? []).forEach((t) => t.tags.forEach((tag) => map.set(tag, (map.get(tag) ?? 0) + 1)));
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  })();

  const byPriority = (() => {
    const rows = tickets.data?.rows ?? [];
    const groups = ["low", "normal", "high", "very high"] as const;
    return groups.map((p) => ({
      name: p,
      new: rows.filter((t) => t.priority === p && t.state === "new").length,
      open: rows.filter((t) => t.priority === p && t.state === "open").length,
      pending: rows.filter((t) => t.priority === p && t.state === "pending").length,
    }));
  })();

  const totalClosed = (tickets.data?.rows ?? []).filter((t) => t.state === "closed").length;

  return (
    <>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Total tickets" value={formatNumber(tickets.data?.total ?? 0)} icon={TicketIcon} />
        <KpiCard title="Resolved today" value={formatNumber(kpi.data?.total_closed_today ?? 0)} icon={CheckCircle2} iconClassName="bg-emerald-500/15 text-emerald-500" />
        <KpiCard title="SLA breach rate" value={formatPercent(kpi.data?.sla_breach_rate ?? 0)} icon={Gauge} />
        <KpiCard title="Reopen rate" value={formatPercent(kpi.data?.reopen_rate ?? 0)} icon={RotateCcw} />
      </div>

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
        <ChartCard title="Priority distribution" description="Active tickets by priority">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byPriority}>
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

// ---------- Agent Dashboard -------------------------------------------------
function AgentDashboard({ scope, userId }: { scope: ReturnType<typeof useScope>; userId: string }) {
  const nav = useNavigate();
  const kpi = useQuery({ queryKey: ["kpi", "agent", userId], queryFn: () => api.kpiSummary(scope) });
  const mine = useQuery({
    queryKey: ["tickets", "mine", userId],
    queryFn: () => api.listTickets(scope, { state: "open", page_size: 10 }),
  });
  const reply = useQuery({ queryKey: ["trend", "reply", 7], queryFn: () => api.firstReplyTrend(7) });
  const res = useQuery({ queryKey: ["trend", "res", 7], queryFn: () => api.resolutionTimeTrend(7) });

  return (
    <>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard title="My open tickets" value={formatNumber(kpi.data?.total_open_tickets ?? 0)} icon={TicketIcon} />
        <KpiCard title="My at-risk" value={formatNumber(kpi.data?.at_risk ?? 0)} icon={AlertTriangle} iconClassName="bg-warning/15 text-warning" />
        <KpiCard title="Avg 1st reply" value={formatSeconds(kpi.data?.avg_first_reply_secs ?? 0)} icon={Clock} />
        <KpiCard title="Reopen rate" value={formatPercent(kpi.data?.reopen_rate ?? 0)} icon={RotateCcw} />
      </div>

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
                <TableHead>Priority</TableHead>
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
                  <TableCell><PriorityBadge priority={t.priority} /></TableCell>
                  <TableCell><SlaBadge status={t.sla_status} remainingSecs={t.first_response_remaining_secs} /></TableCell>
                  <TableCell><StateBadge state={t.state} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(t.zammad_updated_at), { addSuffix: true })}
                  </TableCell>
                </TableRow>
              ))}
              {(mine.data?.rows ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    All caught up! ✨
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="First reply trend" description="Last 7 days">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={reply.data ?? []}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatSeconds(v)} />
              <Tooltip formatter={(v: number) => formatSeconds(v)} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Resolution trend" description="Last 7 days">
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
        </ChartCard>
      </div>
    </>
  );
}
