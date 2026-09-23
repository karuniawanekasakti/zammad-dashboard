import type { TicketHistory } from "@/types";

export interface SlaSegment {
  kind: "active" | "paused";
  start: string;
  end: string;
  percent: number;
  reason?: "pending state" | "customer reply";
  durationMs?: number;
}

export interface SlaActivity {
  kind: "start" | "pause" | "resume" | "current";
  at: string;
  reason?: SlaSegment["reason"];
}

export interface SlaSegmentsResult {
  segments: SlaSegment[];
  activities: SlaActivity[];
}

type PauseEvent = { at: number; pause: boolean; reason?: SlaSegment["reason"] };

/** Converts ticket history into chronological active and paused display spans. */
export function buildSlaSegments(history: TicketHistory[], start: Date, current: Date): SlaSegmentsResult {
  const startMs = start.getTime();
  const currentMs = Math.max(startMs, current.getTime());
  const events: PauseEvent[] = history.flatMap((entry) => {
    const at = new Date(entry.created_at ?? entry.updated_at ?? "").getTime();
    if (!Number.isFinite(at) || at <= startMs || at >= currentMs) return [];

    const from = String(entry.value_from ?? entry.from ?? "").toLowerCase();
    const to = String(entry.value_to ?? entry.to ?? "").toLowerCase();
    if (entry.attribute === "state" && to === "pending") return [{ at, pause: true, reason: "pending state" as const }];
    if (entry.attribute === "state" && from === "pending" && to !== "pending") return [{ at, pause: false }];
    if (entry.type === "customer_reply") return [{ at, pause: true, reason: "customer reply" as const }];
    if (entry.type === "agent_reply") return [{ at, pause: false }];
    return [];
  }).sort((a, b) => a.at - b.at);

  const segments: SlaSegment[] = [];
  const activities: SlaActivity[] = [{ kind: "start", at: start.toISOString() }];
  let cursor = startMs;
  let paused = false;
  let reason: SlaSegment["reason"];

  for (const event of events) {
    if (event.pause === paused) continue;
    if (event.at > cursor) {
      segments.push({
        kind: paused ? "paused" : "active",
        start: new Date(cursor).toISOString(),
        end: new Date(event.at).toISOString(),
        percent: ((event.at - cursor) / Math.max(1, currentMs - startMs)) * 100,
        ...(paused ? { reason, durationMs: event.at - cursor } : {}),
      });
    }
    paused = event.pause;
    reason = event.reason;
    cursor = event.at;
    activities.push(paused
      ? { kind: "pause", at: new Date(event.at).toISOString(), reason }
      : { kind: "resume", at: new Date(event.at).toISOString() });
  }

  segments.push({
    kind: paused ? "paused" : "active",
    start: new Date(cursor).toISOString(),
    end: new Date(currentMs).toISOString(),
    percent: ((currentMs - cursor) / Math.max(1, currentMs - startMs)) * 100,
    ...(paused ? { reason, durationMs: currentMs - cursor } : {}),
  });
  activities.push({ kind: "current", at: new Date(currentMs).toISOString() });

  return { segments, activities };
}
