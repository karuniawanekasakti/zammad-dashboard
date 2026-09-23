import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { format } from "date-fns";
import { Lock, Mail, MessageSquare, Phone } from "lucide-react";
import { api } from "@/lib/api";
import { slaDeadline, slaProgress, slaRemainingMs, slaStatus, slaVerdictsAvailable } from "@/lib/sla-deadline";
import { mergeSlaTimeline, type SlaTimelineEntry } from "@/lib/sla-timeline";
import { useScope } from "@/stores/auth";
import { ManagerMetricsSummary } from "@/components/sla/manager-metrics-summary";
import { SlaDashboardList } from "@/components/sla/sla-dashboard-list";
import { MilestoneProgressBar } from "@/components/milestone-progress-bar";
import { VirtualizedArticleList, appendArticlePage } from "@/components/tickets/virtualized-article-list";
import { PageLoader } from "@/components/spinner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TicketArticle, TicketHistory } from "@/types";

const ARTICLE_ICONS = {
  email: Mail,
  phone: Phone,
  note: Lock,
  web: MessageSquare,
} as const;

export interface SlaDetailPageProps {
  isInline?: boolean;
  ticketId?: string;
}

export default function SlaDetailPage({ isInline = false, ticketId }: SlaDetailPageProps) {
  const [mode, setMode] = useState("detail");
  // Articles stream in pages: the first page rides along with the ticket, and
  // each "Load More" appends the next page without dropping what is on screen.
  const [articles, setArticles] = useState<TicketArticle[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const { ticketId: routeId } = useParams<{ ticketId: string }>();
  const id = ticketId ?? routeId;
  const scope = useScope();
  const ticket = useQuery({ queryKey: ["ticket", id], queryFn: () => api.getTicket(id!), enabled: !!id, refetchInterval: 30_000 });
  const history = useQuery({ queryKey: ["ticket-history", id], queryFn: () => api.getTicketHistory(id!), enabled: !!id });
  const monitor = useQuery({ queryKey: ["sla", "monitor", scope], queryFn: () => api.listSlaMonitor(scope), refetchInterval: 30_000 });

  const historyRows = history.data;
  useEffect(() => {
    setArticles(ticket.data?.articles ?? []);
  }, [ticket.data]);

  // The audit trail a team lead reads first: SLA events only, interleaved order
  // preserved from the merged timeline so pause/resume stay in sequence.
  const slaEntries = useMemo(
    () => mergeSlaTimeline(historyRows ?? [], articles).filter((entry) => entry.type !== "article"),
    [historyRows, articles],
  );

  if (ticket.isLoading || monitor.isLoading || history.isLoading) return <PageLoader />;
  if (!ticket.data) return <div className="text-sm text-muted-foreground">Ticket not found.</div>;

  const row = ticket.data.ticket;
  const current = new Date();
  const verdictsAvailable = slaVerdictsAvailable(monitor.data?.freshness);
  const remainingMs = slaRemainingMs(row, current);
  const total = ticket.data.total ?? ticket.data.articles.length ?? 0;
  const hasMore = articles.length < total;

  const loadMore = () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    api
      .getTicketArticles(row.id, articles.length)
      .then((page) => setArticles((current) => appendArticlePage(current, page)))
      .finally(() => setLoadingMore(false));
  };

  // First Response and Resolution run on independent clocks, so each bar gets
  // its own milestone view of the ticket rather than one shared countdown.
  const slaHistory: TicketHistory[] = [
    ...(historyRows ?? []),
    ...articles
      .filter((article) => !article.internal && article.author_role !== "system")
      .map((article) => ({
        id: `${article.id}-sla`,
        type: article.author_role === "customer" ? "customer_reply" : "agent_reply",
        created_at: article.created_at,
      })),
  ];
  const firstResponseSla = {
    ...row,
    escalation_at: row.first_response_escalation_at,
    update_escalation_at: null,
    close_escalation_at: null,
    update_diff_in_min: null,
    close_diff_in_min: null,
    close_breached: false,
  };
  const resolutionSla = {
    ...row,
    escalation_at: row.close_escalation_at,
    first_response_escalation_at: null,
    update_escalation_at: null,
    first_response_diff_in_min: null,
    update_diff_in_min: null,
    first_response_breached: false,
  };
  const firstResponseCurrent = row.first_response_at ? new Date(row.first_response_at) : current;
  const resolutionCurrent = row.close_at || row.closed_at ? new Date(row.close_at ?? row.closed_at!) : current;

  const renderArticle = (article: TicketArticle) => {
    const Icon = ARTICLE_ICONS[article.type];
    return (
      <article data-article-id={article.id} key={article.id} className="rounded-lg border p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">{article.author_name}</span>
            <Badge variant={article.author_role === "customer" ? "secondary" : "default"} className="capitalize">
              {article.author_role}
            </Badge>
            {article.internal && (
              <Badge variant="warning" className="gap-1">
                <Lock className="size-3" /> Internal
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className="size-3.5" />
            <span>{format(new Date(article.created_at), "PPp")}</span>
          </div>
        </div>
        <div className="text-sm text-muted-foreground">{article.body}</div>
      </article>
    );
  };

  const renderSlaEntry = (entry: SlaTimelineEntry) => (
    <Card key={entry.id}>
      <CardContent className="flex items-center justify-between gap-3 py-3 text-sm">
        <span className="font-medium">{entry.label}</span>
        <time dateTime={entry.timestamp} className="text-xs text-muted-foreground">
          {format(new Date(entry.timestamp), "PPp")}
        </time>
      </CardContent>
    </Card>
  );

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
          <MilestoneProgressBar
            label="First Response"
            history={slaHistory}
            deadline={verdictsAvailable ? slaDeadline(firstResponseSla) : null}
            now={firstResponseCurrent}
            status={verdictsAvailable ? slaStatus(firstResponseSla, firstResponseCurrent) : "no_sla"}
            progressPct={verdictsAvailable ? slaProgress(firstResponseSla, firstResponseCurrent) : 0}
            ticketCreated={new Date(row.zammad_created_at)}
          />
          <MilestoneProgressBar
            label="Resolution"
            history={slaHistory}
            deadline={verdictsAvailable ? slaDeadline(resolutionSla) : null}
            now={resolutionCurrent}
            status={verdictsAvailable ? slaStatus(resolutionSla, resolutionCurrent) : "no_sla"}
            progressPct={verdictsAvailable ? slaProgress(resolutionSla, resolutionCurrent) : 0}
            ticketCreated={new Date(row.zammad_created_at)}
          />
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
            <Tabs defaultValue="sla">
              <TabsList aria-label="Activity view">
                <TabsTrigger value="sla">SLA Events Only</TabsTrigger>
                <TabsTrigger value="full">Full History</TabsTrigger>
              </TabsList>
              <TabsContent value="sla" className="space-y-3">
                {slaEntries.length ? (
                  slaEntries.map(renderSlaEntry)
                ) : (
                  <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">No SLA events recorded.</div>
                )}
              </TabsContent>
              <TabsContent value="full" className="space-y-3">
                <VirtualizedArticleList
                  articles={articles}
                  total={total}
                  hasMore={hasMore}
                  loadingMore={loadingMore}
                  onLoadMore={loadMore}
                  renderArticle={renderArticle}
                />
              </TabsContent>
            </Tabs>
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
