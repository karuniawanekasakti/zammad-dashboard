import { useQuery } from "@tanstack/react-query";
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
                    <div className="text-sm leading-relaxed whitespace-pre-line">{a.body}</div>
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

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b pb-2 last:border-b-0 last:pb-0">
      <span className="text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
