import { useEffect, useRef, useState } from "react";
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
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function SettingsPage() {
  const qc = useQueryClient();

  const settingsKey = ["settings", "bundle"] as const;
  const statusKey = ["settings", "status"] as const;
  const settings = useQuery({ queryKey: settingsKey, queryFn: () => api.getSettings() });
  const statusQuery = useQuery({
    queryKey: statusKey,
    queryFn: () => api.getSettingsStatus(),
    refetchInterval: (query) => query.state.error || !query.state.data?.execution ? 30000 : 2000,
  });
  const previousExecution = useRef<string | null>(null);

  const s = settings.data;
  const [confirmFull, setConfirmFull] = useState(false);
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

  const handleTriggerResult = (result: Awaited<ReturnType<typeof api.triggerSyncByKind>>) => {
    if (result.error) toast.error(result.error);
    else if (result.attached) toast.info("Attached to the active sync operation");
    else toast.success(result.kind === "full" ? "Full Reconcile queued" : "Incremental Sync queued");
    qc.invalidateQueries({ queryKey: statusKey });
  };

  const triggerIncremental = useMutation({
    mutationFn: () => api.triggerSyncByKind("incremental"),
    onSuccess: handleTriggerResult,
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  const triggerFull = useMutation({
    mutationFn: () => api.triggerSyncByKind("full"),
    onSuccess: (result) => {
      setConfirmFull(false);
      handleTriggerResult(result);
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
  const statusUnavailable = Boolean(statusQuery.error);
  useEffect(() => {
    const operationId = st?.execution?.operation_id ?? null;
    if (previousExecution.current && !operationId) {
      qc.invalidateQueries({ queryKey: settingsKey });
    }
    previousExecution.current = operationId;
  }, [qc, st?.execution?.operation_id]);
  const freshness = syncStatus?.freshness;
  const execution = syncStatus?.execution;
  const latestAttempt = syncStatus?.latest_attempt;
  const activeLabel = execution
    ? `${execution.kind === "full" ? "Full Reconcile" : "Incremental Sync"} · ${execution.source ?? execution.triggered_by}`
    : null;
  const phaseLabels = {
    queued: "Queued",
    fetching_tickets: "Fetching tickets",
    fetching_users: "Fetching users",
    fetching_groups: "Fetching groups",
    syncing_histories: "Syncing histories",
    finalizing: "Finalizing",
  } as const;
  const phaseLabel = execution?.phase ? phaseLabels[execution.phase] : execution?.status;
  const syncBusy = Boolean(execution) || statusUnavailable || triggerIncremental.isPending || triggerFull.isPending;
  const freshnessLabel = statusUnavailable ? "Status unavailable" : {
    never_synced: "Never Synced",
    up_to_date: "Up to Date",
    out_of_date: "Out of Date",
  }[freshness?.status ?? "never_synced"];
  const freshnessVariant = statusUnavailable ? "destructive" : freshness?.status === "up_to_date" ? "success" : freshness?.status === "out_of_date" ? "warning" : "secondary";

  const healthBadge = (v: string) => statusUnavailable
    ? <Badge variant="secondary">Status unavailable</Badge>
    : v === "ok" ? <Badge variant="success">Online</Badge> : <Badge variant="destructive">Down</Badge>;

  return (
    <div className="space-y-4">
      <PageHeader title="System Settings" description="Admin-only. Worker config, manual sync, health monitoring." />

      <Card>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-3">
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
            {statusUnavailable ? (
              <p className="text-xs text-destructive">Last-known values may be stale. Triggers are disabled until status recovers.</p>
            ) : freshness?.status === "never_synced" && (
              <p className="text-xs text-muted-foreground">No successful synchronization checkpoint is available.</p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Sync execution</p>
            {execution ? (
              <div className="flex items-center gap-2">
                <Badge variant="warning">{statusUnavailable ? "Status unavailable" : execution.status === "queued" ? "Queued" : execution.kind === "full" ? "Running Full Reconcile" : "Running Incremental Sync"}</Badge>
                <span className="text-xs text-muted-foreground capitalize">{execution.source ?? execution.triggered_by}</span>
              </div>
            ) : (
              <Badge variant="secondary">{statusUnavailable ? "Status unavailable" : "Idle"}</Badge>
            )}
            {statusUnavailable && <p className="text-xs text-destructive">Last-known execution may be stale; current state is unknown.</p>}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Latest sync attempt</p>
            {statusUnavailable && <p className="text-xs text-destructive">Status unavailable · last-known outcome</p>}
            {latestAttempt ? (
              <div className="flex items-center gap-2">
                <Badge variant={latestAttempt.status === "succeeded" ? "success" : latestAttempt.status === "failed" ? "destructive" : "warning"}>
                  {latestAttempt.status === "queued" ? "Queued" : latestAttempt.status === "running" ? "Running" : latestAttempt.status === "succeeded" ? "Succeeded" : latestAttempt.status === "failed" ? "Failed" : "Interrupted"}
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
                  disabled={syncBusy}
                  title={statusUnavailable ? "Disabled while sync status is unavailable" : activeLabel ? `Disabled while ${activeLabel} is active` : undefined}
                >
                  {triggerIncremental.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  Trigger Incremental
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setConfirmFull(true)}
                  disabled={syncBusy}
                  title={statusUnavailable ? "Disabled while sync status is unavailable" : activeLabel ? `Disabled while ${activeLabel} is active` : undefined}
                >
                  {triggerFull.isPending ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />}
                  Trigger Full Reconcile
                </Button>
              </div>
              {activeLabel && <p className="text-xs text-muted-foreground">Controls are disabled while {activeLabel} is active.</p>}

              {execution && (
                <div className="space-y-2 rounded-md border p-3 text-sm">
                  <div className="flex items-center gap-2">
                    {execution.percentage == null && <Loader2 className="size-4 animate-spin" />}
                    <span className="font-medium">{phaseLabel}</span>
                    {execution.percentage != null && <span className="ml-auto tabular-nums">{execution.percentage}%</span>}
                  </div>
                  {execution.percentage != null && (
                    <Progress value={execution.percentage} aria-label={`${phaseLabel} ${execution.percentage}%`} />
                  )}
                  <p className="text-xs text-muted-foreground">
                    Tickets {execution.processed?.tickets ?? 0} · Users {execution.processed?.users ?? 0} · Groups {execution.processed?.groups ?? 0} · Histories {execution.processed?.histories ?? 0}
                  </p>
                  {execution.known_total != null && <p className="text-xs text-muted-foreground">Phase items {execution.completed ?? 0} of {execution.known_total}</p>}
                  {execution.lease_expires_at && <p className="text-xs text-muted-foreground">Lease expires {format(new Date(execution.lease_expires_at), "PPp")}</p>}
                </div>
              )}

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
              <CardDescription>
                Dependency snapshot {syncStatus?.health.snapshot_at ? formatDistanceToNow(new Date(syncStatus.health.snapshot_at), { addSuffix: true }) : "unavailable"}. Execution refreshes every 2 s during sync; dependency probes are reused for up to 15 s.
              </CardDescription>
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
                      {statusUnavailable ? "Last-known evidence" : st?.worker?.reachable ?? s?.worker?.reachable ? "Reachable" : "Unreachable"}
                    </p>
                    {statusUnavailable ? (
                      <Badge variant="secondary">Status unavailable</Badge>
                    ) : st?.worker?.reachable ?? s?.worker?.reachable ? (
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
                    ) : latestAttempt.status === "queued" || latestAttempt.status === "running" ? (
                      <span className="flex items-center gap-1"><Loader2 className="size-4 animate-spin" /> {latestAttempt.status === "queued" ? "Queued" : "Running"}</span>
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
                  <dd className="font-medium">{latestAttempt.processed?.tickets ?? latestAttempt.tickets ?? 0} / {latestAttempt.processed?.users ?? latestAttempt.users ?? 0} / {latestAttempt.processed?.groups ?? latestAttempt.groups ?? 0}</dd>
                  {latestAttempt.error && (
                    <>
                      <dt className="text-muted-foreground">Error</dt>
                      <dd className="font-medium text-destructive">{latestAttempt.error}</dd>
                    </>
                  )}
                </dl>
              ) : (
                <p className="text-muted-foreground">No sync run recorded yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={confirmFull} onOpenChange={setConfirmFull}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run Full Reconcile?</DialogTitle>
            <DialogDescription>
              Full Reconcile scans all tickets, users, groups, and ticket histories. It may take several minutes and shares the same operation slot as Incremental Sync.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmFull(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => triggerFull.mutate()} disabled={triggerFull.isPending}>
              {triggerFull.isPending && <Loader2 className="size-4 animate-spin" />}
              Run Full Reconcile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}