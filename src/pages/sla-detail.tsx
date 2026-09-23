import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { slaDeadline, slaProgress, slaRemainingMs, slaStatus, slaVerdictsAvailable } from "@/lib/sla-deadline";
import { useScope } from "@/stores/auth";
import { ManagerMetricsSummary } from "@/components/sla/manager-metrics-summary";
import { SlaDashboardList } from "@/components/sla/sla-dashboard-list";
import { MilestoneProgressBar } from "@/components/milestone-progress-bar";
import { PageLoader } from "@/components/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
export interface SlaDetailPageProps {
  isInline?: boolean;
  ticketId?: string;
}

export default function SlaDetailPage({ isInline = false, ticketId }: SlaDetailPageProps) {
  const [mode, setMode] = useState("detail");
  const { ticketId: routeId } = useParams<{ ticketId: string }>();
  const id = ticketId ?? routeId;
  const scope = useScope();
  const ticket = useQuery({ queryKey: ["ticket", id], queryFn: () => api.getTicket(id!), enabled: !!id, refetchInterval: 30_000 });
  const history = useQuery({ queryKey: ["ticket-history", id], queryFn: () => api.getTicketHistory(id!), enabled: !!id });
  const monitor = useQuery({ queryKey: ["sla", "monitor", scope], queryFn: () => api.listSlaMonitor(scope), refetchInterval: 30_000 });

  if (ticket.isLoading || monitor.isLoading || history.isLoading) return <PageLoader />;
  if (!ticket.data) return <div className="text-sm text-muted-foreground">Ticket not found.</div>;

  const row = ticket.data.ticket;
  const current = new Date();
  const verdictsAvailable = slaVerdictsAvailable(monitor.data?.freshness);
  const remainingMs = slaRemainingMs(row, current);
  const sla = (
    <div className="space-y-4">
      {!verdictsAvailable && (
        <Card className="border-amber-500/50 bg-amber-500/5">
          <CardContent className="py-4 text-sm font-medium">SLA verdicts are unavailable — the synchronized dataset is not up to date.</CardContent>
        </Card>
      )}
      {!isInline && monitor.data && <ManagerMetricsSummary monitor={monitor.data} scope={scope.role} mode="split" />}
      <Card>
        <CardHeader><CardTitle className="text-base">SLA Detail · #{row.number}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between text-sm"><span>Status</span><span className="font-medium capitalize">{verdictsAvailable ? slaStatus(row, current).replace("_", " ") : "unavailable"}</span></div>
          <div className="flex items-center justify-between text-sm"><span>Remaining</span><span className="font-medium">{verdictsAvailable && remainingMs != null ? `${Math.round(remainingMs / 60_000)} min` : "Unavailable"}</span></div>
          <MilestoneProgressBar label="Current milestone" history={history.data ?? []} deadline={slaDeadline(row)} now={current} status={slaStatus(row, current)} progressPct={slaProgress(row, current)} ticketCreated={new Date(row.zammad_created_at)} />
        </CardContent>
      </Card>
    </div>
  );

  if (isInline) return sla;

  return (
    <Tabs value={mode} onValueChange={setMode}>
      <TabsList aria-label="SLA view mode">
        <TabsTrigger value="detail">Detail</TabsTrigger>
        <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
      </TabsList>
      <TabsContent value="detail">
        <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
          <aside>{sla}</aside>
          <main className="space-y-3">
            <h2 className="text-lg font-semibold">Conversation</h2>
            {ticket.data.articles.map((article) => (
              <Card key={article.id}>
                <CardContent className="space-y-2 py-4">
                  <div className="flex justify-between gap-3 text-sm"><span className="font-medium">{article.author_name}</span><span className="text-muted-foreground">{new Date(article.created_at).toLocaleString()}</span></div>
                  <div className="text-sm text-muted-foreground">{article.body}</div>
                </CardContent>
              </Card>
            ))}
          </main>
        </div>
      </TabsContent>
      <TabsContent value="dashboard" className="space-y-4">
        {monitor.data && <ManagerMetricsSummary monitor={monitor.data} scope={scope.role} />}
        {monitor.data && <SlaDashboardList tickets={monitor.data.tickets} scope={scope.role} />}
      </TabsContent>
    </Tabs>
  );
}

export const SlaDetailRoute = SlaDetailPage;
