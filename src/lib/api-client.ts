/**
 * HTTP client for the FastAPI backend.
 * All methods match the same signatures as the mock api object.
 */
import type {
  AgentStat,
  AlertRule,
  ChannelConfig,
  Group,
  GroupStat,
  KpiSummary,
  NotificationEvent,
  OverviewData,
  OverviewPeriod,
  OverviewTab,
  ReportExport,
  SettingsBundle,
  SettingsStatus,
  SlaMonitorData,
  SlaPolicy,
  SyncSchedules,
  SystemSettings,
  Ticket,
  TicketArticle,
  TicketHistory,
  TrendPoint,
  User,
} from "@/types";
import type { Scope, TicketFilters } from "@/lib/api";
import { useAuth } from "@/stores/auth";

const BASE = import.meta.env.VITE_API_BASE ?? "/api/v1";

function getToken(): string | null {
  try {
    const raw = localStorage.getItem("zm-auth");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.state?.token ?? null;
  } catch {
    return null;
  }
}

async function requestRaw<T>(path: string, opts: RequestInit = {}): Promise<{ data: T; meta?: { total?: number } }> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers as Record<string, string> ?? {}),
  };
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (res.status === 401) {
    useAuth.getState().logout();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = await res.json();
  return json.data !== undefined ? json : { data: json };
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  return (await requestRaw<T>(path, opts)).data;
}

function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "" && v !== "all") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const apiClient = {
  // Auth
  async login(login: string, password: string): Promise<User> {
    const res = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login, password }),
    });
    if (!res.ok) throw new Error("Invalid credentials");
    const json = await res.json();
    useAuth.getState().setToken(json.token);
    useAuth.getState().setUser(json.user);
    return json.user;
  },

  async me(_userId: string): Promise<User | null> {
    return request<User | null>("/auth/me");
  },

  // Tickets
  async listTickets(
    _scope: Scope,
    filters: TicketFilters = {}
  ): Promise<{ rows: Ticket[]; total: number }> {
    const params = qs({
      page: filters.page,
      per_page: filters.page_size,
      state: filters.state,
      priority: filters.priority,
      group_id: filters.group_id,
      owner_id: filters.owner_id,
      search: filters.search,
      sort_by: filters.sort_by,
      sort_dir: filters.sort_dir,
      filters: filters.filters,
      sorts: filters.sorts,
    });
    const res = await requestRaw<Ticket[]>(`/tickets${params}`);
    return { rows: res.data, total: res.meta?.total ?? res.data.length };
  },

  async getTicket(id: string): Promise<{ ticket: Ticket; articles: TicketArticle[] } | null> {
    return request(`/tickets/${id}`);
  },

  async getTicketHistory(id: string): Promise<TicketHistory[]> {
    const data = await request<TicketHistory[] | { history?: TicketHistory[] }>(`/ticket_history/${id}`);
    return Array.isArray(data) ? data : data.history ?? [];
  },

  async listAtRisk(_scope: Scope): Promise<Ticket[]> {
    return request<Ticket[]>("/tickets/sla-at-risk");
  },

  async listSlaMonitor(_scope: Scope, groupId?: string): Promise<SlaMonitorData> {
    return request<SlaMonitorData>(`/tickets/sla-monitor${qs({ group_id: groupId })}`);
  },

  async searchTickets(query: string, perPage = 100): Promise<Ticket[]> {
    return request<Ticket[]>(`/tickets/search${qs({ query, expand: true, per_page: perPage })}`);
  },

  async listSlaPolicies(): Promise<SlaPolicy[]> {
    return request<SlaPolicy[]>("/slas");
  },

  // KPI
  async kpiSummary(_scope: Scope): Promise<KpiSummary> {
    return request<KpiSummary>("/kpi/summary");
  },

  async ticketVolumeTrend(days = 30): Promise<TrendPoint[]> {
    return request<TrendPoint[]>(`/kpi/volume?days=${days}`);
  },

  async slaBreachTrend(days = 30): Promise<TrendPoint[]> {
    return request<TrendPoint[]>(`/kpi/sla-breach-rate?days=${days}`);
  },

  async resolutionTimeTrend(days = 14): Promise<TrendPoint[]> {
    return request<TrendPoint[]>(`/kpi/resolution-time?days=${days}`);
  },

  async firstReplyTrend(days = 14): Promise<TrendPoint[]> {
    return request<TrendPoint[]>(`/kpi/first-reply?days=${days}`);
  },

  async getOverview(
    _scope: Scope,
    params: { period: OverviewPeriod; year: number; month?: number; week?: string; day?: string; group_id?: string | "all"; owner_id?: string | "all"; tab?: OverviewTab; page?: number; page_size?: number }
  ): Promise<OverviewData> {
    return request<OverviewData>(`/tickets/overview${qs({
      period: params.period,
      year: params.year,
      month: params.month,
      week: params.week,
      day: params.day,
      group_id: params.group_id,
      owner_id: params.owner_id,
      tab: params.tab,
      page: params.page,
      per_page: params.page_size,
    })}`);
  },

  // Agents
  async listAgents(_scope: Scope): Promise<AgentStat[]> {
    return request<AgentStat[]>("/agents");
  },

  async getAgent(id: string): Promise<AgentStat | null> {
    return request<AgentStat | null>(`/agents/${id}`);
  },

  // Groups
  async listGroups(_scope: Scope): Promise<GroupStat[]> {
    return request<GroupStat[]>("/groups");
  },

  async getGroup(id: string): Promise<GroupStat | null> {
    return request<GroupStat | null>(`/groups/${id}/stats`);
  },

  async listAllGroupsForFilter(): Promise<Group[]> {
    return request<Group[]>("/groups?summary=true");
  },

  async listAllAgentsForFilter(): Promise<User[]> {
    return request<User[]>("/agents?summary=true");
  },

  // Alerts
  async listAlertRules(): Promise<AlertRule[]> {
    return request<AlertRule[]>("/alert-rules");
  },

  async upsertAlertRule(rule: Omit<AlertRule, "id" | "created_at"> & { id?: string }): Promise<AlertRule> {
    if (rule.id) {
      return request<AlertRule>(`/alert-rules/${rule.id}`, { method: "PUT", body: JSON.stringify(rule) });
    }
    return request<AlertRule>("/alert-rules", { method: "POST", body: JSON.stringify(rule) });
  },

  async deleteAlertRule(id: string): Promise<void> {
    await request(`/alert-rules/${id}`, { method: "DELETE" });
  },

  // Notifications
  async listNotifications(): Promise<NotificationEvent[]> {
    return request<NotificationEvent[]>("/notifications");
  },

  async markNotificationRead(id: string): Promise<void> {
    await request(`/notifications/${id}/read`, { method: "PATCH" });
  },

  async markAllNotificationsRead(): Promise<void> {
    await request("/notifications/read-all", { method: "PATCH" });
  },

  // Channels
  async listChannels(): Promise<ChannelConfig[]> {
    return request<ChannelConfig[]>("/channels");
  },

  async testChannel(id: string): Promise<{ ok: boolean }> {
    return request(`/channels/${id}/test`, { method: "POST" });
  },

  // Reports (placeholder — backend doesn't have full export yet)
  async listExports(): Promise<ReportExport[]> {
    return [];
  },

  async createExport(input: Omit<ReportExport, "id" | "status" | "created_at" | "completed_at" | "expires_at" | "file_size_bytes">): Promise<ReportExport> {
    return input as ReportExport;
  },

  // System
  async getPublicConfig(): Promise<{ zammad_base_url: string }> {
    return request<{ zammad_base_url: string }>("/system/config");
  },

  async getSystemSettings(): Promise<SystemSettings> {
    const health = await request<{ zammad?: string }>("/system/health");
    return {
      zammad_base_url: "",
      zammad_api_token_preview: "***",
      webhook_secret_preview: "***",
      smtp_host: "",
      smtp_port: 587,
      smtp_from: "",
      data_retention_days: 30,
      last_sync_at: "",
      last_full_sync_at: "",
      zammad_online: health?.zammad === "ok",
    };
  },

  async updateSystemSettings(_patch: Partial<SystemSettings>): Promise<SystemSettings> {
    return this.getSystemSettings();
  },

  async triggerSync(): Promise<{ ok: true }> {
    return request("/system/sync/trigger", { method: "POST" });
  },

  // Settings / admin
  async getSettings(): Promise<SettingsBundle> {
    return request<SettingsBundle>("/settings");
  },

  async updateSchedules(patch: Partial<SyncSchedules>): Promise<{ schedules: SyncSchedules; applied_on_next_beat: boolean }> {
    const current = await this.getSettings();
    const next = { ...current.schedules, ...patch };
    return request("/settings/schedules", { method: "PUT", body: JSON.stringify(next) });
  },

  async triggerSyncByKind(kind: "incremental" | "full"): Promise<{ triggered: boolean; kind: string }> {
    return request("/settings/sync", { method: "POST", body: JSON.stringify({ kind }) });
  },

  async purgeCache(): Promise<{ purged: number }> {
    return request("/settings/cache/purge", { method: "POST" });
  },

  async getSettingsStatus(): Promise<SettingsStatus> {
    return request<SettingsStatus>("/settings/status");
  },
};
