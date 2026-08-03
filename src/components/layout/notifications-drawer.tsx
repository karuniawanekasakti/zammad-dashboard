import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Check, CheckCheck } from "lucide-react";
import { api } from "@/lib/api";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function NotificationsDrawer({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const { data = [] } = useQuery({
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

  const unread = data.filter((n) => n.status !== "read").length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col p-0">
        <SheetHeader className="p-6 pb-4 border-b">
          <div className="flex items-center justify-between">
            <SheetTitle>Notifications</SheetTitle>
            <Badge variant="secondary">{unread} unread</Badge>
          </div>
          <SheetDescription>Recent in-app alerts and activity.</SheetDescription>
          <div className="flex gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={() => markAll.mutate()} disabled={!unread}>
              <CheckCheck className="size-3.5" />
              Mark all as read
            </Button>
          </div>
        </SheetHeader>
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-2">
            {data.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-10">No notifications yet.</div>
            )}
            {data.map((n) => {
              const isRead = n.status === "read";
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
                        className="text-muted-foreground hover:text-foreground transition"
                        title="Mark as read"
                      >
                        <Check className="size-3.5" />
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
            })}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
