import {
  agentStats,
  alertRules,
  articlesForTicket,
  channels,
  deleteAlertRule,
  fullName,
  groupStats,
  groups,
  kpiSummaryForScope,
  notifications,
  reportExports,
  addReportExport,
  systemSettings,
  tickets,
  trendFor,
  upsertAlertRule,
  users,
  uuid,
} from "@/lib/mock-data";
import type {
  AgentStat,
  AlertRule,
  ChannelConfig,
  Group,
  GroupStat,
  KpiSummary,
  NotificationEvent,
  ReportExport,
  Role,
  SystemSettings,
  Ticket,
  TicketArticle,
  TicketPriority,
  TicketState,
  TrendPoint,
  User,
} from "@/types";

// Simulate network latency
const delay = <T,>(value: T, ms = 200): Promise<T> =>
  new Promise((res) => setTimeout(() => res(value), ms));

export interface TicketFilters {
  search?: string;
  state?: TicketState | "all";
  priority?: TicketPriority | "all";
  group_id?: string | "all";
  owner_id?: string | "all";
  page?: number;
  page_size?: number;
}

export interface Scope {
  role: Role;
  group_ids: string[];
  user_id: string;
}

function applyScope<T extends { owner_id: string | null; group_id: string }>(
  rows: T[],
  scope: Scope
): T[] {
  if (scope.role === "admin") return rows;
  if (scope.role === "agent") return rows.filter((r) => r.owner_id === scope.user_id);
  // team_lead + project_manager: limited to their groups
  return rows.filter((r) => scope.group_ids.includes(r.group_id));
}

const mockApi = {
  // Auth --------------------------------------------------------------------
  async login(login: string, _password: string): Promise<User> {
    const u = users.find(
      (x) => x.login.toLowerCase() === login.toLowerCase() || x.email.toLowerCase() === login.toLowerCase()
    );
    if (!u) throw new Error("Invalid credentials");
    return delay(u, 400);
  },

  async me(userId: string): Promise<User | null> {
    return delay(users.find((u) => u.id === userId) ?? null, 80);
  },

  // Tickets -----------------------------------------------------------------
  async listTickets(
    scope: Scope,
    filters: TicketFilters = {}
  ): Promise<{ rows: Ticket[]; total: number }> {
    let rows = applyScope(tickets, scope);
    if (filters.state && filters.state !== "all") rows = rows.filter((t) => t.state === filters.state);
    if (filters.priority && filters.priority !== "all")
      rows = rows.filter((t) => t.priority === filters.priority);
    if (filters.group_id && filters.group_id !== "all")
      rows = rows.filter((t) => t.group_id === filters.group_id);
    if (filters.owner_id && filters.owner_id !== "all")
      rows = rows.filter((t) => t.owner_id === filters.owner_id);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter(
        (t) => t.title.toLowerCase().includes(q) || t.number.includes(q) || t.customer_name.toLowerCase().includes(q)
      );
    }
    // sort: newest updated first
    rows = [...rows].sort(
      (a, b) => new Date(b.zammad_updated_at).getTime() - new Date(a.zammad_updated_at).getTime()
    );
    const total = rows.length;
    const page = filters.page ?? 1;
    const pageSize = filters.page_size ?? 25;
    rows = rows.slice((page - 1) * pageSize, page * pageSize);
    return delay({ rows, total });
  },

  async getTicket(id: string): Promise<{ ticket: Ticket; articles: TicketArticle[] } | null> {
    const t = tickets.find((x) => x.id === id);
    if (!t) return delay(null);
    return delay({ ticket: t, articles: articlesForTicket(id) });
  },

  async listAtRisk(scope: Scope): Promise<Ticket[]> {
    const rows = applyScope(tickets, scope).filter(
      (t) => t.sla_status === "warning" || t.sla_status === "critical" || t.sla_status === "breached"
    );
    return delay(
      rows.sort(
        (a, b) =>
          (a.first_response_remaining_secs ?? Infinity) - (b.first_response_remaining_secs ?? Infinity)
      )
    );
  },

  // KPI / Trends ------------------------------------------------------------
  async kpiSummary(scope: Scope): Promise<KpiSummary> {
    return delay(
      kpiSummaryForScope({ role: scope.role, group_ids: scope.group_ids, user_id: scope.user_id })
    );
  },

  async ticketVolumeTrend(days = 30): Promise<TrendPoint[]> {
    return delay(trendFor(days, 80, 60));
  },

  async slaBreachTrend(days = 30): Promise<TrendPoint[]> {
    return delay(trendFor(days, 8, 10));
  },

  async resolutionTimeTrend(days = 14): Promise<TrendPoint[]> {
    return delay(trendFor(days, 18_000, 9_000));
  },

  async firstReplyTrend(days = 14): Promise<TrendPoint[]> {
    return delay(trendFor(days, 900, 600));
  },

  // Agents ------------------------------------------------------------------
  async listAgents(scope: Scope): Promise<AgentStat[]> {
    let stats = agentStats();
    if (scope.role === "team_lead" || scope.role === "project_manager") {
      stats = stats.filter((s) => s.agent.group_ids.some((g) => scope.group_ids.includes(g)));
    }
    return delay(stats.sort((a, b) => b.open_tickets - a.open_tickets));
  },

  async getAgent(id: string): Promise<AgentStat | null> {
    const stat = agentStats().find((s) => s.agent.id === id);
    return delay(stat ?? null);
  },

  // Groups ------------------------------------------------------------------
  async listGroups(scope: Scope): Promise<GroupStat[]> {
    let stats = groupStats();
    if (scope.role === "team_lead" || scope.role === "project_manager") {
      stats = stats.filter((s) => scope.group_ids.includes(s.group.id));
    }
    return delay(stats);
  },

  async getGroup(id: string): Promise<GroupStat | null> {
    const stat = groupStats().find((s) => s.group.id === id);
    return delay(stat ?? null);
  },

  async listAllGroupsForFilter(): Promise<Group[]> {
    return delay(groups);
  },

  async listAllAgentsForFilter(): Promise<User[]> {
    return delay(users.filter((u) => u.role === "agent" && u.is_active));
  },

  // Alerts ------------------------------------------------------------------
  async listAlertRules(): Promise<AlertRule[]> {
    return delay([...alertRules]);
  },

  async upsertAlertRule(rule: Omit<AlertRule, "id" | "created_at"> & { id?: string }): Promise<AlertRule> {
    const full: AlertRule = {
      ...rule,
      id: rule.id ?? uuid("rule", Math.floor(Math.random() * 100000)),
      created_at: new Date().toISOString(),
    } as AlertRule;
    upsertAlertRule(full);
    return delay(full, 120);
  },

  async deleteAlertRule(id: string): Promise<void> {
    deleteAlertRule(id);
    return delay(undefined, 100);
  },

  async listNotifications(): Promise<NotificationEvent[]> {
    return delay(
      [...notifications].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    );
  },

  async markNotificationRead(id: string): Promise<void> {
    const n = notifications.find((x) => x.id === id);
    if (n) {
      n.status = "read";
      n.read_at = new Date().toISOString();
    }
    return delay(undefined, 60);
  },

  async markAllNotificationsRead(): Promise<void> {
    notifications.forEach((n) => {
      n.status = "read";
      n.read_at = n.read_at ?? new Date().toISOString();
    });
    return delay(undefined, 80);
  },

  // Channels ----------------------------------------------------------------
  async listChannels(): Promise<ChannelConfig[]> {
    return delay([...channels]);
  },

  async testChannel(id: string): Promise<{ ok: boolean }> {
    return delay({ ok: Math.random() > 0.1 }, 500);
  },

  // Reports -----------------------------------------------------------------
  async listExports(): Promise<ReportExport[]> {
    return delay(
      [...reportExports].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    );
  },

  async createExport(input: Omit<ReportExport, "id" | "status" | "created_at" | "completed_at" | "expires_at" | "file_size_bytes">): Promise<ReportExport> {
    const entry: ReportExport = {
      ...input,
      id: uuid("exp", Math.floor(Math.random() * 100000)),
      status: "queued",
      created_at: new Date().toISOString(),
      completed_at: null,
      expires_at: null,
      file_size_bytes: null,
    };
    addReportExport(entry);
    // Simulate processing
    setTimeout(() => {
      entry.status = "generating";
    }, 800);
    setTimeout(() => {
      entry.status = "ready";
      entry.file_size_bytes = 100_000 + Math.floor(Math.random() * 900_000);
      entry.completed_at = new Date().toISOString();
      entry.expires_at = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    }, 2500);
    return delay(entry, 150);
  },

  // System ------------------------------------------------------------------
  async getSystemSettings(): Promise<SystemSettings> {
    return delay({ ...systemSettings });
  },

  async updateSystemSettings(patch: Partial<SystemSettings>): Promise<SystemSettings> {
    Object.assign(systemSettings, patch);
    return delay({ ...systemSettings }, 120);
  },

  async triggerSync(): Promise<{ ok: true }> {
    systemSettings.last_sync_at = new Date().toISOString();
    return delay({ ok: true as const }, 600);
  },
};

export { fullName };

// --- Backend integration switch ---
// Set VITE_USE_BACKEND=true in .env to use real backend
import { apiClient } from "@/lib/api-client";

const useMock = import.meta.env.VITE_USE_BACKEND !== "true";

export const api = useMock ? mockApi : (apiClient as unknown as typeof mockApi);
