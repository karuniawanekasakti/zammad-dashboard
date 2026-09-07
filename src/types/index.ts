export type Role = "admin" | "team_lead" | "project_manager" | "agent";

export interface User {
  id: string;
  zammad_id: number;
  email: string;
  firstname: string;
  lastname: string;
  login: string;
  role: Role;
  group_ids: string[];
  is_active: boolean;
  avatar_color?: string;
}

export interface Group {
  id: string;
  name: string;
  note?: string;
  active: boolean;
  agent_count: number;
}

export type TicketState = "new" | "open" | "pending" | "closed" | "merged";
export type TicketPriority = "low" | "normal" | "high" | "very high" | "unknown";
export type SlaStatus = "safe" | "on_track" | "warning" | "critical" | "breached" | "no_sla" | "closed_on_time";

export interface SlaPolicy {
  id: number;
  name: string;
  calendar_id: number | null;
  first_response_time: number | null;
  update_time: number | null;
  solution_time: number | null;
  condition: Record<string, { operator?: string; value?: string | number | Array<string | number> }>;
}

export interface Ticket {
  id: string;
  zammad_id: number;
  number: string;
  title: string;
  state: TicketState;
  priority: TicketPriority;
  priority_id: string;
  state_id: string;
  severity: string | null;
  severity_label: string | null;
  ticket_category: string | null;
  ticket_category_label: string | null;
  group_id: string;
  group_name: string;
  owner_id: string | null;
  owner_name: string | null;
  customer_name: string;
  tags: string[];
  sla_status: SlaStatus;
  escalation_at: string | null;
  first_response_at: string | null;
  first_response_escalation_at: string | null;
  first_response_in_min: number | null;
  first_response_diff_in_min: number | null;
  close_at: string | null;
  close_escalation_at: string | null;
  close_in_min: number | null;
  close_diff_in_min: number | null;
  update_escalation_at: string | null;
  update_diff_in_min: number | null;
  first_response_remaining_secs: number | null;
  first_response_breached: boolean;
  close_breached: boolean;
  reopen_count: number;
  first_reply_time_secs: number | null;
  resolution_time_secs: number | null;
  zammad_created_at: string;
  zammad_updated_at: string;
  closed_at: string | null;
  last_open_at?: string | null;
  last_reopen_at?: string | null;
}

export interface SlaMonitorTicket extends Ticket {
  actionable_deadline: string | null;
  live_sla_status: SlaStatus;
  sla_remaining_ms: number | null;
  sla_progress: number;
}

export interface SlaMonitorRow {
  id: string;
  name: string;
  total: number;
  total_with_sla: number;
  on_track: number;
  warning: number;
  critical: number;
  at_risk: number;
  breached: number;
  no_sla: number;
  compliance_rate: number | null;
}

export interface SlaMonitorTrendPoint {
  date: string;
  day: string;
  rate: number;
  total: number;
  breach: number;
}

export interface SlaMonitorData {
  compliance_rate: number | null;
  total_with_sla: number;
  total_closed_on_time: number;
  on_track: number;
  warning: number;
  critical: number;
  at_risk: number;
  breached: number;
  no_sla: number;
  avg_resolution_minutes: number | null;
  summary: {
    total: number;
    total_active: number;
    total_with_sla: number;
    sla_total: number;
    compliance_rate: number | null;
    total_closed_on_time: number;
    on_track: number;
    warning: number;
    critical: number;
    at_risk: number;
    breached: number;
    no_sla: number;
    avg_resolution_minutes: number | null;
    avg_resolution_mins: number | null;
  };
  by_priority: Record<string, SlaMonitorRow>;
  by_group: Record<string, SlaMonitorRow>;
  priority_rows: SlaMonitorRow[];
  sla_rows: SlaMonitorRow[];
  trend: SlaMonitorTrendPoint[];
  heatmap: { grid: number[][]; max: number };
  tickets: SlaMonitorTicket[];
  risk_rows: SlaMonitorTicket[];
  breach_log: Ticket[];
}

export interface TicketArticle {
  id: string;
  ticket_id: string;
  author_name: string;
  author_role: "agent" | "customer" | "system";
  type: "email" | "phone" | "note" | "web";
  internal: boolean;
  body: string;
  created_at: string;
}

export interface TicketHistory {
  id?: string | number;
  type?: string;
  action?: string;
  object?: string;
  attribute?: string;
  title?: string;
  body?: string;
  created_at?: string;
  updated_at?: string;
  created_by?: string | { firstname?: string; lastname?: string; login?: string; name?: string };
  from?: unknown;
  to?: unknown;
  old?: unknown;
  new?: unknown;
  value_from?: unknown;
  value_to?: unknown;
  related_o_id?: string | number;
  related_object?: string;
  changes?: Record<string, unknown> | unknown[];
  [key: string]: unknown;
}

export interface KpiSummary {
  total_open_tickets: number;
  total_closed_today: number;
  agents_online: number;
  total_agents: number;
  sla_breach_rate: number;
  avg_resolution_secs: number;
  avg_first_reply_secs: number;
  reopen_rate: number;
  new_today: number;
  at_risk: number;
}

export interface TrendPoint {
  date: string;
  value: number;
  secondary?: number;
}

export type OverviewPeriod = "year" | "month" | "week" | "day";
export type OverviewTab = "created" | "closed" | "open" | "reopened";

export interface OverviewPoint {
  label: string;
  created: number;
  closed: number;
  open: number;
  reopened: number;
  backlog: number;
}

export interface OverviewData {
  chart: OverviewPoint[];
  totals: { created: number; closed: number; open: number; reopened: number; backlog: number };
  tickets: Ticket[];
  total: number;
  groups: string[];
  agents: string[];
}

export interface AgentStat {
  agent: User;
  open_tickets: number;
  at_risk: number;
  breached: number;
  avg_first_reply_secs: number;
  avg_resolution_secs: number;
  sla_breach_rate: number;
  reopen_rate: number;
  closed_this_week: number;
}

export interface GroupStat {
  group: Group;
  open_tickets: number;
  new_today: number;
  closed_today: number;
  sla_breach_rate: number;
  avg_first_reply_secs: number;
  avg_resolution_secs: number;
  trend: TrendPoint[];
}

export type AlertCondition =
  | "sla_breach"
  | "sla_approaching"
  | "ticket_open_too_long"
  | "high_agent_workload"
  | "ticket_reopened"
  | "no_activity";

export type AlertChannel =
  | "in_app"
  | "email"
  | "slack"
  | "teams"
  | "telegram"
  | "whatsapp";

export type AlertScope = "global" | "group" | "agent";

export interface AlertRule {
  id: string;
  name: string;
  scope_type: AlertScope;
  scope_id: string | null;
  scope_label: string;
  condition_type: AlertCondition;
  condition_params: Record<string, unknown>;
  channels: AlertChannel[];
  is_active: boolean;
  cooldown_mins: number;
  created_at: string;
}

export interface NotificationEvent {
  id: string;
  rule_name: string;
  ticket_id: string | null;
  ticket_number: string | null;
  channel: AlertChannel;
  status: "pending" | "sent" | "failed" | "read";
  message: string;
  created_at: string;
  read_at: string | null;
}

export interface ChannelConfig {
  id: string;
  channel_type: AlertChannel;
  label: string;
  config: Record<string, string>;
  is_active: boolean;
  verified_at: string | null;
}

export type ExportType =
  | "agent_performance"
  | "sla_summary"
  | "ticket_volume"
  | "group_stats";
export type ExportFormat = "pdf" | "xlsx";
export type ExportStatus = "queued" | "generating" | "ready" | "failed";

export interface ReportExport {
  id: string;
  report_type: ExportType;
  format: ExportFormat;
  parameters: Record<string, unknown>;
  status: ExportStatus;
  file_size_bytes: number | null;
  created_at: string;
  completed_at: string | null;
  expires_at: string | null;
}

export interface SyncSchedules {
  incremental_seconds: number;
  full_reconcile_seconds: number;
}

export interface SyncLastRun {
  kind: "incremental" | "full";
  triggered_by: string;
  tickets: number;
  users: number;
  groups: number;
  duration_secs: number;
  started_at: string;
  finished_at: string;
  status: "ok" | "error";
}

export interface WorkerStatus {
  reachable: boolean;
  workers: Record<string, string>[];
  error?: string;
}

export interface SettingsBundle {
  schedules: SyncSchedules;
  last_run: SyncLastRun | null;
  worker: WorkerStatus;
  health: { redis: string; database: string; zammad: string };
  zammad_base_url: string;
  data_retention_days: number;
}

export interface SettingsStatus {
  worker: WorkerStatus;
  health: { redis: string; database: string; zammad: string };
  last_run: SyncLastRun | null;
  now: string;
}

export interface SystemSettings {
  zammad_base_url: string;
  zammad_api_token_preview: string;
  webhook_secret_preview: string;
  smtp_host: string;
  smtp_port: number;
  smtp_from: string;
  data_retention_days: number;
  last_sync_at: string;
  last_full_sync_at: string;
  zammad_online: boolean;
}
