import type { ManagerMetricsPeriod, Ticket } from "@/types";

const PRIORITIES: Record<string, true> = { "very high": true, high: true, normal: true, low: true, unknown: true };
const PERIODS: Record<string, true> = { week: true, month: true, quarter: true, year: true };

export interface SlaNavigationState {
  group: string;
  priority: Ticket["priority"] | "all";
  period: ManagerMetricsPeriod;
  page: number;
  showAllBreaches: boolean;
}

export const DEFAULT_SLA_NAVIGATION: SlaNavigationState = {
  group: "all",
  priority: "all",
  period: "month",
  page: 0,
  showAllBreaches: false,
};

export function parseSlaNavigation(params: URLSearchParams): SlaNavigationState {
  const priority = params.get("priority");
  const period = params.get("period");
  const page = Number(params.get("page"));
  return {
    group: params.get("group") || DEFAULT_SLA_NAVIGATION.group,
    priority: priority && PRIORITIES[priority] ? priority as Ticket["priority"] : DEFAULT_SLA_NAVIGATION.priority,
    period: period && PERIODS[period] ? period as ManagerMetricsPeriod : DEFAULT_SLA_NAVIGATION.period,
    page: Number.isInteger(page) && page > 0 ? page : DEFAULT_SLA_NAVIGATION.page,
    showAllBreaches: params.get("breaches") === "all",
  };
}

export function serializeSlaNavigation(state: SlaNavigationState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.group !== DEFAULT_SLA_NAVIGATION.group) params.set("group", state.group);
  if (state.priority !== DEFAULT_SLA_NAVIGATION.priority) params.set("priority", state.priority);
  if (state.period !== DEFAULT_SLA_NAVIGATION.period) params.set("period", state.period);
  if (state.page !== DEFAULT_SLA_NAVIGATION.page) params.set("page", String(state.page));
  if (state.showAllBreaches) params.set("breaches", "all");
  return params;
}
