import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { format } from "date-fns";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, ExternalLink, Lock, Mail, MessageSquare, Phone, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { slaDeadline, slaProgress, slaRemainingMs, slaStatus, slaVerdictsAvailable } from "@/lib/sla-deadline";
import { mergeSlaTimeline, type SlaTimelineEntry } from "@/lib/sla-timeline";
import { useScope } from "@/stores/auth";
import { MilestoneProgressBar } from "@/components/milestone-progress-bar";
import { VirtualizedArticleList, appendArticlePage } from "@/components/tickets/virtualized-article-list";
import { PageLoader } from "@/components/spinner";
import { SeverityBadge, StateBadge } from "@/components/status-badges";
import { SlaBadge } from "@/components/sla-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SlaPolicy, SlaStatus, Ticket, TicketArticle, TicketHistory } from "@/types";

const ARTICLE_ICONS = { email: Mail, phone: Phone, note: Lock, web: MessageSquare } as const;
const FALLBACK_ZAMMAD_BASE = (import.meta.env.VITE_ZAMMAD_BASE_URL ?? "").replace(/\/$/, "");

export interface SlaDetailPageProps {
  isInline?: boolean;
  ticketId?: string;
}

function formatDate(value: string | null | undefined) {
  return value ? format(new Date(value), "PPp") : "Not recorded";
}

function formatMinutes(value: number | null | undefined) {
  if (value == null) return "Not available";
  const absolute = Math.abs(value);
  const hours = Math.floor(absolute / 60);
  const minutes = Math.round(absolute % 60);
  return `${value < 0 ? "Over by " : "Within by "}${hours ? `${hours}h ` : ""}${minutes}m`;
}

function matchesPolicy(policy: SlaPolicy, ticket: Ticket) {
  const entries = Object.entries(policy.condition);
  if (!entries.length) return true;
  if (entries.length !== 1 || entries[0][0] !== "ticket.priority_id") return false;
  const priority = entries[0][1].value;
  if (priority == null) return false;
  return Array.isArray(priority) ? priority.map(String).includes(ticket.priority_id) : String(priority) === ticket.priority_id;
}

function statusExplanation(status: SlaStatus, ticket: Ticket, remainingMs: number | null) {
  if (status === "breached") {
    if (ticket.first_response_breached || (ticket.first_response_diff_in_min ?? 0) < 0) return "The first response target was missed. Review the response milestone and pause history below.";
    if ((ticket.update_diff_in_min ?? 0) < 0) return "The update target was missed. The calculation below shows the recorded breach margin.";
    if (ticket.close_breached || (ticket.close_diff_in_min ?? 0) < 0) return "The resolution target was missed. The calculation below shows the recorded breach margin.";
    return "The next active SLA deadline has passed without the required milestone being completed.";
  }
  if (status === "critical" || status === "warning") return `The ticket is still within SLA, but only ${formatDuration(remainingMs)} remains before the next deadline.`;
  if (status === "closed_on_time") return "The ticket reached its terminal milestone before the applicable SLA deadline.";
  if (status === "no_sla") return "No active SLA deadline is present for this ticket, so compliance cannot be evaluated.";
  return `The ticket is within SLA with ${formatDuration(remainingMs)} remaining before the next deadline.`;
}

function formatDuration(value: number | null) {
  if (value == null) return "no active countdown";
  const minutes = Math.max(0, Math.round(Math.abs(value) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-start justify-between gap-4 border-b py-2.5 last:border-0"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{children}</dd></div>;
}

export default function SlaDetailPage({ isInline = false, ticketId }: SlaDetailPageProps) {
  const { ticketId: routeId } = useParams<{ ticketId: string }>();
  const [articles, setArticles] = useState<TicketArticle[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [articlesError, setArticlesError] = useState(false);
  const id = ticketId ?? routeId;
  const scope = useScope();
  const ticket = useQuery({ queryKey: ["ticket", id], queryFn: () => api.getTicket(id!), enabled: !!id, refetchInterval: 30_000 });
  const history = useQuery({ queryKey: ["ticket-history", id], queryFn: () => api.getTicketHistory(id!), enabled: !!id });
  const monitor = useQuery({ queryKey: ["sla", "monitor", scope], queryFn: () => api.listSlaMonitor(scope), refetchInterval: 30_000 });
  const policies = useQuery({ queryKey: ["sla", "policies"], queryFn: () => api.listSlaPolicies() });
  const config = useQuery({ queryKey: ["system", "public-config"], queryFn: () => api.getPublicConfig(), enabled: !isInline });

  useEffect(() => setArticles(ticket.data?.articles ?? []), [ticket.data]);
  const timeline = useMemo(() => mergeSlaTimeline(history.data ?? [], articles), [history.data, articles]);
  const slaEntries = timeline.filter((entry) => entry.type !== "article");

  if (ticket.isLoading || monitor.isLoading || history.isLoading) return <PageLoader />;
  // A failed request is not a missing ticket: report the failure instead of the
  // not-found state, which a genuine miss (data === null) alone should reach.
  if (ticket.isError) return <div className="text-sm text-destructive" role="alert">Unable to load this ticket. The request failed — please retry.</div>;
  if (!ticket.data) return <div className="text-sm text-muted-foreground">Ticket not found.</div>;

  const row = ticket.data.ticket;
  const now = new Date();
  const verdictsAvailable = slaVerdictsAvailable(monitor.data?.freshness);
  const status = verdictsAvailable ? slaStatus(row, now) : "no_sla";
  const remainingMs = verdictsAvailable ? slaRemainingMs(row, now) : null;
  const total = ticket.data.total ?? ticket.data.articles.length;
  const hasMore = articles.length < total;
  const policy = policies.data?.find((candidate) => matchesPolicy(candidate, row));
  const zammadBase = (config.data?.zammad_base_url ?? FALLBACK_ZAMMAD_BASE).replace(/\/$/, "");

  const loadMore = () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setArticlesError(false);
    api
      .getTicketArticles(row.id, articles.length)
      .then((page) => setArticles((current) => appendArticlePage(current, page)))
      // A rejected page fetch must not look like an empty next page: surface it
      // and always clear the loading flag so "Load More" stays usable.
      .catch(() => setArticlesError(true))
      .finally(() => setLoadingMore(false));
  };

  const slaHistory: TicketHistory[] = [
    ...(history.data ?? []),
    ...articles.filter((article) => !article.internal && article.author_role !== "system").map((article) => ({
      id: `${article.id}-sla`, type: article.author_role === "customer" ? "customer_reply" : "agent_reply", created_at: article.created_at,
    })),
  ];
  const firstResponseSla = { ...row, escalation_at: row.first_response_escalation_at, update_escalation_at: null, close_escalation_at: null, update_diff_in_min: null, close_diff_in_min: null, close_breached: false };
  const resolutionSla = { ...row, escalation_at: row.close_escalation_at, first_response_escalation_at: null, update_escalation_at: null, first_response_diff_in_min: null, update_diff_in_min: null, first_response_breached: false };
  const firstResponseCurrent = row.first_response_at ? new Date(row.first_response_at) : now;
  const resolutionCurrent = row.close_at || row.closed_at ? new Date(row.close_at ?? row.closed_at!) : now;

  const renderArticle = (article: TicketArticle) => {
    const Icon = ARTICLE_ICONS[article.type];
    return <article data-article-id={article.id} key={article.id} className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-sm"><span className="font-medium">{article.author_name}</span><Badge variant={article.author_role === "customer" ? "secondary" : "default"} className="capitalize">{article.author_role}</Badge>{article.internal && <Badge variant="warning" className="gap-1"><Lock className="size-3" /> Internal</Badge>}</div><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="size-3.5" />{formatDate(article.created_at)}</div></div>
      <div className="text-sm text-muted-foreground">{article.body}</div>
    </article>;
  };

  const content = <div className="space-y-6">
    {history.isError && <div className="text-sm text-destructive" role="alert">Ticket history failed to load — SLA events shown here may be incomplete.</div>}
    {!verdictsAvailable && history.isPending && <div className="text-sm text-muted-foreground">Loading ticket history…</div>}
    {!verdictsAvailable && <Card className="border-amber-500/50 bg-amber-500/5"><CardContent className="flex gap-3 py-4 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" /><div><p className="font-medium">SLA verdict unavailable</p><p className="text-muted-foreground">The synchronized dataset is not up to date, so this page will not present a stale verdict as current.</p></div></CardContent></Card>}

    {!isInline && <div className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-3"><Button asChild variant="ghost" size="sm" className="-ml-3"><Link to={`/tickets/${row.id}`}><ArrowLeft /> Back to ticket</Link></Button><div><div className="mb-2 flex flex-wrap items-center gap-2"><span className="font-mono text-sm text-muted-foreground">#{row.number}</span><StateBadge state={row.state} /><SeverityBadge severity={row.severity} label={row.severity_label} /></div><h1 className="text-2xl font-bold tracking-tight">{row.title}</h1><p className="mt-1 text-sm text-muted-foreground">SLA lifecycle and investigation detail</p></div></div>
      {zammadBase && <Button asChild variant="outline"><a href={`${zammadBase}/#ticket/zoom/${row.zammad_id}`} target="_blank" rel="noreferrer">Open in Zammad <ExternalLink /></a></Button>}
    </div>}

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
      <Card className="overflow-hidden"><CardContent className="grid gap-6 p-6 md:grid-cols-[auto_1fr] md:items-center"><div className="flex size-16 items-center justify-center rounded-full bg-muted"><StatusIcon status={status} /></div><div><div className="mb-2 flex flex-wrap items-center gap-3"><h2 className="text-xl font-semibold">Overall SLA status</h2><SlaBadge status={status} remainingMs={remainingMs} /></div><p className="max-w-2xl text-sm leading-6 text-muted-foreground">{verdictsAvailable ? statusExplanation(status, row, remainingMs) : "Current status and explanation will return after a successful synchronization."}</p></div></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Ticket context</CardTitle></CardHeader><CardContent><dl className="text-sm"><DetailRow label="Customer">{row.customer_name}</DetailRow><DetailRow label="Group">{row.group_name}</DetailRow><DetailRow label="Owner">{row.owner_name ?? "Unassigned"}</DetailRow><DetailRow label="Created">{formatDate(row.zammad_created_at)}</DetailRow><DetailRow label="Updated">{formatDate(row.zammad_updated_at)}</DetailRow></dl></CardContent></Card>
    </div>

    <Card><CardHeader><CardTitle>Milestone performance</CardTitle><CardDescription>First Response and Resolution use independent clocks and recorded outcomes.</CardDescription></CardHeader><CardContent className="grid gap-6 lg:grid-cols-2"><MilestoneCard title="First Response" deadline={row.first_response_escalation_at} completedAt={row.first_response_at} result={formatMinutes(row.first_response_diff_in_min)} breached={row.first_response_breached || (row.first_response_diff_in_min ?? 0) < 0}><MilestoneProgressBar label="First Response" history={slaHistory} deadline={verdictsAvailable ? slaDeadline(firstResponseSla) : null} now={firstResponseCurrent} status={verdictsAvailable ? slaStatus(firstResponseSla, firstResponseCurrent) : "no_sla"} progressPct={verdictsAvailable ? slaProgress(firstResponseSla, firstResponseCurrent) : 0} ticketCreated={new Date(row.zammad_created_at)} /></MilestoneCard><MilestoneCard title="Resolution" deadline={row.close_escalation_at} completedAt={row.close_at ?? row.closed_at} result={formatMinutes(row.close_diff_in_min)} breached={row.close_breached || (row.close_diff_in_min ?? 0) < 0}><MilestoneProgressBar label="Resolution" history={slaHistory} deadline={verdictsAvailable ? slaDeadline(resolutionSla) : null} now={resolutionCurrent} status={verdictsAvailable ? slaStatus(resolutionSla, resolutionCurrent) : "no_sla"} progressPct={verdictsAvailable ? slaProgress(resolutionSla, resolutionCurrent) : 0} ticketCreated={new Date(row.zammad_created_at)} /></MilestoneCard></CardContent></Card>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
      <Card><CardHeader><CardTitle>SLA timeline</CardTitle><CardDescription>Recorded SLA transitions in chronological order.</CardDescription></CardHeader><CardContent>{history.isError ? <div className="rounded-lg border border-dashed border-destructive/50 p-6 text-sm text-destructive">SLA transitions could not be loaded.</div> : history.isPending ? <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Loading SLA transitions…</div> : slaEntries.length ? <ol className="relative ml-2 border-l">{slaEntries.map((entry) => <TimelineEntry key={entry.id} entry={entry} />)}</ol> : <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">No SLA events recorded.</div>}</CardContent></Card>
      <div className="space-y-6"><Card><CardHeader><CardTitle className="text-base">Calculation details</CardTitle></CardHeader><CardContent><dl className="text-sm"><DetailRow label="Active deadline">{formatDate(slaDeadline(row)?.toISOString())}</DetailRow><DetailRow label="First response elapsed">{row.first_response_in_min == null ? "Not completed" : `${row.first_response_in_min}m`}</DetailRow><DetailRow label="First response margin">{formatMinutes(row.first_response_diff_in_min)}</DetailRow><DetailRow label="Resolution elapsed">{row.close_in_min == null ? "Not completed" : `${row.close_in_min}m`}</DetailRow><DetailRow label="Resolution margin">{formatMinutes(row.close_diff_in_min)}</DetailRow><DetailRow label="Update margin">{formatMinutes(row.update_diff_in_min)}</DetailRow></dl></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Relevant SLA configuration</CardTitle><CardDescription>{policy ? "Policy candidate matched from the ticket fields available here; Zammad does not identify the applied policy on the ticket." : "No policy could be matched safely from the ticket fields available here."}</CardDescription></CardHeader><CardContent>{policy ? <dl className="text-sm"><DetailRow label="Policy candidate">{policy.name}</DetailRow><DetailRow label="Calendar">{policy.calendar_id ? `Calendar #${policy.calendar_id}` : "Default calendar"}</DetailRow><DetailRow label="First response target">{policy.first_response_time == null ? "Not set" : `${policy.first_response_time}m`}</DetailRow><DetailRow label="Update target">{policy.update_time == null ? "Not set" : `${policy.update_time}m`}</DetailRow><DetailRow label="Resolution target">{policy.solution_time == null ? "Not set" : `${policy.solution_time}m`}</DetailRow></dl> : policies.isError ? <p className="text-sm text-destructive" role="alert">SLA policies could not be loaded, so no policy candidate can be evaluated.</p> : <p className="text-sm text-muted-foreground">{policies.isLoading ? "Loading SLA policies…" : "Use the recorded deadlines and margins above as the authoritative calculation for this ticket."}</p>}</CardContent></Card></div>
    </div>

    <Card><CardHeader><CardTitle>Events and ticket history</CardTitle><CardDescription>Use SLA events for investigation, or inspect the complete conversation when context is needed.</CardDescription></CardHeader><CardContent><Tabs defaultValue="sla"><TabsList aria-label="Activity view"><TabsTrigger value="sla">SLA events</TabsTrigger><TabsTrigger value="full">Full history</TabsTrigger></TabsList><TabsContent value="sla" className="space-y-3 pt-3">{slaEntries.length ? slaEntries.map((entry) => <div key={entry.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"><span className="font-medium">{entry.label}</span><time dateTime={entry.timestamp} className="text-xs text-muted-foreground">{formatDate(entry.timestamp)}</time></div>) : <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{history.isError ? "SLA events could not be loaded." : history.isPending ? "Loading SLA events…" : "No SLA events recorded."}</div>}</TabsContent><TabsContent value="full" className="space-y-3 pt-3"><VirtualizedArticleList articles={articles} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} renderArticle={renderArticle} />{articlesError && <p className="mt-3 text-sm text-destructive" role="alert">Could not load more articles. The request failed — use “Load More” to retry.</p>}</TabsContent></Tabs></CardContent></Card>
  </div>;

  return isInline ? content : <main>{content}</main>;
}

function StatusIcon({ status }: { status: SlaStatus }) {
  if (status === "breached") return <ShieldAlert className="size-8 text-destructive" />;
  if (status === "warning" || status === "critical") return <AlertTriangle className="size-8 text-amber-600" />;
  if (status === "no_sla") return <Clock3 className="size-8 text-muted-foreground" />;
  return <CheckCircle2 className="size-8 text-emerald-600" />;
}

function MilestoneCard({ title, deadline, completedAt, result, breached, children }: { title: string; deadline: string | null; completedAt: string | null; result: string; breached: boolean; children: ReactNode }) {
  return <section className="space-y-4 rounded-lg border p-4"><div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{title}</h3><Badge variant={breached ? "destructive" : completedAt ? "success" : "secondary"}>{breached ? "Breached" : completedAt ? "Completed" : "In progress"}</Badge></div>{children}<dl className="text-sm"><DetailRow label="Deadline">{formatDate(deadline)}</DetailRow><DetailRow label="Completed">{formatDate(completedAt)}</DetailRow><DetailRow label="Outcome">{result}</DetailRow></dl></section>;
}

function TimelineEntry({ entry }: { entry: SlaTimelineEntry }) {
  return <li className="relative pb-6 pl-7 last:pb-0"><span className="absolute -left-2 top-0 flex size-4 items-center justify-center rounded-full border-2 border-background bg-primary" /><p className="font-medium">{entry.label}</p><time dateTime={entry.timestamp} className="text-xs text-muted-foreground">{formatDate(entry.timestamp)}</time>{entry.body && <p className="mt-1 text-sm text-muted-foreground">{entry.body}</p>}</li>;
}
