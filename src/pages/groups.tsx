import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bar, BarChart, ResponsiveContainer } from "recharts";
import { api } from "@/lib/api";
import { useScope } from "@/stores/auth";
import { PageHeader } from "@/components/page-header";
import { PageLoader } from "@/components/spinner";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPercent, formatSeconds, formatNumber } from "@/lib/utils";

export default function GroupsPage() {
  const scope = useScope();
  const { data, isLoading } = useQuery({
    queryKey: ["groups", scope],
    queryFn: () => api.listGroups(scope),
  });
  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-4">
      <PageHeader title="Groups" description="Team-level workload and SLA metrics." />
      <Card>
        <CardContent className="pt-6">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Group</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <TableHead className="text-right">New today</TableHead>
                  <TableHead className="text-right">Closed today</TableHead>
                  <TableHead className="text-right">Avg 1st reply</TableHead>
                  <TableHead className="text-right">Avg resolution</TableHead>
                  <TableHead className="text-right">SLA breach</TableHead>
                  <TableHead>Trend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data ?? []).map((s) => (
                  <TableRow key={s.group.id} className="hover:bg-muted/40">
                    <TableCell>
                      <Link className="font-medium hover:underline" to={`/groups/${s.group.id}`}>
                        {s.group.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{s.group.agent_count} agents</div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatNumber(s.open_tickets)}</TableCell>
                    <TableCell className="text-right font-mono">{s.new_today}</TableCell>
                    <TableCell className="text-right font-mono">{s.closed_today}</TableCell>
                    <TableCell className="text-right font-mono">{formatSeconds(s.avg_first_reply_secs)}</TableCell>
                    <TableCell className="text-right font-mono">{formatSeconds(s.avg_resolution_secs)}</TableCell>
                    <TableCell className="text-right font-mono">{formatPercent(s.sla_breach_rate)}</TableCell>
                    <TableCell className="min-w-[120px] h-10">
                      <ResponsiveContainer width="100%" height={36}>
                        <BarChart data={s.trend}>
                          <Bar dataKey="value" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </TableCell>
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
