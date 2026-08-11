import type { Ticket } from "@/types";
import type { DataTableFilterField, DataTableOption } from "@/components/data-table/types";

export const TICKET_FIELDS = [
  { key: "number", label: "#", filter: "text", sortable: true },
  { key: "title", label: "Title", filter: "text", sortable: true },
  { key: "state", label: "State", filter: "select", sortable: true },
  { key: "priority", label: "Priority", filter: "select", sortable: true },
  { key: "group_id", label: "Group", filter: "select", sortable: true },
  { key: "owner_id", label: "Agent", filter: "select", sortable: true },
  { key: "customer_name", label: "Customer", filter: "text", sortable: true },
  { key: "sla_status", label: "SLA", filter: "select", sortable: true },
  { key: "zammad_updated_at", label: "Updated", filter: "text", sortable: true },
] as const;

export const STATE_OPTIONS: DataTableOption[] = [
  { value: "new", label: "New" },
  { value: "open", label: "Open" },
  { value: "pending", label: "Pending" },
  { value: "closed", label: "Closed" },
  { value: "merged", label: "Merged" },
];

export const PRIORITY_OPTIONS: DataTableOption[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "very high", label: "Very high" },
];

export const SLA_OPTIONS: DataTableOption[] = [
  { value: "safe", label: "Safe" },
  { value: "warning", label: "Warning" },
  { value: "critical", label: "Critical" },
  { value: "breached", label: "Breached" },
];

export function buildTicketFilterFields(groups: DataTableOption[], agents: DataTableOption[]): DataTableFilterField<Ticket>[] {
  return [
    { id: "number", label: "#", variant: "text" },
    { id: "title", label: "Title", variant: "text" },
    { id: "customer_name", label: "Customer", variant: "text" },
    { id: "state", label: "State", variant: "select", options: STATE_OPTIONS },
    { id: "priority", label: "Priority", variant: "select", options: PRIORITY_OPTIONS },
    { id: "group_id", label: "Group", variant: "select", options: groups },
    { id: "owner_id", label: "Agent", variant: "select", options: agents },
    { id: "sla_status", label: "SLA", variant: "select", options: SLA_OPTIONS },
  ];
}

export function ticketSortFields(): DataTableFilterField<Ticket>[] {
  return TICKET_FIELDS.filter((field) => field.sortable).map((field) => ({
    id: field.key,
    label: field.label,
    variant: field.filter,
  }));
}
