import type { SlaStatus, Ticket } from "../types/index.ts";

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
  | "close_breached"
  | "sla_status"
>;

export function slaDeadline(ticket: SlaDeadlineFields): Date | null {
  const firstResponseSatisfied = ticket.first_response_at != null || (ticket.first_response_diff_in_min != null && ticket.first_response_diff_in_min >= 0);
  const value = ticket.escalation_at
    ?? (!firstResponseSatisfied ? ticket.first_response_escalation_at : null)
    ?? ticket.update_escalation_at
    ?? ticket.close_escalation_at;
  return value ? new Date(value) : null;
}

export function slaStatus(ticket: SlaStatusFields, now: Date): SlaStatus {
  const deadline = slaDeadline(ticket);
  if (!deadline) return "no_sla";
  if (ticket.first_response_breached || ticket.close_breached || ticket.sla_status === "breached") return "breached";
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

export function slaRemainingMs(ticket: SlaDeadlineFields, now: Date): number | null {
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
