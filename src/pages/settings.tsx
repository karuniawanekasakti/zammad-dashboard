import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PlugZap, RefreshCw, Shield, Save, Database, Server, AlertTriangle, CheckCircle, XCircle, Clock, Zap } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function SettingsPage() {
  const qc = useQueryClient();

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings() });
  const statusQuery = useQuery({ queryKey: ["settings-status"], queryFn: () => api.getSettingsStatus(), refetchInterval: 30000 });

  const s = settings.data;
  const schedules = s?.schedules ?? { incremental_seconds: 300, full_reconcile_seconds: 21600 };

  const saveSchedules = useMutation({
    mutationFn: (patch: { incremental_seconds: number; full_reconcile_seconds: number }) => api.updateSchedules(patch),
    onSuccess: () => {
      toast.success("Schedules saved — applies on next beat tick");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const triggerIncremental = useMutation({
    mutationFn: () => api.triggerSyncByKind("incremental"),
    onSuccess: () => {
      toast.success("Incremental sync triggered");
      qc.invalidateQueries({ queryKey: ["settings", "settings-status"] });
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const triggerFull = useMutation({
    mutationFn: () => api.triggerSyncByKind("full"),
    onSuccess: () => {
      toast.success("Full reconcile triggered");
      qc.invalidateQueries({ queryKey: ["settings", "settings-status"] });
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const purgeCache = useMutation({
    mutationFn: () => api.purgeCache(),
    onSuccess: (res) => {
      toast.success(`Cache purged: ${res.purged} keys`);
      qc.invalidateQueries({ queryKey: ["settings", "settings-status"] });
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const st = statusQuery.data;

  const healthBadge = (v: string) =>
    v === "ok" ? <Badge variant="success">Online</Badge> : <Badge variant="destructive">Down</Badge>;

  return (
    <div className="space-y-4">
      <PageHeader title="System Settings" description="Admin-only. Worker config, manual sync, health monitoring." />

      <Tabs defaultValue="worker" className="space-y-4">
        <TabsList>
          <TabsTrigger value="worker"><Zap className="size-4 mr-2" /> Worker Config</TabsTrigger>
          <TabsTrigger value="sync"><RefreshCw className="size-4 mr-2" /> Sync & Data</TabsTrigger>
          <TabsTrigger value="health"><Server className="size-4 mr-2" /> Health & Diagnostics</TabsTrigger>
        </TabsList>

        {/* Worker Config */}
        <TabsContent value="worker" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Zap className="size-4" /> Celery Beat Schedules</CardTitle>
              <CardDescription>Intervals are stored in the DB and applied on the next beat tick (≤ 60 s).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Incremental sync (seconds)</Label>
                  <Input
                    type="number"
                    value={schedules.incremental_seconds}
                    onChange={(e) => (schedules.incremental_seconds = parseInt(e.target.value, 10))}
                    min={30}
                    max={604800}
                  />
                  <p className="text-xs text-muted-foreground">Default 300s (5 min). Pulls tickets updated since last watermark.</p>
                </div>
                <div className="space-y-2">
                  <Label>Full reconcile (seconds)</Label>
                  <Input
                    type="number"
                    value={schedules.full_reconcile_seconds}
                    onChange={(e) => (schedules.full_reconcile_seconds = parseInt(e.target.value, 10))}
                    min={30}
                    max={604800}
                  />
                  <p className="text-xs text-muted-foreground">Default 21600s (6 h). Re-syncs all tickets, users, groups.</p>
                </div>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  Zammad: <span className="font-medium">{s?.zammad_base_url ?? "—"}</span>
                </div>
                <Button
                  onClick={() => saveSchedules.mutate(schedules)}
                  disabled={saveSchedules.isPending}
                >
                  {saveSchedules.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  Save Schedules
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><PlugZap className="size-4" /> Zammad Connection</CardTitle>
              <CardDescription>Configured via environment variables (read-only here).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Base URL</Label>
                <Input value={s?.zammad_base_url ?? ""} readOnly />
              </div>
              <p className="text-xs text-muted-foreground">API token and webhook secret are not displayed.</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sync & Data */}
        <TabsContent value="sync" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><RefreshCw className="size-4" /> Manual Sync Triggers</CardTitle>
              <CardDescription>Trigger a sync immediately. Incremental is fast; full reconcile may take minutes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => triggerIncremental.mutate()}
                  disabled={triggerIncremental.isPending || triggerFull.isPending}
                >
                  {triggerIncremental.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  Trigger Incremental
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => triggerFull.mutate()}
                  disabled={triggerIncremental.isPending || triggerFull.isPending}
                >
                  {triggerFull.isPending ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />}
                  Trigger Full Reconcile
                </Button>
              </div>

              <Separator />

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1 p-3 rounded border">
                  <p className="text-xs text-muted-foreground">Last Run</p>
                  <p className="font-medium">{s?.last_run?.kind ? s.last_run.kind.charAt(0).toUpperCase() + s.last_run.kind.slice(1) : "—"}</p>
                  <p className="text-xs text-muted-foreground">Triggered by: {s?.last_run?.triggered_by ?? "—"}</p>
                </div>
                <div className="space-y-1 p-3 rounded border">
                  <p className="text-xs text-muted-foreground">Tickets / Users / Groups</p>
                  <p className="font-medium">
                    {s?.last_run?.tickets ?? 0} / {s?.last_run?.users ?? 0} / {s?.last_run?.groups ?? 0}
                  </p>
                </div>
                <div className="space-y-1 p-3 rounded border">
                  <p className="text-xs text-muted-foreground">Duration</p>
                  <p className="font-medium">{s?.last_run?.duration_secs ?? 0}s</p>
                  <p className="text-xs text-muted-foreground">{s?.last_run?.finished_at ? formatDistanceToNow(new Date(s.last_run.finished_at), { addSuffix: true }) : "—"}</p>
                </div>
              </div>

              <Separator />

              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => purgeCache.mutate()} disabled={purgeCache.isPending}>
                  {purgeCache.isPending ? <Loader2 className="size-4 animate-spin" /> : <Shield className="size-4" />}
                  Purge Redis Cache
                </Button>
                <span className="text-xs text-muted-foreground">Clears tickets:*, agents:*, groups:*, kpi:*</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Shield className="size-4" /> Data Retention</CardTitle>
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
        </TabsContent>

        {/* Health & Diagnostics */}
        <TabsContent value="health" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Server className="size-4" /> System Health</CardTitle>
              <CardDescription>Live status of dependencies. Auto-refreshes every 30 s.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="flex items-center gap-3 p-3 rounded border">
                  <Database className="size-6 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Database</p>
                    <p className="text-xs text-muted-foreground">PostgreSQL</p>
                    {healthBadge(st?.health?.database ?? s?.health?.database ?? "down")}
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded border">
                  <Server className="size-6 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Redis</p>
                    <p className="text-xs text-muted-foreground">Cache & broker</p>
                    {healthBadge(st?.health?.redis ?? s?.health?.redis ?? "down")}
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded border">
                  <PlugZap className="size-6 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Zammad</p>
                    <p className="text-xs text-muted-foreground">REST API</p>
                    {healthBadge(st?.health?.zammad ?? s?.health?.zammad ?? "down")}
                  </div>
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 p-3 rounded border flex-1">
                  <Zap className="size-6 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Celery Workers (sync queue)</p>
                    <p className="text-xs text-muted-foreground">
                      {st?.worker?.reachable ?? s?.worker?.reachable ? "Reachable" : "Unreachable"}
                    </p>
                    {st?.worker?.reachable ? (
                      <Badge variant="success">Online</Badge>
                    ) : (
                      <Badge variant="destructive">Offline</Badge>
                    )}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => statusQuery.refetch()} disabled={statusQuery.isFetching}>
                  {statusQuery.isFetching ? <Loader2 className="size-4 animate-spin" /> : <Clock className="size-4" />}
                  Refresh
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="size-4" /> Last Sync Run Detail</CardTitle>
              <CardDescription>Telemetry from the most recent sync (written after completion).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {s?.last_run ? (
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <dt className="text-muted-foreground">Kind</dt>
                  <dd className="font-medium capitalize">{s.last_run.kind}</dd>
                  <dt className="text-muted-foreground">Triggered By</dt>
                  <dd className="font-medium">{s.last_run.triggered_by}</dd>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="font-medium">
                    {s.last_run.status === "ok" ? (
                      <span className="flex items-center gap-1 text-green-600"><CheckCircle className="size-4" /> OK</span>
                    ) : (
                      <span className="flex items-center gap-1 text-red-600"><XCircle className="size-4" /> Error</span>
                    )}
                  </dd>
                  <dt className="text-muted-foreground">Duration</dt>
                  <dd className="font-medium">{s.last_run.duration_secs}s</dd>
                  <dt className="text-muted-foreground">Started</dt>
                  <dd className="font-medium">{s.last_run.started_at ? format(new Date(s.last_run.started_at), "PPp") : "—"}</dd>
                  <dt className="text-muted-foreground">Finished</dt>
                  <dd className="font-medium">{s.last_run.finished_at ? format(new Date(s.last_run.finished_at), "PPp") : "—"}</dd>
                  <dt className="text-muted-foreground">Tickets / Users / Groups</dt>
                  <dd className="font-medium">{s.last_run.tickets} / {s.last_run.users} / {s.last_run.groups}</dd>
                </dl>
              ) : (
                <p className="text-muted-foreground">No sync run recorded yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}