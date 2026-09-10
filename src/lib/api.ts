import { slaDeadline, slaProgress, slaRemainingMs, slaStatus } from "@/lib/sla-deadline";
import {
  agentStats,
  alertRules,
  articlesForTicket,
  channels,
  historyForTicket,
  deleteAlertRule,
  fullName,
  groupStats,
  groups,
  kpiSummaryForScope,
  mockSettings,
  notifications,
  reportExports,
  addReportExport,
  slaPolicies,
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
  OverviewTab,
  ReportExport,
  Role,
  SettingsBundle,
  SettingsStatus,
  SlaMonitorData,
  SlaPolicy,
  SyncSchedules,
  SystemSettings,
  Ticket,
  TicketArticle,
  TicketHistory,
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
  "severity",
  "severity_label",
  "ticket_category",
  "ticket_category_label",
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

type LiveSlaStatus = SlaMonitorData["tickets"][number]["live_sla_status"];

function slaCounts(rows: SlaMonitorData["tickets"]): Omit<SlaMonitorData["priority_rows"][number], "id" | "name"> {
  const withSla = rows.filter((t) => t.live_sla_status !== "no_sla");
  const breached = withSla.filter((t) => t.live_sla_status === "breached").length;
  return {
    total: rows.length,
    total_with_sla: withSla.length,
    on_track: rows.filter((t) => t.live_sla_status === "on_track").length,
    warning: rows.filter((t) => t.live_sla_status === "warning").length,
    critical: rows.filter((t) => t.live_sla_status === "critical").length,
    at_risk: rows.filter((t) => t.live_sla_status === "warning" || t.live_sla_status === "critical").length,
    breached,
    no_sla: rows.filter((t) => t.live_sla_status === "no_sla").length,
    compliance_rate: withSla.length ? ((withSla.length - breached) / withSla.length) * 100 : null,
  };
}

function slaMonitorRow(id: string, name: string, rows: SlaMonitorData["tickets"]): SlaMonitorData["priority_rows"][number] {
  return { id, name, ...slaCounts(rows) };
}

export function buildMockSlaMonitor(rows: Ticket[], now = new Date()): SlaMonitorData {
  const active = rows.filter((t) => t.state === "new" || t.state === "open" || t.state === "pending");
  const closed = rows.filter((t) => t.state === "closed" || t.state === "merged");
  const enriched = active.map((t) => ({ ...t, actionable_deadline: slaDeadline(t)?.toISOString() ?? null, live_sla_status: slaStatus(t, now), sla_remaining_ms: slaRemainingMs(t, now), sla_progress: slaProgress(t, now) }));
  const closedEnriched = closed.map((t) => ({ ...t, actionable_deadline: slaDeadline(t)?.toISOString() ?? null, live_sla_status: slaStatus(t, now), sla_remaining_ms: slaRemainingMs(t, now), sla_progress: slaProgress(t, now) }));
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  enriched.filter((t) => t.live_sla_status === "breached").forEach((t) => {
    const d = slaDeadline(t) ?? new Date(t.zammad_updated_at);
    grid[(d.getUTCDay() + 6) % 7][d.getUTCHours()] += 1;
  });
  const dayLabels = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const trend = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(today.getTime() - (6 - i) * 24 * 60 * 60 * 1000);
    const next = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    const dayRows = closed.filter((t) => {
      if (t.first_response_diff_in_min == null && t.update_diff_in_min == null && t.close_diff_in_min == null && !slaDeadline(t) && slaStatus(t, now) !== "breached") return false;
      const close = new Date(t.close_at ?? t.closed_at ?? 0).getTime();
      return day.getTime() <= close && close < next.getTime();
    });
    const breach = dayRows.filter((t) => slaStatus(t, now) === "breached").length;
    return { date: day.toISOString().slice(0, 10), day: dayLabels[day.getUTCDay()], rate: dayRows.length ? ((dayRows.length - breach) / dayRows.length) * 100 : 0, total: dayRows.length, breach };
  });
  const rank: Record<LiveSlaStatus, number> = { breached: 0, critical: 1, warning: 2, on_track: 3, safe: 3, no_sla: 4, closed_on_time: 5 };
  enriched.sort((a, b) => rank[a.live_sla_status] - rank[b.live_sla_status] || (a.sla_remaining_ms ?? Infinity) - (b.sla_remaining_ms ?? Infinity));
  const breachLog = closed.filter((t) => slaStatus(t, now) === "breached").sort((a, b) => new Date(b.close_at ?? b.closed_at ?? 0).getTime() - new Date(a.close_at ?? a.closed_at ?? 0).getTime());
  const avgCloseRows = closed.filter((t) => t.close_at || t.closed_at).map((t) => t.close_in_min).filter((n): n is number => n != null);
  const summary = {
    ...slaCounts(enriched),
    total_active: active.length,
    sla_total: slaCounts(enriched).total_with_sla,
    total_closed_on_time: closedEnriched.filter((t) => t.live_sla_status === "closed_on_time").length,
    avg_resolution_minutes: avgCloseRows.length ? Math.round(avgCloseRows.reduce((sum, n) => sum + n, 0) / avgCloseRows.length) : null,
    avg_resolution_mins: avgCloseRows.length ? Math.round(avgCloseRows.reduce((sum, n) => sum + n, 0) / avgCloseRows.length) : null,
  };
  const priorityLabels: Record<TicketPriority, string> = { "very high": "Urgent", high: "High", normal: "Medium", low: "Low", unknown: "Unknown" };
  const priority_rows = (Object.entries(priorityLabels) as [TicketPriority, string][]).map(([priority, label]) => slaMonitorRow(priority, label, enriched.filter((t) => t.priority === priority)));
  const groups = new Map(enriched.map((t) => [t.group_id || "unknown", t.group_name || "Unknown"]));
  const sla_rows = [...groups].sort((a, b) => a[0].localeCompare(b[0])).map(([id, name]) => slaMonitorRow(id, name, enriched.filter((t) => (t.group_id || "unknown") === id)));
  return {
    ...summary,
    summary,
    by_priority: Object.fromEntries(priority_rows.map((row) => [row.id, row])),
    by_group: Object.fromEntries(sla_rows.map((row) => [row.id, row])),
    priority_rows,
    sla_rows,
    trend,
    heatmap: { grid, max: Math.max(1, ...grid.flat()) },
    tickets: enriched,
    risk_rows: enriched.filter((t) => t.live_sla_status === "breached" || t.live_sla_status === "critical" || t.live_sla_status === "warning"),
    breach_log: breachLog,
  };
}

function overviewBuckets(period: OverviewPeriod, year: number, month?: number, week?: string, day?: string) {
  const now = new Date();
  if (period === "year") {
    return Array.from({ length: 12 }, (_, i) => ({ label: new Date(year, i, 1).toLocaleString("en", { month: "short" }), start: new Date(year, i, 1), end: new Date(year, i + 1, 1), created: 0, closed: 0, open: 0, reopened: 0, backlog: 0 }));
  }
  const selectedMonth = month ? month - 1 : year === now.getFullYear() ? now.getMonth() : 0;
  if (period === "month") {
    const days = new Date(year, selectedMonth + 1, 0).getDate();
    return Array.from({ length: days }, (_, i) => ({ label: String(i + 1), start: new Date(year, selectedMonth, i + 1), end: new Date(year, selectedMonth, i + 2), created: 0, closed: 0, open: 0, reopened: 0, backlog: 0 }));
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
      return { label: day.toLocaleString("en", { weekday: "short" }), start: day, end, created: 0, closed: 0, open: 0, reopened: 0, backlog: 0 };
    });
  }
  const selectedDay = day ? new Date(`${day}T00:00:00`) : year === now.getFullYear() ? now : new Date(year, 0, 1);
  selectedDay.setHours(0, 0, 0, 0);
  return Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour).padStart(2, "0")}:00`, start: new Date(selectedDay.getTime() + hour * 3600000), end: new Date(selectedDay.getTime() + (hour + 1) * 3600000), created: 0, closed: 0, open: 0, reopened: 0, backlog: 0 }));
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

function mockSearchTickets(rows: Ticket[], query: string): Ticket[] {
  const stateMatch = query.match(/state_id:\(([^)]+)\)/);
  if (stateMatch) {
    const ids = stateMatch[1].split(",").map((v) => v.trim());
    rows = rows.filter((t) => ids.includes(t.state_id));
  }
  if (query.includes("close_at:[now-7d TO now]")) {
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    rows = rows.filter((t) => t.close_at && new Date(t.close_at).getTime() >= cutoff);
  }
  return rows;
}

const mockApi = {
  // Auth --------------------------------------------------------------------
  async login(login: string, _password: string): Promise<User> {
    if (login.toLowerCase() !== "helpdeskadmin@mti-tech.co.id") throw new Error("Invalid credentials");
    const u = users.find((x) => x.email.toLowerCase() === login.toLowerCase());
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

  async getTicketHistory(id: string): Promise<TicketHistory[]> {
    return delay(historyForTicket(id));
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

  async listSlaMonitor(scope: Scope, groupId?: string, priority?: TicketPriority | "all"): Promise<SlaMonitorData> {
    let rows = applyScope(tickets, scope);
    if (groupId && groupId !== "all") rows = rows.filter((t) => t.group_id === groupId);
    if (priority && priority !== "all") rows = rows.filter((t) => t.priority === priority);
    return delay(buildMockSlaMonitor(rows));
  },

  async searchTickets(query: string, perPage = 100): Promise<Ticket[]> {
    return delay(mockSearchTickets([...tickets], query).slice(0, perPage));
  },

  async listSlaPolicies(): Promise<SlaPolicy[]> {
    return delay(slaPolicies);
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
    params: { period: OverviewPeriod; year: number; month?: number; week?: string; day?: string; group_id?: string | "all"; owner_id?: string | "all"; tab?: OverviewTab; page?: number; page_size?: number }
  ): Promise<OverviewData> {
    const buckets = overviewBuckets(params.period, params.year, params.month, params.week, params.day);
    let scopedTickets = applyScope(tickets, scope);
    if (params.group_id && params.group_id !== "all") scopedTickets = scopedTickets.filter((t) => t.group_id === params.group_id);
    if (params.owner_id && params.owner_id !== "all") scopedTickets = scopedTickets.filter((t) => t.owner_id === params.owner_id);

    let rows: Ticket[] = [];
    const openTicketIds = new Set<string>();
    for (const ticket of scopedTickets) {
      const created = bucketIndex(buckets, ticket.zammad_created_at);
      const closed = bucketIndex(buckets, ticket.closed_at);
      // Chart Open mirrors the backend: tickets *created* in the bucket (same
      // bucketing as created/closed), NOT a cumulative overlap of open intervals.
      if (created >= 0) {
        buckets[created].created += 1;
        buckets[created].open += 1;
        openTicketIds.add(ticket.id);
      }
      if (closed >= 0) buckets[closed].closed += 1;
      // Reopened approximated as reopen_count events at the ticket's last update.
      let reopenInWindow = false;
      if (ticket.reopen_count > 0) {
        const idx = bucketIndex(buckets, ticket.zammad_updated_at);
        if (idx >= 0) {
          buckets[idx].reopened += ticket.reopen_count;
          reopenInWindow = true;
        }
      }

      if (created >= 0 || closed >= 0 || reopenInWindow) rows.push(ticket);
    }

    if (params.tab === "open") rows = rows.filter((t) => t.state === "open");
    else if (params.tab === "closed") rows = rows.filter((t) => t.state === "closed" || t.state === "merged");
    else if (params.tab === "reopened") rows = rows.filter((t) => t.reopen_count > 0);

    let backlog = 0;
    const chart = buckets.map((bucket) => {
      backlog += bucket.created - bucket.closed;
      return { label: bucket.label, created: bucket.created, closed: bucket.closed, open: bucket.open, reopened: bucket.reopened, backlog };
    });
    rows.sort((a, b) => new Date(b.zammad_updated_at).getTime() - new Date(a.zammad_updated_at).getTime());
    const page = params.page ?? 1;
    const pageSize = params.page_size ?? 20;
    const pageRows = rows.slice((page - 1) * pageSize, page * pageSize).map((t) => ({
      ...t,
      ...(params.tab === "open" ? { last_open_at: t.zammad_created_at } : {}),
      ...(params.tab === "reopened" ? { last_reopen_at: t.zammad_updated_at } : {}),
    }));
    return delay({
      chart,
      totals: {
        created: chart.reduce((n, p) => n + p.created, 0),
        closed: chart.reduce((n, p) => n + p.closed, 0),
        open: openTicketIds.size,
        reopened: chart.reduce((n, p) => n + p.reopened, 0),
        backlog,
      },
      tickets: pageRows,
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

  async testChannel(_id: string): Promise<{ ok: boolean }> {
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
  async getPublicConfig(): Promise<{ zammad_base_url: string }> {
    return delay({ zammad_base_url: systemSettings.zammad_base_url });
  },

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
    const now = new Date();
    const staleAfter = new Date(new Date(mockSettings.last_success_at).getTime() + (mockSettings.schedules.incremental_seconds + 120) * 1000);
    return delay({
      schedules: { ...mockSettings.schedules },
      last_run: mockSettings.last_run,
      latest_attempt: mockSettings.last_run,
      freshness: {
        status: now <= staleAfter ? "up_to_date" as const : "out_of_date" as const,
        last_success_at: mockSettings.last_success_at,
        stale_after: staleAfter.toISOString(),
        checkpoint_source: "dedicated" as const,
      },
      worker: { reachable: true, workers: [] },
      health: { redis: "ok", database: "ok", zammad: systemSettings.zammad_online ? "ok" : "down" },
      zammad_base_url: systemSettings.zammad_base_url,
      data_retention_days: systemSettings.data_retention_days,
      now: now.toISOString(),
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
      status: "succeeded",
    };
    mockSettings.last_success_at = new Date().toISOString();
    systemSettings.last_sync_at = mockSettings.last_success_at;
    return delay({ triggered: true, kind }, 400);
  },

  async purgeCache(): Promise<{ purged: number }> {
    return delay({ purged: 4 }, 300);
  },

  async getSettingsStatus(): Promise<SettingsStatus> {
    const now = new Date();
    const staleAfter = new Date(new Date(mockSettings.last_success_at).getTime() + (mockSettings.schedules.incremental_seconds + 120) * 1000);
    return delay({
      worker: { reachable: true, workers: [] },
      health: { redis: "ok", database: "ok", zammad: systemSettings.zammad_online ? "ok" : "down" },
      last_run: mockSettings.last_run,
      latest_attempt: mockSettings.last_run,
      freshness: {
        status: now <= staleAfter ? "up_to_date" : "out_of_date",
        last_success_at: mockSettings.last_success_at,
        stale_after: staleAfter.toISOString(),
        checkpoint_source: "dedicated",
      },
      now: now.toISOString(),
    });
  },
};

export { fullName };

// --- Backend integration switch ---
// Set VITE_USE_MOCK=true only for offline/demo mode.
import { apiClient } from "@/lib/api-client";

const useMock = import.meta.env.VITE_USE_MOCK === "true";

export const api = useMock ? mockApi : (apiClient as unknown as typeof mockApi);
