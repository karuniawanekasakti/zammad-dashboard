import type {
  AgentStat,
  AlertRule,
  ChannelConfig,
  Group,
  GroupStat,
  KpiSummary,
  NotificationEvent,
  ReportExport,
  SystemSettings,
  Ticket,
  TicketArticle,
  TicketPriority,
  TicketState,
  TrendPoint,
  User,
} from "@/types";

// -- Deterministic PRNG for stable mock data across reloads ------------------
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
const between = (lo: number, hi: number) => Math.floor(lo + rand() * (hi - lo));
const uuid = (prefix: string, n: number) => `${prefix}-${n.toString(16).padStart(6, "0")}`;

// -- Groups ------------------------------------------------------------------
const GROUP_NAMES = [
  "IT Support",
  "Billing",
  "Customer Success",
  "DevOps",
  "Onboarding",
  "Tier 2 Escalations",
];
export const groups: Group[] = GROUP_NAMES.map((name, i) => ({
  id: uuid("grp", i + 1),
  name,
  note: `${name} team handles ${name.toLowerCase()} related tickets.`,
  active: true,
  agent_count: between(4, 14),
}));

// -- Users -------------------------------------------------------------------
const FIRST_NAMES = [
  "Alice",
  "Bob",
  "Carol",
  "David",
  "Eva",
  "Frank",
  "Grace",
  "Henry",
  "Iris",
  "Jack",
  "Karen",
  "Liam",
  "Mia",
  "Noah",
  "Olivia",
  "Peter",
  "Quinn",
  "Rachel",
  "Sam",
  "Tina",
  "Uma",
  "Victor",
  "Wendy",
  "Xander",
];
const LAST_NAMES = [
  "Smith",
  "Jones",
  "Brown",
  "Taylor",
  "Wilson",
  "Davies",
  "Evans",
  "Roberts",
  "Walker",
  "White",
  "Thompson",
  "Clark",
  "Hall",
  "Young",
  "Allen",
];
const AVATAR_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-cyan-500",
  "bg-fuchsia-500",
];

export const users: User[] = [];

// Admin
users.push({
  id: uuid("usr", 1),
  zammad_id: 1,
  email: "admin@acme.com",
  firstname: "System",
  lastname: "Administrator",
  login: "admin",
  role: "admin",
  group_ids: groups.map((g) => g.id),
  is_active: true,
  avatar_color: "bg-indigo-600",
});

// Team Leads (one per group)
groups.forEach((g, i) => {
  const firstname = FIRST_NAMES[i];
  const lastname = LAST_NAMES[i];
  users.push({
    id: uuid("usr", users.length + 1),
    zammad_id: users.length + 1,
    email: `${firstname.toLowerCase()}.${lastname.toLowerCase()}@acme.com`,
    firstname,
    lastname,
    login: `${firstname.toLowerCase()}.${lastname.toLowerCase()}`,
    role: "team_lead",
    group_ids: [g.id],
    is_active: true,
    avatar_color: pick(AVATAR_COLORS),
  });
});

// Project Managers (2)
for (let i = 0; i < 2; i++) {
  const firstname = FIRST_NAMES[6 + i];
  const lastname = LAST_NAMES[6 + i];
  users.push({
    id: uuid("usr", users.length + 1),
    zammad_id: users.length + 1,
    email: `${firstname.toLowerCase()}.${lastname.toLowerCase()}@acme.com`,
    firstname,
    lastname,
    login: `${firstname.toLowerCase()}.${lastname.toLowerCase()}`,
    role: "project_manager",
    group_ids: [groups[i].id, groups[i + 1].id],
    is_active: true,
    avatar_color: pick(AVATAR_COLORS),
  });
}

// Agents (approx 30)
for (let i = 0; i < 30; i++) {
  const firstname = FIRST_NAMES[(i + 8) % FIRST_NAMES.length];
  const lastname = LAST_NAMES[(i + 3) % LAST_NAMES.length];
  users.push({
    id: uuid("usr", users.length + 1),
    zammad_id: users.length + 1,
    email: `${firstname.toLowerCase()}.${lastname.toLowerCase()}${i}@acme.com`,
    firstname,
    lastname,
    login: `${firstname.toLowerCase()}.${lastname.toLowerCase()}${i}`,
    role: "agent",
    group_ids: [pick(groups).id],
    is_active: rand() > 0.1,
    avatar_color: pick(AVATAR_COLORS),
  });
}

export function fullName(u: User): string {
  return `${u.firstname} ${u.lastname}`;
}

// -- Tickets -----------------------------------------------------------------
const STATES: TicketState[] = ["new", "open", "pending", "closed"];
const PRIORITIES: TicketPriority[] = ["low", "normal", "high", "very high"];
const TAG_POOL = [
  "bug",
  "feature-request",
  "billing",
  "integration",
  "api",
  "mobile",
  "onboarding",
  "migration",
  "urgent",
  "contract-a",
  "contract-b",
];
const TITLE_TEMPLATES = [
  "Cannot login to account",
  "Billing discrepancy on invoice",
  "API rate limit issues",
  "Mobile app crashing on launch",
  "Feature request: dark mode export",
  "Integration webhook not firing",
  "Account upgrade request",
  "Performance degraded on dashboard",
  "Password reset email not received",
  "Data export failed with timeout",
  "Need help with SSO configuration",
  "Report generation stuck",
  "Notification channel verification failing",
  "SLA policy not applying correctly",
  "User permissions need adjustment",
];
const CUSTOMERS = [
  "Sarah Miller",
  "John Davis",
  "Acme Corp",
  "BetaTech Ltd",
  "Gamma Industries",
  "Delta Systems",
  "Epsilon Group",
  "Zenith Holdings",
];

const agents = users.filter((u) => u.role === "agent");

function pickSla(state: TicketState, createdHoursAgo: number) {
  if (state === "closed") {
    return {
      sla_status: "safe" as const,
      first_response_remaining_secs: null,
      first_response_breached: rand() > 0.85,
      close_breached: rand() > 0.88,
    };
  }
  const r = rand();
  if (r < 0.55) {
    return {
      sla_status: "safe" as const,
      first_response_remaining_secs: between(2 * 3600, 24 * 3600),
      first_response_breached: false,
      close_breached: false,
    };
  } else if (r < 0.78) {
    return {
      sla_status: "warning" as const,
      first_response_remaining_secs: between(30 * 60, 2 * 3600),
      first_response_breached: false,
      close_breached: false,
    };
  } else if (r < 0.9) {
    return {
      sla_status: "critical" as const,
      first_response_remaining_secs: between(60, 30 * 60),
      first_response_breached: false,
      close_breached: false,
    };
  } else {
    return {
      sla_status: "breached" as const,
      first_response_remaining_secs: -between(300, 3 * 3600),
      first_response_breached: true,
      close_breached: createdHoursAgo > 48,
    };
  }
}

export const tickets: Ticket[] = [];
const TICKET_COUNT = 240;
for (let i = 0; i < TICKET_COUNT; i++) {
  const state = rand() < 0.35 ? "closed" : pick(STATES.filter((s) => s !== "closed"));
  const group = pick(groups);
  const owner = rand() > 0.08 ? pick(agents.filter((a) => a.group_ids.includes(group.id)) ?? agents) : null;
  const createdHoursAgo = between(1, 30 * 24);
  const zammad_created_at = new Date(Date.now() - createdHoursAgo * 3600 * 1000).toISOString();
  const closedHoursAgo = state === "closed" ? Math.max(1, createdHoursAgo - between(0, createdHoursAgo - 1)) : null;
  const sla = pickSla(state, createdHoursAgo);
  const resolution_time_secs =
    state === "closed" ? (createdHoursAgo - (closedHoursAgo ?? 0)) * 3600 : null;
  const first_reply_time_secs = rand() > 0.1 ? between(120, 4 * 3600) : null;

  tickets.push({
    id: uuid("tkt", i + 1),
    zammad_id: 10000 + i,
    number: (10000 + i).toString(),
    title: pick(TITLE_TEMPLATES),
    state,
    priority: pick(PRIORITIES),
    group_id: group.id,
    group_name: group.name,
    owner_id: owner?.id ?? null,
    owner_name: owner ? fullName(owner) : null,
    customer_name: pick(CUSTOMERS),
    tags: Array.from(new Set([pick(TAG_POOL), pick(TAG_POOL)])).filter(Boolean),
    sla_status: sla.sla_status,
    first_response_remaining_secs: sla.first_response_remaining_secs,
    first_response_breached: sla.first_response_breached,
    close_breached: sla.close_breached,
    reopen_count: rand() < 0.08 ? between(1, 3) : 0,
    first_reply_time_secs,
    resolution_time_secs,
    zammad_created_at,
    zammad_updated_at: new Date(
      Date.now() - between(0, Math.max(1, createdHoursAgo - 1)) * 3600 * 1000
    ).toISOString(),
    closed_at: closedHoursAgo ? new Date(Date.now() - closedHoursAgo * 3600 * 1000).toISOString() : null,
  });
}

// -- Ticket articles ---------------------------------------------------------
const ARTICLE_BODIES = [
  "Hi, I'm reaching out regarding the issue we discussed.",
  "Thanks for your message. I've started investigating this on our end.",
  "Could you please provide the account ID so we can look into this?",
  "We've identified the root cause and are working on a fix.",
  "The issue has been resolved. Please confirm on your side.",
  "Escalating this to the engineering team for further review.",
  "Updated the SLA policy configuration as requested.",
];

export function articlesForTicket(ticketId: string): TicketArticle[] {
  const ticket = tickets.find((t) => t.id === ticketId);
  if (!ticket) return [];
  const count = between(3, 9);
  const arts: TicketArticle[] = [];
  const base = new Date(ticket.zammad_created_at).getTime();
  for (let i = 0; i < count; i++) {
    const isCustomer = i === 0 || rand() > 0.55;
    arts.push({
      id: `${ticket.id}-art-${i}`,
      ticket_id: ticket.id,
      author_name: isCustomer ? ticket.customer_name : ticket.owner_name ?? "Unassigned Agent",
      author_role: isCustomer ? "customer" : "agent",
      type: pick(["email", "note", "web"] as const),
      internal: !isCustomer && rand() < 0.2,
      body: pick(ARTICLE_BODIES),
      created_at: new Date(base + i * between(10, 120) * 60 * 1000).toISOString(),
    });
  }
  return arts;
}

// -- KPI summary -------------------------------------------------------------
export function kpiSummaryForScope(scope: { role: string; group_ids?: string[]; user_id?: string }): KpiSummary {
  let scoped = tickets;
  if (scope.role === "agent" && scope.user_id) {
    scoped = tickets.filter((t) => t.owner_id === scope.user_id);
  } else if ((scope.role === "team_lead" || scope.role === "project_manager") && scope.group_ids?.length) {
    scoped = tickets.filter((t) => scope.group_ids!.includes(t.group_id));
  }

  const open = scoped.filter((t) => t.state !== "closed");
  const closedToday = scoped.filter((t) => {
    if (!t.closed_at) return false;
    const d = new Date(t.closed_at);
    return Date.now() - d.getTime() < 24 * 3600 * 1000;
  });
  const breached = scoped.filter(
    (t) => t.first_response_breached || t.close_breached || t.sla_status === "breached"
  );
  const slaTotal = scoped.length || 1;
  const reopened = scoped.filter((t) => t.reopen_count > 0);
  const replyTimes = scoped.map((t) => t.first_reply_time_secs).filter((n): n is number => n != null);
  const resTimes = scoped.map((t) => t.resolution_time_secs).filter((n): n is number => n != null);
  return {
    total_open_tickets: open.length,
    total_closed_today: closedToday.length,
    agents_online: agents.filter((a) => a.is_active).length,
    total_agents: agents.length,
    sla_breach_rate: (breached.length / slaTotal) * 100,
    avg_resolution_secs: resTimes.length ? Math.floor(resTimes.reduce((a, b) => a + b, 0) / resTimes.length) : 0,
    avg_first_reply_secs: replyTimes.length
      ? Math.floor(replyTimes.reduce((a, b) => a + b, 0) / replyTimes.length)
      : 0,
    reopen_rate: (reopened.length / slaTotal) * 100,
    new_today: scoped.filter(
      (t) => Date.now() - new Date(t.zammad_created_at).getTime() < 24 * 3600 * 1000
    ).length,
    at_risk: scoped.filter((t) => t.sla_status === "warning" || t.sla_status === "critical").length,
  };
}

// -- Trends ------------------------------------------------------------------
export function trendFor(days: number, base: number, variance: number): TrendPoint[] {
  const out: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push({
      date: d.toISOString().slice(0, 10),
      value: Math.max(0, Math.floor(base + (rand() - 0.5) * variance)),
      secondary: Math.max(0, Math.floor(base * 0.6 + (rand() - 0.5) * variance * 0.7)),
    });
  }
  return out;
}

// -- Agent stats -------------------------------------------------------------
export function agentStats(): AgentStat[] {
  return agents.map((agent) => {
    const own = tickets.filter((t) => t.owner_id === agent.id);
    const open = own.filter((t) => t.state !== "closed");
    const atRisk = own.filter((t) => t.sla_status === "warning" || t.sla_status === "critical").length;
    const breached = own.filter((t) => t.sla_status === "breached" || t.first_response_breached).length;
    const replyTimes = own.map((t) => t.first_reply_time_secs).filter((n): n is number => n != null);
    const resTimes = own.map((t) => t.resolution_time_secs).filter((n): n is number => n != null);
    const reopen = own.filter((t) => t.reopen_count > 0).length;
    const closedWeek = own.filter(
      (t) => t.closed_at && Date.now() - new Date(t.closed_at).getTime() < 7 * 24 * 3600 * 1000
    ).length;
    return {
      agent,
      open_tickets: open.length,
      at_risk: atRisk,
      breached,
      avg_first_reply_secs: replyTimes.length
        ? Math.floor(replyTimes.reduce((a, b) => a + b, 0) / replyTimes.length)
        : 0,
      avg_resolution_secs: resTimes.length
        ? Math.floor(resTimes.reduce((a, b) => a + b, 0) / resTimes.length)
        : 0,
      sla_breach_rate: own.length ? (breached / own.length) * 100 : 0,
      reopen_rate: own.length ? (reopen / own.length) * 100 : 0,
      closed_this_week: closedWeek,
    };
  });
}

// -- Group stats -------------------------------------------------------------
export function groupStats(): GroupStat[] {
  return groups.map((group) => {
    const scoped = tickets.filter((t) => t.group_id === group.id);
    const open = scoped.filter((t) => t.state !== "closed");
    const breached = scoped.filter((t) => t.first_response_breached || t.close_breached);
    const replyTimes = scoped.map((t) => t.first_reply_time_secs).filter((n): n is number => n != null);
    const resTimes = scoped.map((t) => t.resolution_time_secs).filter((n): n is number => n != null);
    return {
      group,
      open_tickets: open.length,
      new_today: scoped.filter(
        (t) => Date.now() - new Date(t.zammad_created_at).getTime() < 24 * 3600 * 1000
      ).length,
      closed_today: scoped.filter(
        (t) => t.closed_at && Date.now() - new Date(t.closed_at).getTime() < 24 * 3600 * 1000
      ).length,
      sla_breach_rate: scoped.length ? (breached.length / scoped.length) * 100 : 0,
      avg_first_reply_secs: replyTimes.length
        ? Math.floor(replyTimes.reduce((a, b) => a + b, 0) / replyTimes.length)
        : 0,
      avg_resolution_secs: resTimes.length
        ? Math.floor(resTimes.reduce((a, b) => a + b, 0) / resTimes.length)
        : 0,
      trend: trendFor(14, between(10, 40), 20),
    };
  });
}

// -- Alert rules -------------------------------------------------------------
export let alertRules: AlertRule[] = [
  {
    id: uuid("rule", 1),
    name: "First response SLA breach",
    scope_type: "global",
    scope_id: null,
    scope_label: "All groups",
    condition_type: "sla_breach",
    condition_params: { escalation_type: "first_response" },
    channels: ["in_app", "email", "slack"],
    is_active: true,
    cooldown_mins: 15,
    created_at: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
  },
  {
    id: uuid("rule", 2),
    name: "High priority open > 24h",
    scope_type: "global",
    scope_id: null,
    scope_label: "All groups",
    condition_type: "ticket_open_too_long",
    condition_params: { threshold_hours: 24, priority: "high" },
    channels: ["in_app", "email"],
    is_active: true,
    cooldown_mins: 60,
    created_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
  },
  {
    id: uuid("rule", 3),
    name: "Agent workload overload",
    scope_type: "global",
    scope_id: null,
    scope_label: "All groups",
    condition_type: "high_agent_workload",
    condition_params: { threshold_open_tickets: 20 },
    channels: ["in_app", "slack"],
    is_active: false,
    cooldown_mins: 120,
    created_at: new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString(),
  },
  {
    id: uuid("rule", 4),
    name: "SLA approaching (15min)",
    scope_type: "group",
    scope_id: groups[0].id,
    scope_label: groups[0].name,
    condition_type: "sla_approaching",
    condition_params: { minutes_before: 15, escalation_type: "first_response" },
    channels: ["in_app", "telegram"],
    is_active: true,
    cooldown_mins: 10,
    created_at: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
  },
];

// -- Notifications -----------------------------------------------------------
export const notifications: NotificationEvent[] = Array.from({ length: 12 }, (_, i) => {
  const ticket = pick(tickets);
  return {
    id: uuid("ntf", i + 1),
    rule_name: pick(alertRules).name,
    ticket_id: ticket.id,
    ticket_number: ticket.number,
    channel: pick(["in_app", "email", "slack", "telegram"] as const),
    status: pick(["sent", "read", "sent", "sent", "failed"] as const),
    message: `Ticket #${ticket.number} — ${ticket.title}`,
    created_at: new Date(Date.now() - between(1, 48) * 60 * 60 * 1000).toISOString(),
    read_at: rand() > 0.6 ? new Date().toISOString() : null,
  };
});

// -- Channels ----------------------------------------------------------------
export const channels: ChannelConfig[] = [
  {
    id: uuid("chn", 1),
    channel_type: "email",
    label: "Primary email",
    config: { address: "admin@acme.com" },
    is_active: true,
    verified_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
  },
  {
    id: uuid("chn", 2),
    channel_type: "slack",
    label: "#ops-alerts",
    config: { webhook_url: "https://hooks.slack.com/services/***" },
    is_active: true,
    verified_at: new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(),
  },
  {
    id: uuid("chn", 3),
    channel_type: "telegram",
    label: "Bot → @oncall",
    config: { chat_id: "-1001234567890" },
    is_active: false,
    verified_at: null,
  },
];

// -- Report exports ----------------------------------------------------------
export let reportExports: ReportExport[] = [
  {
    id: uuid("exp", 1),
    report_type: "agent_performance",
    format: "pdf",
    parameters: { date_from: "2026-04-01", date_to: "2026-05-01" },
    status: "ready",
    file_size_bytes: 842_133,
    created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    completed_at: new Date(Date.now() - 2 * 3600 * 1000 + 12_000).toISOString(),
    expires_at: new Date(Date.now() + 22 * 3600 * 1000).toISOString(),
  },
  {
    id: uuid("exp", 2),
    report_type: "sla_summary",
    format: "xlsx",
    parameters: { date_from: "2026-04-15", date_to: "2026-05-08" },
    status: "ready",
    file_size_bytes: 231_884,
    created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    completed_at: new Date(Date.now() - 30 * 60 * 1000 + 4_000).toISOString(),
    expires_at: new Date(Date.now() + 23.5 * 3600 * 1000).toISOString(),
  },
];

// -- System settings ---------------------------------------------------------
export const systemSettings: SystemSettings = {
  zammad_base_url: "https://support.acme.com",
  zammad_api_token_preview: "zma_••••••••••••4f7a",
  webhook_secret_preview: "whs_••••••••••••c31d",
  smtp_host: "smtp.acme.com",
  smtp_port: 587,
  smtp_from: "alerts@acme.com",
  data_retention_days: 30,
  last_sync_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  last_full_sync_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
  zammad_online: true,
};

// -- Exposed mutation helpers (for mock write ops) ---------------------------
export function upsertAlertRule(rule: AlertRule) {
  const idx = alertRules.findIndex((r) => r.id === rule.id);
  if (idx >= 0) alertRules[idx] = rule;
  else alertRules = [rule, ...alertRules];
}

export function deleteAlertRule(id: string) {
  alertRules = alertRules.filter((r) => r.id !== id);
}

export function addReportExport(entry: ReportExport) {
  reportExports = [entry, ...reportExports];
}

export { uuid };
