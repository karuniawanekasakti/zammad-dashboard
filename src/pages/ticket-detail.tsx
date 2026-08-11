import { useQuery } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Lock, Mail, MessageSquare, Phone, RotateCcw, Tag } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { api } from "@/lib/api";
import { PageLoader } from "@/components/spinner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PriorityBadge, StateBadge } from "@/components/status-badges";
import { SlaBadge } from "@/components/sla-badge";
import { formatSeconds } from "@/lib/utils";

const ICONS = {
  email: Mail,
  phone: Phone,
  note: Lock,
  web: MessageSquare,
} as const;

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ["ticket", id],
    queryFn: () => api.getTicket(id!),
    enabled: !!id,
  });

  if (isLoading) return <PageLoader />;
  if (!data) return <div className="text-sm text-muted-foreground">Ticket not found.</div>;

  const { ticket, articles } = data;

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
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Details</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Info label="Customer" value={ticket.customer_name} />
              <Info label="Assignee" value={ticket.owner_name ?? "Unassigned"} />
              <Info label="Group" value={ticket.group_name} />
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

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b pb-2 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
