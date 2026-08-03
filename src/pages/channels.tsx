import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Mail, MessageCircle, Send, Slack, TestTube2, XCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { PageLoader } from "@/components/spinner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { AlertChannel } from "@/types";

const ICONS: Record<AlertChannel, React.ElementType> = {
  email: Mail,
  slack: Slack,
  telegram: Send,
  teams: MessageCircle,
  whatsapp: MessageCircle,
  in_app: MessageCircle,
};

export default function ChannelsPage() {
  const qc = useQueryClient();
  const channels = useQuery({ queryKey: ["channels"], queryFn: () => api.listChannels() });
  const test = useMutation({
    mutationFn: (id: string) => api.testChannel(id),
    onSuccess: (r) => {
      if (r.ok) toast.success("Test message sent");
      else toast.error("Test failed — check channel config");
    },
  });

  if (channels.isLoading) return <PageLoader />;

  return (
    <div className="space-y-4">
      <PageHeader title="Channels" description="Configure where your alerts are delivered." />

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(channels.data ?? []).map((c) => {
          const Icon = ICONS[c.channel_type] ?? MessageCircle;
          return (
            <Card key={c.id}>
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                      <Icon className="size-5" />
                    </div>
                    <div>
                      <div className="font-medium capitalize">{c.channel_type.replace("_", " ")}</div>
                      <div className="text-xs text-muted-foreground">{c.label}</div>
                    </div>
                  </div>
                  <Switch checked={c.is_active} onCheckedChange={() => qc.invalidateQueries({ queryKey: ["channels"] })} />
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  {Object.entries(c.config).map(([k, v]) => (
                    <div key={k}><span className="font-medium">{k}:</span> {v}</div>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-2 border-t">
                  {c.verified_at ? (
                    <Badge variant="success" className="gap-1">
                      <CheckCircle2 className="size-3" />
                      Verified {formatDistanceToNow(new Date(c.verified_at), { addSuffix: true })}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1">
                      <XCircle className="size-3" />
                      Not verified
                    </Badge>
                  )}
                  <Button size="sm" variant="outline" onClick={() => test.mutate(c.id)} disabled={test.isPending}>
                    <TestTube2 className="size-3.5" />
                    Test
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
