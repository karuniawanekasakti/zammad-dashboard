import { useMemo } from "react";
import type { ColumnDef, OnChangeFn, PaginationState, VisibilityState } from "@tanstack/react-table";
import { ArrowUpDown, Eye, RotateCcw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableAdvancedToolbar } from "@/components/data-table/data-table-advanced-toolbar";
import type { DataTableFilter, DataTableOption, DataTableSort } from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateBadge, PriorityBadge } from "@/components/status-badges";
import { SlaBadge } from "@/components/sla-badge";
import { buildTicketFilterFields, ticketSortFields } from "@/lib/ticket-fields";
import type { Group, Ticket, User } from "@/types";

interface TicketsTableProps {
  rows: Ticket[];
  total: number;
  pagination: PaginationState;
  onPaginationChange: OnChangeFn<PaginationState>;
  sorts: DataTableSort[];
  onSortsChange: (sorts: DataTableSort[]) => void;
  filters: DataTableFilter[];
  onFiltersChange: (filters: DataTableFilter[]) => void;
  search: string;
  onSearchChange: (search: string) => void;
  columnVisibility: VisibilityState;
  onColumnVisibilityChange: OnChangeFn<VisibilityState>;
  groups: Group[];
  agents: User[];
  onView: (ticket: Ticket) => void;
  onExport?: () => void;
}

export function TicketsTable({
  rows,
  total,
  pagination,
  onPaginationChange,
  sorts,
  onSortsChange,
  filters,
  onFiltersChange,
  search,
  onSearchChange,
  columnVisibility,
  onColumnVisibilityChange,
  groups,
  agents,
  onView,
  onExport,
}: TicketsTableProps) {
  const columns = useMemo<ColumnDef<Ticket>[]>(() => ticketColumns(onView), [onView]);
  const groupOptions = useMemo<DataTableOption[]>(
    () => groups.map((group) => ({ value: group.id, label: group.name })),
    [groups]
  );
  const agentOptions = useMemo<DataTableOption[]>(
    () => agents.map((agent) => ({ value: agent.id, label: `${agent.firstname} ${agent.lastname}` })),
    [agents]
  );
  const filterFields = useMemo(() => buildTicketFilterFields(groupOptions, agentOptions), [groupOptions, agentOptions]);
  const sortFields = useMemo(() => ticketSortFields(), []);

  return (
    <DataTable
      columns={columns}
      data={rows}
      rowCount={total}
      pagination={pagination}
      onPaginationChange={onPaginationChange}
      sorting={sorts.map((sort) => ({ id: sort.field, desc: sort.desc }))}
      onSortingChange={() => undefined}
      columnVisibility={columnVisibility}
      onColumnVisibilityChange={onColumnVisibilityChange}
      meta={{ sorts, onSortsChange }}
      emptyMessage="No tickets match the current filters."
      onRowClick={onView}
      toolbar={(table) => (
        <DataTableAdvancedToolbar
          table={table}
          search={search}
          onSearchChange={onSearchChange}
          filterFields={filterFields}
          filters={filters}
          onFiltersChange={onFiltersChange}
          sortFields={sortFields}
          sorts={sorts}
          onSortsChange={onSortsChange}
          onExport={onExport}
          exportLabel="Export Excel"
        />
      )}
    />
  );
}

function SortHeader({ label, field, sorts, onSortsChange }: { label: string; field: string; sorts: DataTableSort[]; onSortsChange: (sorts: DataTableSort[]) => void }) {
  const sort = sorts.find((item) => item.field === field);
  return (
    <button
      className="inline-flex items-center gap-1 hover:text-foreground"
      onClick={() => onSortsChange([{ id: field, field, desc: sort ? !sort.desc : false }])}
    >
      {label}
      <ArrowUpDown className="size-3" />
    </button>
  );
}

function ticketColumns(onView: (ticket: Ticket) => void): ColumnDef<Ticket>[] {
  return [
    {
      accessorKey: "number",
      header: "#",
      meta: { label: "#" },
      cell: ({ row }) => <span className="font-mono text-xs">#{row.original.number}</span>,
    },
    {
      accessorKey: "title",
      header: "Title",
      meta: { label: "Title" },
      cell: ({ row }) => (
        <div className="max-w-md">
          <div className="truncate font-medium">{row.original.title}</div>
          <div className="truncate text-xs text-muted-foreground">
            {row.original.customer_name} · {row.original.group_name}
            {row.original.reopen_count > 0 && (
              <Badge variant="muted" className="ml-2 gap-0.5 px-1 py-0 text-[10px]">
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
      meta: { label: "State" },
      cell: ({ row }) => <StateBadge state={row.original.state} />,
    },
    {
      accessorKey: "priority",
      header: "Priority",
      meta: { label: "Priority" },
      cell: ({ row }) => <PriorityBadge priority={row.original.priority} />,
    },
    {
      accessorKey: "owner_name",
      header: "Agent",
      meta: { label: "Agent" },
      cell: ({ row }) => row.original.owner_name ?? <span className="text-muted-foreground">Unassigned</span>,
    },
    {
      accessorKey: "sla_status",
      header: "SLA",
      meta: { label: "SLA" },
      cell: ({ row }) => <SlaBadge status={row.original.sla_status} remainingSecs={row.original.first_response_remaining_secs} compact />,
    },
    {
      accessorKey: "zammad_updated_at",
      header: ({ table }) => {
        const meta = table.options.meta as { sorts?: DataTableSort[]; onSortsChange?: (sorts: DataTableSort[]) => void } | undefined;
        return <SortHeader label="Updated" field="zammad_updated_at" sorts={meta?.sorts ?? []} onSortsChange={meta?.onSortsChange ?? (() => undefined)} />;
      },
      meta: { label: "Updated" },
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(row.original.zammad_updated_at), { addSuffix: true })}
        </span>
      ),
    },
    {
      id: "actions",
      enableHiding: false,
      header: "",
      meta: { label: "Actions", sticky: "right" },
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={(event) => {
            event.stopPropagation();
            onView(row.original);
          }}
          aria-label={`View ticket ${row.original.number}`}
        >
          <Eye className="size-4" />
        </Button>
      ),
    },
  ];
}
