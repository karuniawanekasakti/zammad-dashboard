import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowDownUp, ArrowLeft, AlertTriangle, Bell, ChevronDown, ChevronUp, Clock, FileText, Lock, Mail, MessageSquare, Phone, RefreshCw, RotateCcw, Tag, User } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { api } from "@/lib/api";
import { PageLoader } from "@/components/spinner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from "@/components/reui/timeline";
import { PriorityBadge, StateBadge } from "@/components/status-badges";
import { SlaBadge } from "@/components/sla-badge";
import { cn, formatSeconds } from "@/lib/utils";
import type { Ticket, TicketArticle, TicketHistory } from "@/types";

const ICONS = {
  email: Mail,
  phone: Phone,
  note: Lock,
  web: MessageSquare,
} as const;

const SESSION_WINDOW_MS = 3 * 60 * 1000;
const FILTERS = [
  { key: "all", label: "All" },
  { key: "state", label: "State Changes" },
  { key: "article", label: "Articles" },
  { key: "sla", label: "SLA" },
  { key: "owner", label: "Owner" },
  { key: "notification", label: "Notifications" },
] as const;
type TimelineFilter = (typeof FILTERS)[number]["key"];

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ["ticket", id],
    queryFn: () => api.getTicket(id!),
    enabled: !!id,
  });
  const { data: history = [], isLoading: historyLoading, isError: historyError } = useQuery({
    queryKey: ["ticket-history", id],
    queryFn: () => api.getTicketHistory(id!),
    enabled: !!id,
  });

  if (isLoading) return <PageLoader />;
  if (!data) return <div className="text-sm text-muted-foreground">Ticket not found.</div>;

  const { ticket, articles } = data;
  const timelineHistory = history.length ? history : fallbackHistory(ticket, articles);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/tickets">
            <ArrowLeft className="size-4" />
            Back to tickets
          </Link>
        </Button>
      </div>

      <PageHeader
        title={`#${ticket.number} · ${ticket.title}`}
        description={
          <span className="flex items-center gap-2 text-sm flex-wrap">
            <StateBadge state={ticket.state} />
            <PriorityBadge priority={ticket.priority} />
            <SlaBadge status={ticket.sla_status} remainingSecs={ticket.first_response_remaining_secs} />
            {ticket.reopen_count > 0 && (
              <Badge variant="muted" className="gap-1">
                <RotateCcw className="size-3" /> Reopened × {ticket.reopen_count}
              </Badge>
            )}
          </span>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Conversation</CardTitle>
              <CardDescription>{articles.length} articles</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {articles.map((a) => {
                const Icon = ICONS[a.type];
                return (
                  <div key={a.id} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">{a.author_name}</span>
                        <Badge variant={a.author_role === "customer" ? "secondary" : "default"} className="capitalize">
                          {a.author_role}
                        </Badge>
                        {a.internal && (
                          <Badge variant="warning" className="gap-1">
                            <Lock className="size-3" /> Internal
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Icon className="size-3.5" />
                        <span>{format(new Date(a.created_at), "PPp")}</span>
                      </div>
                    </div>
                    <ArticleBody body={a.body} />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="size-4" /> History
              </CardTitle>
              <CardDescription>{historyError ? "Endpoint history gagal, menampilkan aktivitas lokal" : "Timeline aktivitas ticket dari Zammad"}</CardDescription>
            </CardHeader>
            <CardContent>
              <TicketHistoryTimeline
                ticket={ticket}
                articleCount={articles.length}
                history={timelineHistory}
                loading={historyLoading && !timelineHistory.length}
                error={false}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Details</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Info label="Customer" value={ticket.customer_name} />
              <Info label="Assignee" value={ticket.owner_name ?? "Unassigned"} />
              <Info label="Group" value={ticket.group_name} />
              <Info label="Severity" value={ticket.severity_label ?? "—"} />
              <Info label="Ticket Category" value={ticket.ticket_category_label ?? "—"} />
              <Info
                label="Created"
                value={formatDistanceToNow(new Date(ticket.zammad_created_at), { addSuffix: true })}
              />
              <Info
                label="Updated"
                value={formatDistanceToNow(new Date(ticket.zammad_updated_at), { addSuffix: true })}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">SLA</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Info
                label="First reply"
                value={
                  ticket.first_reply_time_secs == null
                    ? "Pending"
                    : formatSeconds(ticket.first_reply_time_secs)
                }
              />
              <Info
                label="Resolution"
                value={
                  ticket.resolution_time_secs == null ? "In progress" : formatSeconds(ticket.resolution_time_secs)
                }
              />
              <Info label="First response breached" value={ticket.first_response_breached ? "Yes" : "No"} />
              <Info label="Close breached" value={ticket.close_breached ? "Yes" : "No"} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Tag className="size-4" /> Tags</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {ticket.tags.length === 0 && <span className="text-xs text-muted-foreground">No tags</span>}
                {ticket.tags.map((t) => (
                  <Badge key={t} variant="outline" className="text-xs">
                    {t}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ArticleBody({ body }: { body: string }) {
  const content = useMemo(() => parseArticleBody(body), [body]);

  return <div className="text-sm leading-relaxed space-y-2 break-words">{content}</div>;
}

function parseArticleBody(body: string): ReactNode[] {
  if (typeof DOMParser === "undefined") return [body];

  const doc = new DOMParser().parseFromString(body, "text/html");
  return Array.from(doc.body.childNodes).map((node, index) => renderArticleNode(node, `${index}`));
}

function renderArticleNode(node: ChildNode, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const element = node as HTMLElement;
  const children = Array.from(element.childNodes).map((child, index) => renderArticleNode(child, `${key}-${index}`));

  switch (element.tagName.toLowerCase()) {
    case "br":
      return <br key={key} />;
    case "p":
      return <p key={key}>{children}</p>;
    case "div":
    case "section":
    case "article":
      return <div key={key}>{children}</div>;
    case "blockquote":
      return <blockquote key={key} className="border-l-2 pl-3 italic text-muted-foreground">{children}</blockquote>;
    case "ul":
      return <ul key={key} className="list-disc pl-5 space-y-1">{children}</ul>;
    case "ol":
      return <ol key={key} className="list-decimal pl-5 space-y-1">{children}</ol>;
    case "li":
      return <li key={key}>{children}</li>;
    case "a": {
      const href = readableHref(element.getAttribute("href"));
      return href ? (
        <a key={key} href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
          {children}
        </a>
      ) : (
        <span key={key}>{children}</span>
      );
    }
    case "strong":
    case "b":
      return <strong key={key}>{children}</strong>;
    case "em":
    case "i":
      return <em key={key}>{children}</em>;
    case "code":
      return <code key={key} className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>;
    case "pre":
      return <pre key={key} className="overflow-x-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{element.textContent}</pre>;
    case "img":
      return element.getAttribute("alt") ? <span key={key}>[image: {element.getAttribute("alt")}]</span> : null;
    case "script":
    case "style":
      return null;
    default:
      return <span key={key}>{children}</span>;
  }
}

function readableHref(href: string | null) {
  if (!href) return null;

  try {
    const url = new URL(href, window.location.origin);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? href : null;
  } catch {
    return null;
  }
}

function fallbackHistory(ticket: Ticket, articles: TicketArticle[]): TicketHistory[] {
  return [
    {
      id: `${ticket.id}-created`,
      type: "created",
      title: "Ticket created",
      created_by: ticket.customer_name,
      created_at: ticket.zammad_created_at,
      object: "Ticket",
      to: ticket.state,
    },
    ...articles.map((article) => ({
      id: `${article.id}-history`,
      type: "created",
      object: "Article",
      title: article.internal ? "Internal note added" : "Article added",
      body: article.body,
      created_by: article.author_name,
      created_at: article.created_at,
    })),
    {
      id: `${ticket.id}-updated`,
      type: "state",
      attribute: "state",
      title: "Ticket updated",
      created_by: ticket.owner_name ?? "System",
      created_at: ticket.zammad_updated_at,
      from: "new",
      to: ticket.state,
    },
  ];
}

type NormalizedHistory = ReturnType<typeof normalizeHistory>;

function TicketHistoryTimeline({
  ticket,
  articleCount,
  history,
  loading,
  error,
}: {
  ticket: Ticket;
  articleCount: number;
  history: TicketHistory[];
  loading: boolean;
  error: boolean;
}) {
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [expandedNotifications, setExpandedNotifications] = useState<Record<string, boolean>>({});
  const events = useMemo(() => history.map(normalizeHistory).sort((a, b) => sortDir === "desc" ? b.time - a.time : a.time - b.time), [history, sortDir]);
  const filteredEvents = filter === "all" ? events : events.filter((event) => filterKind(event.kind) === filter);
  const groups = useMemo(() => groupTimelineEvents(filteredEvents), [filteredEvents]);

  if (loading) {
    return <div className="space-y-5">{[0, 1, 2].map((i) => <TimelineSkeleton key={i} />)}</div>;
  }
  if (error) return <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">History belum bisa dimuat.</div>;
  if (!events.length) return <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Belum ada history.</div>;

  return (
    <div className="space-y-5">
      <HistorySummary ticket={ticket} articleCount={articleCount} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <Button
              key={item.key}
              type="button"
              size="sm"
              variant={filter === item.key ? "default" : "outline"}
              className="h-8 rounded-full px-3 text-xs"
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1 rounded-full px-3 text-xs"
          onClick={() => setSortDir((value) => value === "desc" ? "asc" : "desc")}
        >
          <ArrowDownUp className="size-3.5" />
          {sortDir === "desc" ? "Newest first" : "Oldest first"}
        </Button>
      </div>
      {!groups.length ? (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Tidak ada event untuk filter ini.</div>
      ) : (
        <Timeline defaultValue={events.length} className="gap-5">
          {groups.map((group, groupIndex) => {
            const notifications = group.events.filter((event) => event.kind === "notification");
            const visibleEvents = group.events.filter((event) => event.kind !== "notification");
            const isExpanded = expandedNotifications[group.id] ?? false;
            const renderedEvents = isExpanded ? group.events : visibleEvents;

            return (
              <div key={group.id} className="rounded-xl border bg-card/50 p-4 shadow-sm">
                <TimelineDate dateTime={group.date} title={format(new Date(group.date), "PPp")}>
                  {formatDistanceToNow(new Date(group.date), { addSuffix: true })}
                </TimelineDate>
                <Timeline className="mt-3">
                  {renderedEvents.map((event, index) => (
                    <HistoryTimelineItem
                      key={event.id}
                      event={event}
                      step={groupIndex * 100 + index + 1}
                    />
                  ))}
                </Timeline>
                {notifications.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-3 h-8 gap-1 px-2 text-xs text-muted-foreground"
                    onClick={() => setExpandedNotifications((value) => ({ ...value, [group.id]: !isExpanded }))}
                  >
                    {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                    {isExpanded ? "Hide" : "Show"} {notifications.length} notifications
                  </Button>
                )}
              </div>
            );
          })}
        </Timeline>
      )}
    </div>
  );
}

function HistorySummary({ ticket, articleCount }: { ticket: Ticket; articleCount: number }) {
  const breached = ticket.sla_status === "breached" || ticket.first_response_breached || ticket.close_breached;

  return (
    <div className="grid gap-2 rounded-xl border bg-muted/40 p-3 text-sm sm:grid-cols-4">
      <SummaryItem label="Duration" value={ticketDuration(ticket)} />
      <SummaryItem label="Articles" value={`${articleCount} replies`} />
      <SummaryItem
        label="SLA"
        value={
          <Badge variant={breached ? "destructive" : "success"}>
            {breached ? "Breached" : "On Time"}
          </Badge>
        }
      />
      <SummaryItem label="Final state" value={<StateBadge state={ticket.state} />} />
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function HistoryTimelineItem({ event, step }: { event: NormalizedHistory; step: number }) {
  const meta = historyMeta(event.kind);
  const Icon = meta.icon;

  return (
    <TimelineItem step={step} className="pb-5 last:pb-0">
      <TimelineSeparator className="bg-border" />
      <TimelineIndicator className={cn("flex size-7 items-center justify-center border bg-background shadow-sm", meta.dot)}>
        <Icon className="size-3.5" />
      </TimelineIndicator>
      <TimelineHeader className="rounded-lg border bg-background p-3 transition-colors hover:bg-muted/30">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <TimelineTitle>{event.title}</TimelineTitle>
              <Badge variant="outline" className={cn("text-[10px] capitalize", meta.badge)}>{event.label}</Badge>
            </div>
            {event.actor && (
              <div className="text-xs text-muted-foreground">
                oleh <span className="font-medium text-foreground">{event.actor}</span>
              </div>
            )}
          </div>
          {event.createdAt && (
            <time dateTime={event.createdAt} title={format(new Date(event.createdAt), "PPp")} className="text-xs text-muted-foreground">
              {format(new Date(event.createdAt), "p")}
            </time>
          )}
        </div>
        <TimelineContent className="mt-3 text-foreground">
          <HistoryContent event={event} />
        </TimelineContent>
      </TimelineHeader>
    </TimelineItem>
  );
}

function HistoryContent({ event }: { event: NormalizedHistory }) {
  if (event.kind === "article") {
    return (
      <div className="rounded-lg border border-l-4 border-l-emerald-500 bg-muted/50 p-3 shadow-sm">
        {event.body ? <ArticleBody body={event.body} /> : <span className="text-sm text-muted-foreground">Article created.</span>}
      </div>
    );
  }

  if (event.kind === "state" && (event.oldValue || event.newValue)) {
    return <Badge variant="secondary">{event.oldValue ?? "—"} → {event.newValue ?? "—"}</Badge>;
  }

  if (event.kind === "owner" && (event.oldValue || event.newValue)) {
    return <ChangeText from={event.oldValue} to={event.newValue} />;
  }

  if (event.oldValue || event.newValue) return <ChangeText from={event.oldValue} to={event.newValue} />;
  if (event.body && event.body !== event.title) return <span className="text-sm text-muted-foreground">{event.body}</span>;
  return <span className="text-sm text-muted-foreground">No detail.</span>;
}

function ChangeText({ from, to }: { from: string | null; to: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="rounded-md bg-muted px-2 py-1 text-muted-foreground">{from ?? "—"}</span>
      <span className="text-muted-foreground">→</span>
      <span className="rounded-md bg-muted px-2 py-1 font-medium">{to ?? "—"}</span>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="relative ml-4 pl-7">
      <span className="absolute -left-3 top-0 size-6 rounded-full border bg-muted animate-pulse" />
      <div className="rounded-xl border p-3 space-y-3">
        <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
        <div className="h-3 w-full rounded bg-muted animate-pulse" />
        <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
      </div>
    </div>
  );
}

// Zammad attribute names → human labels (matches the history lines Zammad renders).
const ATTRIBUTE_LABELS: Record<string, string> = {
  first_response_at: "First response",
  last_contact_at: "Last contact",
  last_contact_agent_at: "Last contact (agent)",
  last_owner_update_at: "last_owner_update_at",
  first_response_in_min: "first_response_in_min",
  first_response_diff_in_min: "first_response_diff_in_min",
  close_escalation_at: "Escalation at (Close Time)",
  escalation_at: "Escalation at",
  state: "State",
  close_at: "Closing time",
  last_close_at: "Last closing time",
  close_in_min: "close_in_min",
  close_diff_in_min: "close_diff_in_min",
  owner: "Owner",
  priority: "Priority",
};

function normalizeHistory(row: TicketHistory, index: number) {
  let kind = historyKind(row);
  const field = text(row.attribute);
  const oldValue = text(row.value_from) ?? text(row.from) ?? text(row.old);
  const newValue = text(row.value_to) ?? text(row.to) ?? text(row.new);
  const createdAt = text(row.created_at) ?? text(row.updated_at);
  const obj = text(row.object);
  const type = text(row.type);
  const body = text(row.body) ?? text(row.description) ?? text(row.note);

  const objLabel = obj?.replace("::", " ") ?? "";

  let title: string;
  if (type === "created" && obj) {
    title = `created ${objLabel}`;
  } else if (type === "updated" && obj) {
    const label = field ? (ATTRIBUTE_LABELS[field] ?? labelize(field)) : "";
    title = label ? `updated ${objLabel} ${label}` : `updated ${objLabel}`;
  } else if (type && obj) {
    title = `${type} ${objLabel}`;
  } else {
    title = text(row.title) ?? `${labelize(kind)} activity`;
  }

  // special cases: email sent, notifications, triggers carry the whole line in `body`
  if (body?.toLowerCase().includes("email sent")) {
    title = body;
    kind = "email";
  } else if (body?.toLowerCase().includes("notification")) {
    title = body;
    kind = "notification";
  } else if (body?.toLowerCase().includes("trigger")) {
    title = body;
    kind = "sla";
  }

  const actor = actorName(row.created_by) ?? (row.created_by_id ? `User #${row.created_by_id}` : "");

  return {
    id: String(row.id ?? `${createdAt ?? "history"}-${index}`),
    kind,
    label: labelize(kind),
    title,
    body,
    actor,
    oldValue,
    newValue,
    createdAt,
    time: createdAt ? new Date(createdAt).getTime() || 0 : 0,
  };
}

function groupTimelineEvents(events: NormalizedHistory[]) {
  return events.reduce<{ id: string; date: string; time: number; events: NormalizedHistory[] }[]>((groups, event) => {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.time - event.time) <= SESSION_WINDOW_MS) {
      last.events.push(event);
      return groups;
    }

    groups.push({
      id: `${event.createdAt ?? "unknown"}-${groups.length}`,
      date: event.createdAt ?? new Date(0).toISOString(),
      time: event.time,
      events: [event],
    });
    return groups;
  }, []);
}

function filterKind(kind: string): TimelineFilter {
  if (kind === "state") return "state";
  if (kind === "article" || kind === "created" || kind === "email") return "article";
  if (kind === "sla" || kind === "pending") return "sla";
  if (kind === "owner") return "owner";
  if (kind === "notification") return "notification";
  return "all";
}

function historyKind(row: TicketHistory) {
  const type = text(row.type)?.toLowerCase() ?? "";
  const obj = text(row.object)?.toLowerCase() ?? "";
  const attr = text(row.attribute)?.toLowerCase() ?? "";
  const body = text(row.body)?.toLowerCase() ?? "";

  if (type === "created" && obj.includes("article")) return "article";
  if (type === "created" && obj.includes("ticket")) return "created";
  if (["email", "phone", "note", "web"].includes(type) && body) return "article";
  if (body.includes("email sent")) return "email";
  if (body.includes("notification")) return "notification";
  if (body.includes("trigger")) return "sla";
  if (attr.includes("pending")) return "pending";
  if (attr.includes("state") || attr.includes("status")) return "state";
  if (attr.includes("owner") || attr.includes("user")) return "owner";
  if (attr.includes("sla") || attr.includes("escalat") || attr.includes("first_response") || attr.includes("close_")) return "sla";
  if (type === "updated") return "updated";
  if (type === "created") return "created";
  return "history";
}

function historyMeta(kind: string) {
  if (kind === "state") return { icon: RefreshCw, dot: "text-blue-600 border-blue-500/30 bg-blue-500/10", badge: "border-blue-500/30 text-blue-700 dark:text-blue-300" };
  if (kind === "owner") return { icon: User, dot: "text-orange-600 border-orange-500/30 bg-orange-500/10", badge: "border-orange-500/30 text-orange-700 dark:text-orange-300" };
  if (kind === "sla") return { icon: AlertTriangle, dot: "text-rose-600 border-rose-500/30 bg-rose-500/10", badge: "border-rose-500/30 text-rose-700 dark:text-rose-300" };
  if (kind === "notification") return { icon: Bell, dot: "text-slate-600 border-slate-500/30 bg-slate-500/10", badge: "border-slate-500/30 text-slate-700 dark:text-slate-300" };
  if (kind === "pending") return { icon: Clock, dot: "text-amber-600 border-amber-500/30 bg-amber-500/10", badge: "border-amber-500/30 text-amber-700 dark:text-amber-300" };
  if (kind === "article") return { icon: Mail, dot: "text-emerald-600 border-emerald-500/30 bg-emerald-500/10", badge: "border-emerald-500/30 text-emerald-700 dark:text-emerald-300" };
  if (kind === "created") return { icon: FileText, dot: "text-emerald-600 border-emerald-500/30 bg-emerald-500/10", badge: "border-emerald-500/30 text-emerald-700 dark:text-emerald-300" };
  if (kind === "email") return { icon: Mail, dot: "text-emerald-600 border-emerald-500/30 bg-emerald-500/10", badge: "border-emerald-500/30 text-emerald-700 dark:text-emerald-300" };
  return { icon: Clock, dot: "text-muted-foreground border-muted bg-muted/40", badge: "" };
}

function ticketDuration(ticket: Ticket) {
  const start = new Date(ticket.zammad_created_at).getTime();
  const end = new Date(ticket.closed_at ?? ticket.zammad_updated_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "—";
  return formatSeconds(Math.round((end - start) / 1000));
}

function actorName(value: unknown) {
  if (!value || typeof value !== "object") return text(value);
  const user = value as { firstname?: unknown; lastname?: unknown; login?: unknown; name?: unknown };
  return [text(user.firstname), text(user.lastname)].filter(Boolean).join(" ") || text(user.name) || text(user.login);
}

function text(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const object = value as { name?: unknown; value?: unknown; label?: unknown; title?: unknown };
    return text(object.name) ?? text(object.label) ?? text(object.value) ?? text(object.title);
  }
  return null;
}

function labelize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b pb-2 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
