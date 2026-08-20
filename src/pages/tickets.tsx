import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { PaginationState, VisibilityState } from "@tanstack/react-table";
import { api } from "@/lib/api";
import { useScope } from "@/stores/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TicketsTable } from "@/components/tickets/tickets-table";
import type { DataTableFilter, DataTableSort } from "@/components/data-table/types";
import type { Ticket, TicketState } from "@/types";

const STATE_TABS: { value: TicketState | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "closed", label: "Closed" },
];

const EMPTY_TICKETS: Ticket[] = [];

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadTicketsCsv(rows: Ticket[]) {
  const headers = ["Number", "Title", "State", "Severity", "Ticket Category", "Group", "Agent", "Customer", "SLA", "Updated"];
  const body = rows.map((ticket) => [
    ticket.number,
    ticket.title,
    ticket.state,
    ticket.severity_label ?? ticket.severity,
    ticket.ticket_category_label ?? ticket.ticket_category,
    ticket.group_name,
    ticket.owner_name ?? "Unassigned",
    ticket.customer_name,
    ticket.sla_status,
    ticket.zammad_updated_at,
  ]);
  const csv = [headers, ...body].map((row) => row.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `tickets-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function TicketsPage() {
  const nav = useNavigate();
  const scope = useScope();
  const scopeKey = `${scope.role}:${scope.user_id}:${scope.group_ids.join(",")}`;
  const [search, setSearch] = useState("");
  const [state, setState] = useState<TicketState | "all">("all");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [filters, setFilters] = useState<DataTableFilter[]>([]);
  const [sorts, setSorts] = useState<DataTableSort[]>([
    { id: "zammad_updated_at", field: "zammad_updated_at", desc: true },
  ]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const resetPage = useCallback(() => setPagination((current) => ({ ...current, pageIndex: 0 })), []);
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    resetPage();
  }, [resetPage]);
  const handleFiltersChange = useCallback((next: DataTableFilter[]) => {
    setFilters(next);
    resetPage();
  }, [resetPage]);
  const handleSortsChange = useCallback((next: DataTableSort[]) => {
    setSorts(next);
    resetPage();
  }, [resetPage]);

  const filtersParam = useMemo(() => JSON.stringify(filters), [filters]);
  const sortsParam = useMemo(() => JSON.stringify(sorts), [sorts]);
  const legacyFilter = useCallback(
    (field: string) => filters.find((filter) => filter.field === field && filter.operator === "equals" && filter.value && filter.value !== "__empty__")?.value,
    [filters]
  );

  const groups = useQuery({ queryKey: ["groups-filter"], queryFn: () => api.listAllGroupsForFilter() });
  const agents = useQuery({ queryKey: ["agents-filter"], queryFn: () => api.listAllAgentsForFilter() });
  const tickets = useQuery({
    queryKey: ["tickets", scopeKey, search, state, filtersParam, sortsParam, pagination],
    queryFn: () =>
      api.listTickets(scope, {
        search,
        state: state !== "all" ? state : (legacyFilter("state") as TicketState | undefined),
        priority: legacyFilter("priority") as Ticket["priority"] | undefined,
        group_id: legacyFilter("group_id"),
        owner_id: legacyFilter("owner_id"),
        filters: filtersParam,
        sorts: sortsParam,
        page: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      }),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Tickets" description="Browse, filter and drill into tickets." />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <Tabs
            value={state}
            onValueChange={(value) => {
              setState(value as typeof state);
              resetPage();
            }}
          >
            <TabsList>
              {STATE_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <TicketsTable
            rows={tickets.data?.rows ?? EMPTY_TICKETS}
            total={tickets.data?.total ?? 0}
            pagination={pagination}
            onPaginationChange={setPagination}
            sorts={sorts}
            onSortsChange={handleSortsChange}
            filters={filters}
            onFiltersChange={handleFiltersChange}
            search={search}
            onSearchChange={handleSearchChange}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            groups={groups.data ?? []}
            agents={agents.data ?? []}
            isLoading={tickets.isLoading}
            onView={(ticket) => nav(`/tickets/${ticket.id}`)}
            onExport={() => downloadTicketsCsv(tickets.data?.rows ?? EMPTY_TICKETS)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
