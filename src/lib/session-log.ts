/**
 * Pure helpers for the hidden Session & Activity Log.
 *
 * Everything here is free of React, the DOM, the API layer, and config
 * globals, so the zero-framework frontend check can import this module
 * directly under `node --experimental-strip-types` (no Vite transform).
 */
import type { AccessSession, SessionActivity } from "@/types";

/** Click the sidebar logo this many times to reveal the hidden nav entry. */
export const LOGO_REVEAL_CLICKS = 5;

/** localStorage key holding whether the hidden nav entry has been revealed. */
export const SESSION_LOG_REVEAL_KEY = "zm-session-log-revealed";

/**
 * Same-pathname beacons inside this window collapse into one event. The
 * backend stores an event timeline, so the client must not write a row per
 * navigation; this dedupes rapid back-and-forth on the same route.
 */
export const ACTIVITY_DEDUP_WINDOW_MS = 5000;

/** Routes whose visits are never beaconed: the login page and the log itself. */
export const ACTIVITY_EXCLUDED_ROUTES = ["/login", "/session-log"] as const;

/**
 * Advance the logo click counter and toggle visibility at the threshold.
 *
 * Pure: the caller owns the count and persists only the resulting visibility.
 */
export function advanceRevealClick(
  count: number,
  revealed: boolean,
  threshold = LOGO_REVEAL_CLICKS,
): { count: number; revealed: boolean } {
  const next = count + 1;
  if (next >= threshold) return { count: 0, revealed: !revealed };
  return { count: next, revealed };
}

/** Whether a stored reveal flag is truthy. Absent or malformed values mean hidden. */
export function parseReveal(stored: string | null): boolean {
  return stored === "1" || stored === "true";
}

function normalizePath(pathname: string): string {
  if (!pathname) return "/";
  const withSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
}

/** Whether a pathname belongs to a page that must never beacon. */
export function isBeaconExcluded(pathname: string): boolean {
  return (ACTIVITY_EXCLUDED_ROUTES as readonly string[]).includes(normalizePath(pathname));
}

export interface BeaconDecision {
  /** Whether the beacon should fire for this location. */
  send: boolean;
  /** The normalized pathname the event should record. */
  route: string;
  /** The pathname to remember as "last seen", valid on both send and skip. */
  lastPath: string;
}

/**
 * Decide whether a route change should beacon.
 *
 * A beacon is skipped when the page is excluded (`/login`, `/session-log`) or
 * when the same pathname was already sent inside the dedup window; the caller
 * feeds back `last.route` and `last.at` unconditionally so a repeated visit to
 * a skipped or excluded route still moves the dedup window forward.
 */
export function beaconDecision(
  pathname: string,
  last: { route: string; at: number } | null,
  now: number,
  windowMs = ACTIVITY_DEDUP_WINDOW_MS,
): BeaconDecision {
  const route = normalizePath(pathname);
  const fallback = last ?? { route, at: now };
  if (isBeaconExcluded(route)) return { send: false, route, lastPath: route };
  if (last && last.route === route && now - last.at < windowMs) {
    return { send: false, route, lastPath: fallback.route };
  }
  return { send: true, route, lastPath: route };
}

// -- Display helpers ---------------------------------------------------------

/** Human label for an activity event kind. */
export type ActivityKind = SessionActivity["kind"];

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  login: "Signed in",
  logout: "Signed out",
  revoke: "Revoked",
  view: "Viewed page",
};

export function activityKindLabel(kind: ActivityKind): string {
  return ACTIVITY_KIND_LABELS[kind] ?? kind;
}

export type SessionStatus = "active" | "revoked" | "ended";

/** A session is live only while it has neither ended nor been revoked. */
export function sessionStatus(session: AccessSession): SessionStatus {
  if (session.revoked) return "revoked";
  if (session.logout_at) return "ended";
  return "active";
}

const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  active: "Open",
  revoked: "Revoked",
  ended: "Ended",
};

export function sessionStatusLabel(session: AccessSession): string {
  return SESSION_STATUS_LABELS[sessionStatus(session)];
}

/** Badge tones the shared `Badge` component supports. */
export type BadgeVariant = "default" | "secondary" | "destructive" | "success" | "warning" | "outline" | "muted";

export interface SessionStatusInfo {
  label: string;
  tone: BadgeVariant;
  /** Only a live session is worth revoking. */
  live: boolean;
}

/** Status plus how it should read in the UI: label, badge tone, and liveness. */
export function sessionStatusInfo(session: AccessSession): SessionStatusInfo {
  const status = sessionStatus(session);
  if (status === "revoked") return { label: "Revoked", tone: "destructive", live: false };
  if (status === "ended") return { label: "Ended", tone: "muted", live: false };
  return { label: "Open", tone: "success", live: true };
}

/**
 * Friendly device label, preferring the server-parsed value but tolerating a
 * blank one (e.g. a request with no User-Agent header).
 */
export function deviceLabel(session: Pick<AccessSession, "device_label" | "user_agent" | "ip">): string {
  const label = session.device_label?.trim();
  if (label) return label;
  const ua = session.user_agent?.trim();
  if (ua) return ua;
  return session.ip?.trim() || "Unknown device";
}

/** Coarse browser family parsed from a User-Agent string. */
export function parseBrowser(userAgent: string): string {
  const ua = userAgent || "";
  if (/edg[ei]?\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/firefox\/|fxios/i.test(ua)) return "Firefox";
  if (/chrome\/|crios/i.test(ua)) return "Chrome";
  if (/safari\//i.test(ua)) return "Safari";
  return "Unknown browser";
}

/** Coarse operating-system family parsed from a User-Agent string. */
export function parseOs(userAgent: string): string {
  const ua = userAgent || "";
  if (/windows/i.test(ua)) return "Windows";
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/linux/i.test(ua)) return "Linux";
  return "Unknown OS";
}

/** "Chrome on Windows" — the friendly device identity shown in the list. */
export function parseDeviceLabel(userAgent: string): string {
  const browser = parseBrowser(userAgent);
  const os = parseOs(userAgent);
  if (browser === "Unknown browser" && os === "Unknown OS") return "Unknown device";
  return `${browser} on ${os}`;
}
