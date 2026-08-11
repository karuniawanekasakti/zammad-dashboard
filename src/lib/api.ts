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
  mockSettings,
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
  OverviewData,
  OverviewPeriod,
  ReportExport,
  Role,
  SettingsBundle,
  SettingsStatus,
  SyncSchedules,
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
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  filters?: string;
  sorts?: string;
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

const EMPTY_FILTER_VALUE = "__empty__";
const TICKET_FILTER_FIELDS = new Set<keyof Ticket>([
  "number",
  "title",
  "state",
  "priority",
  "group_id",
  "owner_id",
  "customer_name",
  "sla_status",
  "zammad_updated_at",
]);

function parseJsonList(value?: string): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function ticketValue(ticket: Ticket, field: string): string {
  if (!TICKET_FILTER_FIELDS.has(field as keyof Ticket)) return "";
  const value = ticket[field as keyof Ticket];
  return value == null ? "" : String(value);
}

function applyAdvancedTicketFilters(rows: Ticket[], value?: string): Ticket[] {
  return parseJsonList(value).reduce<Ticket[]>((current, item) => {
    if (!item || typeof item !== "object") return current;
    const filter = item as { field?: string; operator?: string; value?: string };
    if (!filter.field || !filter.operator) return current;
    const expected = filter.value === EMPTY_FILTER_VALUE ? "" : String(filter.value ?? "").toLowerCase();
    return current.filter((ticket) => {
      const actual = ticketValue(ticket, filter.field!).toLowerCase();
      return filter.operator === "equals" ? actual === expected : actual.includes(expected);
    });
  }, rows);
}

function applyTicketSorts(rows: Ticket[], sorts?: string, sortBy?: string, sortDir?: "asc" | "desc"): Ticket[] {
  const parsedSorts = parseJsonList(sorts)
    .map((item) => item as { field?: string; desc?: boolean })
    .filter((item) => item.field && TICKET_FILTER_FIELDS.has(item.field as keyof Ticket));
  const defaultField = sortBy === "updated" ? "zammad_updated_at" : sortBy ?? "zammad_updated_at";
  const activeSorts = parsedSorts.length > 0 ? parsedSorts : [{ field: defaultField, desc: sortDir !== "asc" }];

  return [...rows].sort((a, b) => {
    for (const sort of activeSorts) {
      const av = ticketValue(a, sort.field!);
      const bv = ticketValue(b, sort.field!);
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
      if (cmp !== 0) return sort.desc ? -cmp : cmp;
    }
    return 0;
  });
}

function overviewBuckets(period: OverviewPeriod, year: number, month?: number, week?: string, day?: string) {
  const now = new Date();
  if (period === "year") {
    return Array.from({ length: 12 }, (_, i) => ({ label: new Date(year, i, 1).toLocaleString("en", { month: "short" }), start: new Date(year, i, 1), end: new Date(year, i + 1, 1), created: 0, closed: 0, reopened: 0, backlog: 0 }));
  }
  const selectedMonth = month ? month - 1 : year === now.getFullYear() ? now.getMonth() : 0;
  if (period === "month") {
    const days = new Date(year, selectedMonth + 1, 0).getDate();
    return Array.from({ length: days }, (_, i) => ({ label: String(i + 1), start: new Date(year, selectedMonth, i + 1), end: new Date(year, selectedMonth, i + 2), created: 0, closed: 0, reopened: 0, backlog: 0 }));
  }
  if (period === "week") {
    const base = week ? dateFromWeekInput(week) : year === now.getFullYear() ? now : new Date(year, 0, 1);
    const start = new Date(base);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      const end = new Date(day);
      end.setDate(day.getDate() + 1);
      return { label: day.toLocaleString("en", { weekday: "short" }), start: day, end, created: 0, closed: 0, reopened: 0, backlog: 0 };
    });
  }
  const selectedDay = day ? new Date(`${day}T00:00:00`) : year === now.getFullYear() ? now : new Date(year, 0, 1);
  selectedDay.setHours(0, 0, 0, 0);
  return Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour).padStart(2, "0")}:00`, start: new Date(selectedDay.getTime() + hour * 3600000), end: new Date(selectedDay.getTime() + (hour + 1) * 3600000), created: 0, closed: 0, reopened: 0, backlog: 0 }));
}

function dateFromWeekInput(value: string) {
  if (!value) return new Date();
  const [year, week] = value.split("-W").map(Number);
  const firstThursday = new Date(year, 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 4 - (firstThursday.getDay() || 7));
  const monday = new Date(firstThursday);
  monday.setDate(firstThursday.getDate() + (week - 1) * 7 - 3);
  return monday;
}

function bucketIndex(buckets: ReturnType<typeof overviewBuckets>, value: string | null): number {
  if (!value) return -1;
  const time = new Date(value).getTime();
  return buckets.findIndex((b) => b.start.getTime() <= time && time < b.end.getTime());
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
    rows = applyAdvancedTicketFilters(rows, filters.filters);
    rows = applyTicketSorts(rows, filters.sorts, filters.sort_by, filters.sort_dir);
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

  async getOverview(
    scope: Scope,
    params: { period: OverviewPeriod; year: number; month?: number; week?: string; day?: string; group_id?: string | "all"; owner_id?: string | "all"; page?: number; page_size?: number }
  ): Promise<OverviewData> {
    const buckets = overviewBuckets(params.period, params.year, params.month, params.week, params.day);
    const start = buckets[0].start.getTime();
    const end = buckets[buckets.length - 1].end.getTime();
    const rows: Ticket[] = [];
    let scopedTickets = applyScope(tickets, scope);
    if (params.group_id && params.group_id !== "all") scopedTickets = scopedTickets.filter((t) => t.group_id === params.group_id);
    if (params.owner_id && params.owner_id !== "all") scopedTickets = scopedTickets.filter((t) => t.owner_id === params.owner_id);

    for (const ticket of scopedTickets) {
      const created = bucketIndex(buckets, ticket.zammad_created_at);
      const closed = bucketIndex(buckets, ticket.closed_at);
      const reopened = ticket.reopen_count > 0 ? bucketIndex(buckets, ticket.zammad_updated_at) : -1;
      if (created >= 0) buckets[created].created += 1;
      if (closed >= 0) buckets[closed].closed += 1;
      if (reopened >= 0) buckets[reopened].reopened += 1;

      const times = [ticket.zammad_created_at, ticket.closed_at, ticket.reopen_count > 0 ? ticket.zammad_updated_at : null]
        .filter(Boolean)
        .map((v) => new Date(v!).getTime());
      if (times.some((t) => start <= t && t < end)) rows.push(ticket);
    }

    let backlog = 0;
    const chart = buckets.map((bucket) => {
      backlog += bucket.created - bucket.closed;
      return { label: bucket.label, created: bucket.created, closed: bucket.closed, reopened: bucket.reopened, backlog };
    });
    rows.sort((a, b) => new Date(b.zammad_updated_at).getTime() - new Date(a.zammad_updated_at).getTime());
    const page = params.page ?? 1;
    const pageSize = params.page_size ?? 20;
    return delay({
      chart,
      totals: {
        created: chart.reduce((n, p) => n + p.created, 0),
        closed: chart.reduce((n, p) => n + p.closed, 0),
        reopened: chart.reduce((n, p) => n + p.reopened, 0),
        backlog,
      },
      tickets: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      groups: [...new Set(rows.map((t) => t.group_name).filter(Boolean))].sort(),
      agents: [...new Set(rows.map((t) => t.owner_name).filter(Boolean) as string[])].sort(),
    });
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

  // Settings / admin -----------------------------------------------------------
  async getSettings(): Promise<SettingsBundle> {
    return delay({
      schedules: { ...mockSettings.schedules },
      last_run: mockSettings.last_run,
      worker: { reachable: true, workers: [] },
      health: { redis: "ok", database: "ok", zammad: systemSettings.zammad_online ? "ok" : "down" },
      zammad_base_url: systemSettings.zammad_base_url,
      data_retention_days: systemSettings.data_retention_days,
    });
  },

  async updateSchedules(patch: Partial<SyncSchedules>): Promise<{ schedules: SyncSchedules; applied_on_next_beat: boolean }> {
    mockSettings.schedules = { ...mockSettings.schedules, ...patch };
    return delay({ schedules: mockSettings.schedules, applied_on_next_beat: true }, 200);
  },

  async triggerSyncByKind(kind: "incremental" | "full"): Promise<{ triggered: boolean; kind: string }> {
    mockSettings.last_run = {
      kind,
      triggered_by: "manual",
      tickets: kind === "full" ? 496 : 12,
      users: kind === "full" ? 85 : 0,
      groups: kind === "full" ? 20 : 0,
      duration_secs: kind === "full" ? 142.3 : 4.1,
      started_at: new Date(Date.now() - 150000).toISOString(),
      finished_at: new Date().toISOString(),
      status: "ok",
    };
    systemSettings.last_sync_at = new Date().toISOString();
    return delay({ triggered: true, kind }, 400);
  },

  async purgeCache(): Promise<{ purged: number }> {
    return delay({ purged: 4 }, 300);
  },

  async getSettingsStatus(): Promise<SettingsStatus> {
    return delay({
      worker: { reachable: true, workers: [] },
      health: { redis: "ok", database: "ok", zammad: systemSettings.zammad_online ? "ok" : "down" },
      last_run: mockSettings.last_run,
      now: new Date().toISOString(),
    });
  },
};

export { fullName };

// --- Backend integration switch ---
// Set VITE_USE_MOCK=true only for offline/demo mode.
import { apiClient } from "@/lib/api-client";

const useMock = import.meta.env.VITE_USE_MOCK === "true";

export const api = useMock ? mockApi : (apiClient as unknown as typeof mockApi);
