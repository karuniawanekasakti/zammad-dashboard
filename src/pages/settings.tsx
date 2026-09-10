import { useEffect, useState } from "react";
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

  const settingsKey = ["settings", "bundle"] as const;
  const statusKey = ["settings", "status"] as const;
  const settings = useQuery({ queryKey: settingsKey, queryFn: () => api.getSettings() });
  const statusQuery = useQuery({ queryKey: statusKey, queryFn: () => api.getSettingsStatus(), refetchInterval: 30000 });

  const s = settings.data;
  const [schedules, setSchedules] = useState({ incremental_seconds: 300, full_reconcile_seconds: 21600 });
  useEffect(() => {
    if (s?.schedules) setSchedules(s.schedules);
  }, [s?.schedules]);

  const saveSchedules = useMutation({
    mutationFn: (patch: { incremental_seconds: number; full_reconcile_seconds: number }) => api.updateSchedules(patch),
    onSuccess: () => {
      toast.success("Schedules saved — applies on next beat tick");
      qc.invalidateQueries({ queryKey: settingsKey });
      qc.invalidateQueries({ queryKey: statusKey });
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const triggerIncremental = useMutation({
    mutationFn: () => api.triggerSyncByKind("incremental"),
    onSuccess: () => {
      toast.success("Incremental sync triggered");
      qc.invalidateQueries({ queryKey: statusKey });
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const triggerFull = useMutation({
    mutationFn: () => api.triggerSyncByKind("full"),
    onSuccess: () => {
      toast.success("Full reconcile triggered");
      qc.invalidateQueries({ queryKey: statusKey });
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const purgeCache = useMutation({
    mutationFn: () => api.purgeCache(),
    onSuccess: (res) => {
      toast.success(`Cache purged: ${res.purged} keys`);
      qc.invalidateQueries({ queryKey: statusKey });
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const st = statusQuery.data;
  const syncStatus = st ?? s;
  const freshness = syncStatus?.freshness;
  const latestAttempt = syncStatus?.latest_attempt;
  const freshnessLabel = {
    never_synced: "Never Synced",
    up_to_date: "Up to Date",
    out_of_date: "Out of Date",
  }[freshness?.status ?? "never_synced"];
  const freshnessVariant = freshness?.status === "up_to_date" ? "success" : freshness?.status === "out_of_date" ? "warning" : "secondary";

  const healthBadge = (v: string) =>
    v === "ok" ? <Badge variant="success">Online</Badge> : <Badge variant="destructive">Down</Badge>;

  return (
    <div className="space-y-4">
      <PageHeader title="System Settings" description="Admin-only. Worker config, manual sync, health monitoring." />

      <Card>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Data freshness</p>
            <div className="flex items-center gap-2">
              <Badge variant={freshnessVariant}>{freshnessLabel}</Badge>
              {freshness?.last_success_at && (
                <span className="text-xs text-muted-foreground">
                  Last successful sync {formatDistanceToNow(new Date(freshness.last_success_at), { addSuffix: true })}
                </span>
              )}
            </div>
            {freshness?.status === "never_synced" && <p className="text-xs text-muted-foreground">No successful synchronization checkpoint is available.</p>}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Latest sync attempt</p>
            {latestAttempt ? (
              <div className="flex items-center gap-2">
                <Badge variant={latestAttempt.status === "succeeded" ? "success" : latestAttempt.status === "failed" ? "destructive" : "warning"}>
                  {latestAttempt.status === "succeeded" ? "Succeeded" : latestAttempt.status === "failed" ? "Failed" : "Interrupted"}
                </Badge>
                <span className="text-xs text-muted-foreground capitalize">
                  {latestAttempt.kind === "full" ? "Full Reconcile" : "Incremental Sync"} · {latestAttempt.triggered_by}
                </span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No sync attempt recorded yet.</p>
            )}
          </div>
        </CardContent>
      </Card>

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
                    onChange={(e) => setSchedules((current) => ({ ...current, incremental_seconds: parseInt(e.target.value, 10) }))}
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
                    onChange={(e) => setSchedules((current) => ({ ...current, full_reconcile_seconds: parseInt(e.target.value, 10) }))}
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
                  <p className="font-medium">{latestAttempt?.kind ? latestAttempt.kind.charAt(0).toUpperCase() + latestAttempt.kind.slice(1) : "—"}</p>
                  <p className="text-xs text-muted-foreground">Triggered by: {latestAttempt?.triggered_by ?? "—"}</p>
                </div>
                <div className="space-y-1 p-3 rounded border">
                  <p className="text-xs text-muted-foreground">Tickets / Users / Groups</p>
                  <p className="font-medium">
                    {latestAttempt?.tickets ?? 0} / {latestAttempt?.users ?? 0} / {latestAttempt?.groups ?? 0}
                  </p>
                </div>
                <div className="space-y-1 p-3 rounded border">
                  <p className="text-xs text-muted-foreground">Duration</p>
                  <p className="font-medium">{latestAttempt?.duration_secs ?? 0}s</p>
                  <p className="text-xs text-muted-foreground">{latestAttempt?.finished_at ? formatDistanceToNow(new Date(latestAttempt.finished_at), { addSuffix: true }) : "—"}</p>
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
              {latestAttempt ? (
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <dt className="text-muted-foreground">Kind</dt>
                  <dd className="font-medium capitalize">{latestAttempt.kind}</dd>
                  <dt className="text-muted-foreground">Triggered By</dt>
                  <dd className="font-medium">{latestAttempt.triggered_by}</dd>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="font-medium">
                    {latestAttempt.status === "succeeded" ? (
                      <span className="flex items-center gap-1 text-green-600"><CheckCircle className="size-4" /> Succeeded</span>
                    ) : (
                      <span className="flex items-center gap-1 text-red-600"><XCircle className="size-4" /> {latestAttempt.status === "failed" ? "Failed" : "Interrupted"}</span>
                    )}
                  </dd>
                  <dt className="text-muted-foreground">Duration</dt>
                  <dd className="font-medium">{latestAttempt.duration_secs}s</dd>
                  <dt className="text-muted-foreground">Started</dt>
                  <dd className="font-medium">{latestAttempt.started_at ? format(new Date(latestAttempt.started_at), "PPp") : "—"}</dd>
                  <dt className="text-muted-foreground">Finished</dt>
                  <dd className="font-medium">{latestAttempt.finished_at ? format(new Date(latestAttempt.finished_at), "PPp") : "—"}</dd>
                  <dt className="text-muted-foreground">Tickets / Users / Groups</dt>
                  <dd className="font-medium">{latestAttempt.tickets} / {latestAttempt.users} / {latestAttempt.groups}</dd>
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