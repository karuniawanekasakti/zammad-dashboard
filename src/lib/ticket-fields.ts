import type { Ticket } from "@/types";
import type { DataTableFilterField, DataTableOption } from "@/components/data-table/types";

export const TICKET_FIELDS = [
  { key: "number", label: "#", filter: "text", sortable: true },
  { key: "title", label: "Title", filter: "text", sortable: true },
  { key: "state", label: "State", filter: "select", sortable: true },
  { key: "severity", label: "Severity", filter: "select", sortable: true },
  { key: "ticket_category", label: "Ticket Category", filter: "select", sortable: true },
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

export const SLA_OPTIONS: DataTableOption[] = [
  { value: "safe", label: "Safe" },
  { value: "warning", label: "Warning" },
  { value: "critical", label: "Critical" },
  { value: "breached", label: "Breached" },
];

export const SEVERITY_OPTIONS: DataTableOption[] = [
  { value: "p01", label: "P1 - Critical" },
  { value: "p02", label: "P2 - High" },
  { value: "p03", label: "P3 - Medium" },
  { value: "p04", label: "P4 - Low" },
  { value: "BRI01", label: "BRI Critical 1 (0-30 KM)" },
  { value: "BRI02", label: "BRI Critical 2 (30-60 KM)" },
  { value: "BRI03", label: "BRI Critical 3 (60-120 KM)" },
  { value: "BRI04", label: "BRI Critical 4 (120-200 KM)" },
];

export const TICKET_CATEGORY_OPTIONS: DataTableOption[] = [
  { value: "HSU", label: "Hardware Software Update" },
  { value: "SRSM", label: "Service Request Support and Management" },
  { value: "SPMS", label: "SparePart Management System" },
  { value: "Reporting", label: "Reporting" },
];

export function buildTicketFilterFields(groups: DataTableOption[], agents: DataTableOption[]): DataTableFilterField<Ticket>[] {
  return [
    { id: "number", label: "#", variant: "text" },
    { id: "title", label: "Title", variant: "text" },
    { id: "customer_name", label: "Customer", variant: "text" },
    { id: "state", label: "State", variant: "select", options: STATE_OPTIONS },
    { id: "severity", label: "Severity", variant: "select", options: SEVERITY_OPTIONS },
    { id: "ticket_category", label: "Ticket Category", variant: "select", options: TICKET_CATEGORY_OPTIONS },
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
