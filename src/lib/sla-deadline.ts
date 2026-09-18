import type { SlaStatus, SyncFreshness, Ticket } from "../types/index.ts";

/**
 * Whether SLA verdicts may be presented as current.
 *
 * A live verdict is only as trustworthy as the row it describes. When the
 * dataset is not Up to Date — Never Synced, Out of Date, or unavailable — the
 * honest answer is that the verdict is unknown, not that there were no
 * breaches. Surfaces degrade to "Unavailable" instead of showing a stale
 * figure as current.
 */
export function slaVerdictsAvailable(freshness: Pick<SyncFreshness, "status"> | null | undefined): boolean {
  return freshness?.status === "up_to_date";
}

type SlaDeadlineFields = Pick<Ticket,
  | "escalation_at"
  | "first_response_at"
  | "first_response_escalation_at"
  | "first_response_diff_in_min"
  | "update_escalation_at"
  | "close_escalation_at"
>;

type SlaStatusFields = SlaDeadlineFields & Pick<Ticket,
  | "state"
  | "close_at"
  | "closed_at"
  | "first_response_breached"
  | "update_diff_in_min"
  | "close_diff_in_min"
  | "close_breached"
>;

export function slaDeadline(ticket: SlaDeadlineFields): Date | null {
  const firstResponseSatisfied = ticket.first_response_at != null || (ticket.first_response_diff_in_min != null && ticket.first_response_diff_in_min >= 0);
  const value = ticket.escalation_at ?? (!firstResponseSatisfied ? ticket.first_response_escalation_at : null);
  if (value) return new Date(value);
  const fallbacks = [ticket.update_escalation_at, ticket.close_escalation_at].filter((deadline): deadline is string => deadline != null);
  return fallbacks.length ? new Date(Math.min(...fallbacks.map((deadline) => new Date(deadline).getTime()))) : null;
}

export function slaStatus(ticket: SlaStatusFields, now: Date): SlaStatus {
  const deadline = slaDeadline(ticket);
  const outcomeDiffs = [ticket.first_response_diff_in_min, ticket.update_diff_in_min, ticket.close_diff_in_min].filter((value): value is number => value != null);
  if (ticket.first_response_breached || ticket.close_breached || outcomeDiffs.some((value) => value < 0)) return "breached";
  if ((ticket.state === "closed" || ticket.state === "merged") && outcomeDiffs.length) return "closed_on_time";
  if (!deadline) return "no_sla";
  if (ticket.state === "closed" || ticket.state === "merged") {
    const closedAt = ticket.close_at ?? ticket.closed_at;
    return closedAt && new Date(closedAt) <= deadline ? "closed_on_time" : "breached";
  }
  if (now > deadline) return "breached";
  const remaining = (deadline.getTime() - now.getTime()) / 1000;
  if (remaining <= 30 * 60) return "critical";
  if (remaining <= 2 * 60 * 60) return "warning";
  return "on_track";
}

export function slaRemainingMs(ticket: SlaStatusFields, now: Date): number | null {
  if (ticket.state === "closed" || ticket.state === "merged") {
    // A resolved ticket has no countdown; the meaningful figure is how far it
    // missed, mirroring the backend's `_sla_remaining_ms`. deadline-minus-now
    // would inflate a 6-minute miss into however long ago the deadline passed.
    const missed = [ticket.first_response_diff_in_min, ticket.update_diff_in_min, ticket.close_diff_in_min].filter(
      (value): value is number => value != null && value < 0
    );
    if (missed.length) return Math.min(...missed) * 60 * 1000;
    const deadline = slaDeadline(ticket);
    const closedAt = ticket.close_at ?? ticket.closed_at;
    if (deadline && closedAt && new Date(closedAt).getTime() > deadline.getTime()) {
      return -(new Date(closedAt).getTime() - deadline.getTime());
    }
    return null;
  }
  const deadline = slaDeadline(ticket);
  return deadline ? deadline.getTime() - now.getTime() : null;
}

export function slaProgress(ticket: SlaDeadlineFields & Pick<Ticket, "zammad_created_at">, now: Date): number {
  const deadline = slaDeadline(ticket);
  if (!deadline) return 0;
  const start = new Date(ticket.zammad_created_at).getTime();
  const end = deadline.getTime();
  return end <= start ? 0 : Math.max(0, Math.min(100, Math.round(((now.getTime() - start) / (end - start)) * 100)));
}
