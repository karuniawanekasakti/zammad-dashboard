import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { PageLoader } from "@/components/spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { KpiCard } from "@/components/kpi-card";
import { ChartCard } from "@/components/chart-card";
import { PageHeader } from "@/components/page-header";
import { UserAvatar } from "@/components/user-avatar";
import { fullName } from "@/lib/mock-data";
import { formatPercent, formatSeconds } from "@/lib/utils";
import { RoleBadge } from "@/components/status-badges";

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ["agent", id],
    queryFn: () => api.getAgent(id!),
    enabled: !!id,
  });
  const reply = useQuery({ queryKey: ["trend", "reply", 14], queryFn: () => api.firstReplyTrend(14) });
  const res = useQuery({ queryKey: ["trend", "res", 14], queryFn: () => api.resolutionTimeTrend(14) });

  if (isLoading) return <PageLoader />;
  if (!data) return <div className="text-sm text-muted-foreground">Agent not found.</div>;

  const { agent } = data;
  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/agents"><ArrowLeft className="size-4" />Back to agents</Link>
      </Button>

      <Card>
        <CardContent className="pt-6 flex items-center gap-4">
          <UserAvatar user={agent} size="lg" />
          <div className="flex-1">
            <div className="text-xl font-semibold">{fullName(agent)}</div>
            <div className="text-sm text-muted-foreground">{agent.email}</div>
          </div>
          <RoleBadge role={agent.role} />
        </CardContent>
      </Card>

      <PageHeader title="Performance" description="30-day rolling KPI overview" />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Open tickets" value={data.open_tickets} />
        <KpiCard title="SLA breach rate" value={formatPercent(data.sla_breach_rate)} />
        <KpiCard title="Avg first reply" value={formatSeconds(data.avg_first_reply_secs)} />
        <KpiCard title="Closed this week" value={data.closed_this_week} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="First reply trend" description="Last 14 days">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={reply.data ?? []}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatSeconds(v)} />
              <Tooltip formatter={(v: number) => formatSeconds(v)} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Resolution trend" description="Last 14 days">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={res.data ?? []}>
              <defs>
                <linearGradient id="g1" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="hsl(142 76% 45%)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(142 76% 45%)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatSeconds(v)} />
              <Tooltip formatter={(v: number) => formatSeconds(v)} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Area type="monotone" dataKey="value" stroke="hsl(142 76% 45%)" fill="url(#g1)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}
