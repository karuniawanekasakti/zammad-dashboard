import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Activity, KeyRound, LogIn, LogOut, MonitorSmartphone, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import {
  activityKindLabel,
  deviceLabel,
  sessionStatusInfo,
} from "@/lib/session-log";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AccessSession, SessionActivity } from "@/types";

const ACTIVITY_ICON = { login: LogIn, logout: LogOut, revoke: ShieldOff, view: Activity } as const;

function relativeTime(value: string): string {
  try {
    return formatDistanceToNow(new Date(value), { addSuffix: true });
  } catch {
    return value;
  }
}

function absoluteTime(value: string): string {
  return new Date(value).toLocaleString();
}

/**
 * Hidden Session & Activity Log.
 *
 * Not linked from the visible navigation (reachable only via five logo
 * clicks), but deliberately *not* role-gated: authentication alone admits a
 * visitor, and a direct URL works. This is obscurity, not authorization.
 */
export default function SessionLogPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ["access-sessions"],
    queryFn: () => api.listAccessSessions(),
  });

  const activity = useQuery({
    queryKey: ["session-activity", selectedId],
    queryFn: () => api.listSessionActivity(selectedId!),
    enabled: !!selectedId,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeSession(id),
    onSuccess: (_result, id) => {
      toast.success("Session revoked. Its token is rejected on the next request.");
      queryClient.invalidateQueries({ queryKey: ["access-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["session-activity", id] });
    },
    onError: () => toast.error("Could not revoke this session."),
  });

  const rows = sessions.data ?? [];
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Session & Activity Log"
        description="Every login to this dashboard, and the pages each session has visited."
      />

      <Card>
        <CardHeader>
          <CardTitle>Accessing computers</CardTitle>
          <CardDescription>
            One row per login. Select a row to see that session's activity timeline.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QueryBody
            isLoading={sessions.isLoading}
            isError={sessions.isError}
            isEmpty={rows.length === 0}
            onRetry={() => sessions.refetch()}
            label="session list"
            emptyMessage="No sessions have been recorded yet."
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>IP address</TableHead>
                  <TableHead>Signed in</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((session) => (
                  <TableRow
                    key={session.id}
                    role="link"
                    tabIndex={0}
                    aria-selected={session.id === selectedId}
                    className={cn("cursor-pointer", session.id === selectedId && "bg-muted/60")}
                    onClick={() => setSelectedId(session.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(session.id);
                      }
                    }}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <MonitorSmartphone className="size-4 shrink-0 text-muted-foreground" />
                        <span className="font-medium">{deviceLabel(session)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{session.ip}</TableCell>
                    <TableCell className="text-muted-foreground" title={absoluteTime(session.created_at)}>
                      {relativeTime(session.created_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground" title={absoluteTime(session.last_seen_at)}>
                      {relativeTime(session.last_seen_at)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge session={session} />
                    </TableCell>
                    <TableCell className="text-right">
                      <RevokeButton
                        session={session}
                        pending={revoke.isPending && revoke.variables === session.id}
                        onRevoke={() => revoke.mutate(session.id)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </QueryBody>
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Activity — {deviceLabel(selected)}</CardTitle>
              <CardDescription className="font-mono text-xs">{selected.ip}</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
              Close
            </Button>
          </CardHeader>
          <CardContent>
            <QueryBody
              isLoading={activity.isLoading}
              isError={activity.isError}
              isEmpty={(activity.data ?? []).length === 0}
              onRetry={() => activity.refetch()}
              label="activity timeline"
              emptyMessage="No activity was recorded for this session."
            >
              <ol className="relative ml-2 border-l">
                {(activity.data ?? []).map((entry) => (
                  <ActivityEntry key={entry.id} entry={entry} />
                ))}
              </ol>
            </QueryBody>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RevokeButton({
  session,
  pending,
  onRevoke,
}: {
  session: AccessSession;
  pending: boolean;
  onRevoke: () => void;
}) {
  if (!sessionStatusInfo(session).live) {
    return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><ShieldOff className="size-3.5" /> Revoked</span>;
  }
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      // Stop the row's click/keydown handlers from also selecting the session.
      onClick={(event) => {
        event.stopPropagation();
        onRevoke();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <KeyRound className="size-3.5" />
      {pending ? "Revoking…" : "Revoke"}
    </Button>
  );
}

function StatusBadge({ session }: { session: AccessSession }) {
  const { label, tone } = sessionStatusInfo(session);
  return <Badge variant={tone}>{label}</Badge>;
}

function ActivityEntry({ entry }: { entry: SessionActivity }) {
  const Icon = ACTIVITY_ICON[entry.kind] ?? Activity;
  return (
    <li className="relative pb-5 pl-7 last:pb-0">
      <span className="absolute -left-2 top-0 flex size-4 items-center justify-center rounded-full border-2 border-background bg-primary">
        <Icon className="size-2.5 text-primary-foreground" />
      </span>
      <p className="text-sm font-medium">{activityKindLabel(entry.kind)}</p>
      {entry.route && <p className="font-mono text-xs text-muted-foreground">{entry.route}</p>}
      <time dateTime={entry.created_at} className="text-xs text-muted-foreground" title={absoluteTime(entry.created_at)}>
        {relativeTime(entry.created_at)}
      </time>
    </li>
  );
}

function QueryBody({
  isLoading,
  isError,
  isEmpty,
  onRetry,
  label,
  emptyMessage,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  onRetry: () => void;
  label: string;
  emptyMessage: string;
  children: React.ReactNode;
}) {
  if (isLoading) return <p role="status" className="text-sm text-muted-foreground">Loading {label}…</p>;
  if (isError) return <Button variant="outline" onClick={onRetry}>Retry {label}</Button>;
  if (isEmpty) return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  return <>{children}</>;
}
