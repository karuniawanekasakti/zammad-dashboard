import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PlugZap, RefreshCw, Shield } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export default function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.getSystemSettings() });
  const triggerSync = useMutation({
    mutationFn: () => api.triggerSync(),
    onSuccess: () => {
      toast.success("Sync triggered");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const s = settings.data;

  return (
    <div className="space-y-4">
      <PageHeader title="System Settings" description="Admin-only. Configure Zammad connection, SMTP & retention." />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><PlugZap className="size-4" /> Zammad connection</CardTitle>
            <CardDescription>Base URL, API token and webhook secret.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Base URL</Label>
              <Input value={s?.zammad_base_url ?? ""} readOnly />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>API token</Label>
                <Input value={s?.zammad_api_token_preview ?? ""} readOnly />
              </div>
              <div className="space-y-2">
                <Label>Webhook secret</Label>
                <Input value={s?.webhook_secret_preview ?? ""} readOnly />
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="text-sm">
                Last sync:{" "}
                <span className="font-medium">
                  {s?.last_sync_at ? formatDistanceToNow(new Date(s.last_sync_at), { addSuffix: true }) : "—"}
                </span>
                <div className="text-xs text-muted-foreground">
                  Last full reconcile: {s?.last_full_sync_at ? format(new Date(s.last_full_sync_at), "PPp") : "—"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {s?.zammad_online ? (
                  <Badge variant="success">Online</Badge>
                ) : (
                  <Badge variant="destructive">Offline</Badge>
                )}
                <Button variant="outline" size="sm" onClick={() => triggerSync.mutate()} disabled={triggerSync.isPending}>
                  {triggerSync.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  Trigger sync
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Shield className="size-4" /> Data retention</CardTitle>
            <CardDescription>Rolling window enforced by cleanup worker.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Retention (days)</Label>
              <Input type="number" value={s?.data_retention_days ?? 30} readOnly />
            </div>
            <div className="rounded-md border p-3 text-xs text-muted-foreground space-y-1">
              <div>Records older than retention are deleted daily at 02:00.</div>
              <div>Hourly snapshots remain for trend accuracy.</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">SMTP</CardTitle>
          <CardDescription>For system email alerts (used when user opts into email channel).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>SMTP host</Label>
            <Input value={s?.smtp_host ?? ""} readOnly />
          </div>
          <div className="space-y-2">
            <Label>Port</Label>
            <Input type="number" value={s?.smtp_port ?? 587} readOnly />
          </div>
          <div className="space-y-2">
            <Label>From address</Label>
            <Input value={s?.smtp_from ?? ""} readOnly />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
