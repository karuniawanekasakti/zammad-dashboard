import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, RotateCcw, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/lib/api";
import { useScope } from "@/stores/auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StateBadge, PriorityBadge } from "@/components/status-badges";
import { SlaBadge } from "@/components/sla-badge";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Ticket, TicketState } from "@/types";

const STATE_TABS: { value: TicketState | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "closed", label: "Closed" },
];

export default function TicketsPage() {
  const nav = useNavigate();
  const scope = useScope();
  const [search, setSearch] = useState("");
  const [state, setState] = useState<TicketState | "all">("all");
  const [priority, setPriority] = useState<"all" | "low" | "normal" | "high" | "very high">("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [sorting, setSorting] = useState<SortingState>([]);

  const groups = useQuery({ queryKey: ["groups-filter"], queryFn: () => api.listAllGroupsForFilter() });
  const agents = useQuery({ queryKey: ["agents-filter"], queryFn: () => api.listAllAgentsForFilter() });
  const tickets = useQuery({
    queryKey: ["tickets", scope, search, state, priority, groupFilter, agentFilter, page],
    queryFn: () =>
      api.listTickets(scope, {
        search,
        state,
        priority,
        group_id: groupFilter,
        owner_id: agentFilter,
        page,
        page_size: pageSize,
      }),
  });

  const columns = useMemo<ColumnDef<Ticket>[]>(
    () => [
      {
        accessorKey: "number",
        header: "#",
        cell: ({ row }) => <span className="font-mono text-xs">#{row.original.number}</span>,
      },
      {
        accessorKey: "title",
        header: "Title",
        cell: ({ row }) => (
          <div className="max-w-md">
            <div className="font-medium truncate">{row.original.title}</div>
            <div className="text-xs text-muted-foreground truncate">
              {row.original.customer_name} · {row.original.group_name}
              {row.original.reopen_count > 0 && (
                <Badge variant="muted" className="ml-2 text-[10px] py-0 px-1 gap-0.5">
                  <RotateCcw className="size-2.5" /> x{row.original.reopen_count}
                </Badge>
              )}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "state",
        header: "State",
        cell: ({ row }) => <StateBadge state={row.original.state} />,
      },
      {
        accessorKey: "priority",
        header: "Priority",
        cell: ({ row }) => <PriorityBadge priority={row.original.priority} />,
      },
      {
        accessorKey: "owner_name",
        header: "Agent",
        cell: ({ row }) => row.original.owner_name ?? <span className="text-muted-foreground">Unassigned</span>,
      },
      {
        accessorKey: "sla_status",
        header: "SLA",
        cell: ({ row }) => (
          <SlaBadge status={row.original.sla_status} remainingSecs={row.original.first_response_remaining_secs} compact />
        ),
      },
      {
        accessorKey: "zammad_updated_at",
        header: ({ column }) => (
          <button
            className="inline-flex items-center gap-1 hover:text-foreground"
            onClick={() => column.toggleSorting()}
          >
            Updated
            <ArrowUpDown className="size-3" />
          </button>
        ),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(row.original.zammad_updated_at), { addSuffix: true })}
          </span>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data: tickets.data?.rows ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const total = tickets.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <PageHeader title="Tickets" description="Browse, filter and drill into tickets." />

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-col md:flex-row gap-3 md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search by title, number, or customer…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-8"
              />
            </div>
            <Select value={priority} onValueChange={(v) => { setPriority(v as typeof priority); setPage(1); }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="very high">Very high</SelectItem>
              </SelectContent>
            </Select>
            <Select value={groupFilter} onValueChange={(v) => { setGroupFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups</SelectItem>
                {(groups.data ?? []).map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={agentFilter} onValueChange={(v) => { setAgentFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agents</SelectItem>
                {(agents.data ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.firstname} {a.lastname}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Tabs value={state} onValueChange={(v) => { setState(v as typeof state); setPage(1); }}>
            <TabsList>
              {STATE_TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => (
                      <TableHead key={h.id}>
                        {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="text-center text-muted-foreground py-12">
                      No tickets match the current filters.
                    </TableCell>
                  </TableRow>
                )}
                {table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => nav(`/tickets/${row.original.id}`)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div>
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                Previous
              </Button>
              <span>
                Page {page} of {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={page >= pageCount}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
