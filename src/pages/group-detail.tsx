import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { PageLoader } from "@/components/spinner";
import { Button } from "@/components/ui/button";
import { ChartCard } from "@/components/chart-card";
import { KpiCard } from "@/components/kpi-card";
import { PageHeader } from "@/components/page-header";
import { formatPercent, formatSeconds } from "@/lib/utils";
import { useScope } from "@/stores/auth";

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const scope = useScope();
  const { data, isLoading } = useQuery({
    queryKey: ["group", id],
    queryFn: () => api.getGroup(id!),
    enabled: !!id,
  });
  const tickets = useQuery({
    queryKey: ["tickets", scope, id, "page1"],
    queryFn: () => api.listTickets(scope, { group_id: id!, page_size: 8 }),
    enabled: !!id,
  });

  if (isLoading) return <PageLoader />;
  if (!data) return <div className="text-sm text-muted-foreground">Group not found.</div>;

  const { group, trend } = data;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/groups"><ArrowLeft className="size-4" />Back to groups</Link>
      </Button>
      <PageHeader title={group.name} description={group.note} />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Open tickets" value={data.open_tickets} />
        <KpiCard title="SLA breach rate" value={formatPercent(data.sla_breach_rate)} />
        <KpiCard title="Avg 1st reply" value={formatSeconds(data.avg_first_reply_secs)} />
        <KpiCard title="Avg resolution" value={formatSeconds(data.avg_resolution_secs)} />
      </div>

      <ChartCard title="Ticket trend" description="Last 14 days">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={trend}>
            <defs>
              <linearGradient id="gG" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
            <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" fill="url(#gG)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Latest tickets" description="Most recently updated in this group">
        <div className="space-y-2">
          {(tickets.data?.rows ?? []).map((t) => (
            <Link
              to={`/tickets/${t.id}`}
              key={t.id}
              className="flex items-center gap-3 border rounded-md p-2 text-sm hover:bg-muted/40"
            >
              <span className="font-mono text-xs text-muted-foreground w-14">#{t.number}</span>
              <span className="flex-1 truncate">{t.title}</span>
              <span className="text-xs text-muted-foreground">{t.owner_name ?? "Unassigned"}</span>
            </Link>
          ))}
        </div>
      </ChartCard>
    </div>
  );
}
