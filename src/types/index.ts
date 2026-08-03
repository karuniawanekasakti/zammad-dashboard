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
export type TicketPriority = "low" | "normal" | "high" | "very high";
export type SlaStatus = "safe" | "warning" | "critical" | "breached";

export interface Ticket {
  id: string;
  zammad_id: number;
  number: string;
  title: string;
  state: TicketState;
  priority: TicketPriority;
  group_id: string;
  group_name: string;
  owner_id: string | null;
  owner_name: string | null;
  customer_name: string;
  tags: string[];
  sla_status: SlaStatus;
  first_response_remaining_secs: number | null;
  first_response_breached: boolean;
  close_breached: boolean;
  reopen_count: number;
  first_reply_time_secs: number | null;
  resolution_time_secs: number | null;
  zammad_created_at: string;
  zammad_updated_at: string;
  closed_at: string | null;
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
