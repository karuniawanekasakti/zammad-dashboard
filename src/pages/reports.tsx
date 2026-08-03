import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ExportFormat, ExportType } from "@/types";

const REPORT_TYPES: { value: ExportType; label: string; description: string }[] = [
  { value: "agent_performance", label: "Agent Performance", description: "Per-agent KPI breakdown" },
  { value: "sla_summary", label: "SLA Summary", description: "Breached / at-risk ticket list" },
  { value: "ticket_volume", label: "Ticket Volume", description: "Daily volume by priority" },
  { value: "group_stats", label: "Group Statistics", description: "Group-level KPIs and trends" },
];

export default function ReportsPage() {
  const qc = useQueryClient();
  const exports = useQuery({ queryKey: ["exports"], queryFn: () => api.listExports(), refetchInterval: 2_000 });
  const [reportType, setReportType] = useState<ExportType>("agent_performance");
  const [fmt, setFmt] = useState<ExportFormat>("pdf");
  const today = format(new Date(), "yyyy-MM-dd");
  const thirtyDaysAgo = format(new Date(Date.now() - 30 * 24 * 3600 * 1000), "yyyy-MM-dd");
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);

  const create = useMutation({
    mutationFn: () =>
      api.createExport({
        report_type: reportType,
        format: fmt,
        parameters: { date_from: dateFrom, date_to: dateTo },
      }),
    onSuccess: () => {
      toast.success("Export queued — we'll ping you when it's ready");
      qc.invalidateQueries({ queryKey: ["exports"] });
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Reports" description="Generate PDF / Excel exports on demand." />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">New export</CardTitle>
            <CardDescription>Queue a report for generation</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Report type</Label>
              <Select value={reportType} onValueChange={(v) => setReportType(v as ExportType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      <div>
                        <div>{r.label}</div>
                        <div className="text-xs text-muted-foreground">{r.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Format</Label>
              <Select value={fmt} onValueChange={(v) => setFmt(v as ExportFormat)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">PDF</SelectItem>
                  <SelectItem value="xlsx">Excel (.xlsx)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>From</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>To</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
            <Button className="w-full" onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending && <Loader2 className="size-4 animate-spin" />}
              Generate report
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">My exports</CardTitle>
            <CardDescription>Reports expire 24h after completion</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead>Range</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(exports.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No exports yet.
                    </TableCell>
                  </TableRow>
                )}
                {(exports.data ?? []).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {e.format === "pdf" ? <FileText className="size-4 text-destructive" /> : <FileSpreadsheet className="size-4 text-emerald-500" />}
                        {REPORT_TYPES.find((r) => r.value === e.report_type)?.label ?? e.report_type}
                      </div>
                    </TableCell>
                    <TableCell className="uppercase text-xs">{e.format}</TableCell>
                    <TableCell className="text-xs">
                      {(e.parameters as { date_from?: string }).date_from} → {(e.parameters as { date_to?: string }).date_to}
                    </TableCell>
                    <TableCell>
                      <StatusPill status={e.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={e.status !== "ready"}
                        onClick={() => toast.info("Download would stream from /api/v1/reports/exports/:id/download")}
                      >
                        <Download className="size-3.5" />
                        Download
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { variant: "secondary" | "warning" | "success" | "destructive"; label: string }> = {
    queued: { variant: "secondary", label: "Queued" },
    generating: { variant: "warning", label: "Generating…" },
    ready: { variant: "success", label: "Ready" },
    failed: { variant: "destructive", label: "Failed" },
  };
  const m = map[status] ?? map.queued;
  return <Badge variant={m.variant}>{m.label}</Badge>;
}
