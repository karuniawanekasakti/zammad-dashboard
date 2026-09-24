import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, Check, CheckCheck } from "lucide-react";
import { api } from "@/lib/api";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DataError } from "@/components/data-error";
import { Spinner } from "@/components/spinner";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function NotificationsDrawer({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const {
    data,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.listNotifications(),
  });
  const markAll = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markOne = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  // "N unread" and "Mark all" are claims about the result set — hold them back
  // until the query resolves so a pending/failed load never reads as zero.
  const resolved = !isLoading && !isError && !!data;
  const items = data ?? [];
  const unread = resolved ? items.filter((n) => n.status !== "read").length : 0;
  const mutationError = markAll.isError || markOne.isError;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col p-0">
        <SheetHeader className="p-6 pb-4 border-b">
          <div className="flex items-center justify-between">
            <SheetTitle>Notifications</SheetTitle>
            {resolved ? (
              <Badge variant="secondary">{unread} unread</Badge>
            ) : isError ? (
              <Badge variant="secondary" className="text-destructive">Failed to load</Badge>
            ) : (
              <Badge variant="secondary" className="gap-1.5">
                <Spinner className="size-3" />
                Loading
              </Badge>
            )}
          </div>
          <SheetDescription>Recent in-app alerts and activity.</SheetDescription>
          <div className="flex gap-2 pt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => markAll.mutate()}
              disabled={!resolved || !unread || markAll.isPending}
            >
              {markAll.isPending ? <Spinner className="size-3.5" /> : <CheckCheck className="size-3.5" />}
              Mark all as read
            </Button>
          </div>
          {mutationError && (
            <div className="flex items-center gap-1.5 pt-1 text-xs text-destructive" role="alert">
              <AlertCircle className="size-3.5 shrink-0" />
              <span>Couldn't update notifications. Please try again.</span>
            </div>
          )}
        </SheetHeader>
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-10" role="status">
                <Spinner className="size-5" />
              </div>
            ) : isError ? (
              <DataError title="notifications" detail="GET /notifications" onRetry={() => refetch()} />
            ) : items.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-10">No notifications yet.</div>
            ) : (
              items.map((n) => {
                const isRead = n.status === "read";
                const isMarking = markOne.isPending && markOne.variables === n.id;
                return (
                  <div
                    key={n.id}
                    className={cn(
                      "rounded-lg border p-3 space-y-1 transition-colors",
                      !isRead && "bg-primary/5 border-primary/30"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium leading-snug">{n.rule_name}</div>
                      {!isRead && (
                        <button
                          onClick={() => markOne.mutate(n.id)}
                          disabled={isMarking}
                          className="text-muted-foreground hover:text-foreground transition disabled:opacity-50"
                          title="Mark as read"
                        >
                          {isMarking ? <Spinner className="size-3.5" /> : <Check className="size-3.5" />}
                        </button>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{n.message}</div>
                    <div className="flex items-center gap-2 pt-1">
                      <Badge variant="muted" className="capitalize">{n.channel.replace("_", " ")}</Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
