import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { useScope } from "@/stores/auth";
import { PageHeader } from "@/components/page-header";
import { QueryBody } from "@/components/data-error";
import { Card, CardContent } from "@/components/ui/card";
import { ChartCard } from "@/components/chart-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { fullName } from "@/lib/mock-data";
import { formatPercent, formatSeconds, formatNumber } from "@/lib/utils";

export default function PerformancePage() {
  const scope = useScope();
  const agents = useQuery({ queryKey: ["agents", scope], queryFn: () => api.listAgents(scope) });
  const reply = useQuery({ queryKey: ["trend", "reply", 14], queryFn: () => api.firstReplyTrend(14) });
  const res = useQuery({ queryKey: ["trend", "res", 14], queryFn: () => api.resolutionTimeTrend(14) });

  const ranked = (agents.data ?? []).slice().sort((a, b) => b.closed_this_week - a.closed_this_week).slice(0, 10);
  const chartData = ranked.map((s) => ({
    name: s.agent.firstname,
    closed: s.closed_this_week,
    breached: s.breached,
  }));

  return (
    <div className="space-y-4">
      <PageHeader title="Performance" description="Agent ranking, KPI trends, and comparisons." />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="First reply trend" description="Global avg, last 14d">
          <QueryBody
            isLoading={reply.isLoading}
            isError={reply.isError}
            isEmpty={!reply.data?.length}
            onRetry={() => reply.refetch()}
            label="first reply trend"
          >
          <ResponsiveContainer width="100%" height={240}>
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
        <ChartCard title="Resolution trend" description="Global avg, last 14d">
          <QueryBody
            isLoading={res.isLoading}
            isError={res.isError}
            isEmpty={!res.data?.length}
            onRetry={() => res.refetch()}
            label="resolution trend"
          >
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={res.data ?? []}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatSeconds(v)} />
              <Tooltip formatter={(v: number) => formatSeconds(v)} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Line type="monotone" dataKey="value" stroke="hsl(142 76% 45%)" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
          </QueryBody>
        </ChartCard>
      </div>

      <ChartCard title="Top 10 agents (closed vs breached this week)">
        <QueryBody
          isLoading={agents.isLoading}
          isError={agents.isError}
          isEmpty={!chartData.length}
          onRetry={() => agents.refetch()}
          label="agent ranking"
          emptyMessage="No agent activity this week."
        >
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
            <Bar dataKey="closed" fill="hsl(142 76% 45%)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="breached" fill="hsl(0 84% 60%)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        </QueryBody>
      </ChartCard>

      <Card>
        <CardContent className="pt-6">
          <QueryBody
            isLoading={agents.isLoading}
            isError={agents.isError}
            isEmpty={!chartData.length}
            onRetry={() => agents.refetch()}
            label="agent ranking"
            emptyMessage="No agent activity this week."
          >
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Closed (7d)</TableHead>
                  <TableHead className="text-right">Breached</TableHead>
                  <TableHead className="text-right">Avg resolution</TableHead>
                  <TableHead className="text-right">Breach rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ranked.map((s, i) => (
                  <TableRow key={s.agent.id}>
                    <TableCell className="text-muted-foreground font-mono">{i + 1}</TableCell>
                    <TableCell className="flex items-center gap-2">
                      <UserAvatar user={s.agent} size="sm" />
                      {fullName(s.agent)}
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatNumber(s.closed_this_week)}</TableCell>
                    <TableCell className="text-right">
                      {s.breached > 0 ? <Badge variant="destructive">{s.breached}</Badge> : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatSeconds(s.avg_resolution_secs)}</TableCell>
                    <TableCell className="text-right font-mono">{formatPercent(s.sla_breach_rate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          </QueryBody>
        </CardContent>
      </Card>
    </div>
  );
}
