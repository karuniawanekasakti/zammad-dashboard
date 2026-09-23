import type { TicketArticle, TicketHistory } from "../types/index.ts";

export type SlaEventType =
  | "sla_start"
  | "sla_pause"
  | "sla_resume"
  | "sla_warning"
  | "sla_critical"
  | "sla_breach"
  | "sla_milestone_complete";

export type SlaTimelineType = SlaEventType | "article";

interface SlaTimelineBase {
  id: string;
  timestamp: string;
  label: string;
  body?: string;
}

export type SlaTimelineEntry = SlaTimelineBase & (
  | { type: SlaEventType }
  | {
      type: "article";
      authorName: string;
      authorRole: TicketArticle["author_role"];
      articleType: TicketArticle["type"];
      internal: boolean;
    }
);

const SLA_TYPES: Record<SlaEventType, true> = {
  sla_start: true,
  sla_pause: true,
  sla_resume: true,
  sla_warning: true,
  sla_critical: true,
  sla_breach: true,
  sla_milestone_complete: true,
};

function historyType(row: TicketHistory): SlaEventType | null {
  const explicit = String(row.type ?? row.action ?? row.attribute ?? "").toLowerCase();
  if (explicit in SLA_TYPES) return explicit as SlaEventType;

  if (row.attribute === "state") {
    const from = String(row.value_from ?? row.from ?? "").toLowerCase();
    const to = String(row.value_to ?? row.to ?? "").toLowerCase();
    if (!from.startsWith("pending") && to.startsWith("pending")) return "sla_pause";
    if (from.startsWith("pending") && !to.startsWith("pending")) return "sla_resume";
  }
  return null;
}

function milestone(row: TicketHistory) {
  return String(row.title ?? row.body ?? row.value_to ?? row.to ?? "SLA").replace(/^sla[_ ]?/i, "").replace(/_/g, " ");
}

function eventLabel(type: SlaEventType, row: TicketHistory) {
  const name = milestone(row);
  const labels: Record<SlaEventType, string> = {
    sla_start: `${name} started`,
    sla_pause: `${name} paused due to pending state`,
    sla_resume: `${name} resumed`,
    sla_warning: `${name} entered warning`,
    sla_critical: `${name} entered critical`,
    sla_breach: `${name} breached`,
    sla_milestone_complete: `${name} completed`,
  };
  return labels[type];
}

export function mergeSlaTimeline(history: TicketHistory[], articles: TicketArticle[]): SlaTimelineEntry[] {
  const events: SlaTimelineEntry[] = [];

  history.forEach((row, index) => {
    const type = historyType(row);
    const timestamp = String(row.created_at ?? row.updated_at ?? "");
    if (!type || !timestamp) return;
    events.push({
      id: `sla-${String(row.id ?? index)}`,
      type,
      timestamp,
      label: eventLabel(type, row),
      body: typeof row.body === "string" ? row.body : undefined,
    });
  });

  for (const article of articles) {
    events.push({
      id: `article-${article.id}`,
      type: "article",
      timestamp: article.created_at,
      label: article.internal ? "Internal note" : "Article",
      body: article.body,
      authorName: article.author_name,
      authorRole: article.author_role,
      articleType: article.type,
      internal: article.internal,
    });
  }

  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
}

export const mergeEventsAndArticles = mergeSlaTimeline;
