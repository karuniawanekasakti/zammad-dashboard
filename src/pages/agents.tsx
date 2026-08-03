import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Clock, Gauge } from "lucide-react";
import { api } from "@/lib/api";
import { useScope } from "@/stores/auth";
import { PageHeader } from "@/components/page-header";
import { PageLoader } from "@/components/spinner";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { fullName } from "@/lib/mock-data";
import { formatPercent, formatSeconds, formatNumber } from "@/lib/utils";
import { useState } from "react";

export default function AgentsPage() {
  const nav = useNavigate();
  const scope = useScope();
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["agents", scope],
    queryFn: () => api.listAgents(scope),
  });
  if (isLoading) return <PageLoader />;
  const filtered = (data ?? []).filter((s) => fullName(s.agent).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <PageHeader title="Agents" description="Workload, SLA and KPI overview per agent." />
      <Card>
        <CardContent className="pt-6 space-y-4">
          <Input placeholder="Search agents…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <TableHead className="text-right">At risk</TableHead>
                  <TableHead className="text-right">Breached</TableHead>
                  <TableHead className="text-right">Avg 1st reply</TableHead>
                  <TableHead className="text-right">Avg resolution</TableHead>
                  <TableHead className="text-right">Breach rate</TableHead>
                  <TableHead className="text-right">Reopen rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => (
                  <TableRow
                    key={s.agent.id}
                    className="cursor-pointer"
                    onClick={() => nav(`/agents/${s.agent.id}`)}
                  >
                    <TableCell className="flex items-center gap-2">
                      <UserAvatar user={s.agent} size="sm" />
                      <div>
                        <div className="font-medium">{fullName(s.agent)}</div>
                        <div className="text-xs text-muted-foreground">{s.agent.email}</div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatNumber(s.open_tickets)}</TableCell>
                    <TableCell className="text-right">
                      {s.at_risk > 0 ? <Badge variant="warning">{s.at_risk}</Badge> : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.breached > 0 ? <Badge variant="destructive">{s.breached}</Badge> : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono"><Clock className="inline size-3 mr-1 text-muted-foreground" />{formatSeconds(s.avg_first_reply_secs)}</TableCell>
                    <TableCell className="text-right font-mono">{formatSeconds(s.avg_resolution_secs)}</TableCell>
                    <TableCell className="text-right font-mono"><Gauge className="inline size-3 mr-1 text-muted-foreground" />{formatPercent(s.sla_breach_rate)}</TableCell>
                    <TableCell className="text-right font-mono"><AlertTriangle className="inline size-3 mr-1 text-muted-foreground" />{formatPercent(s.reopen_rate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
