/**
 * Shared team calendar. Any user may add a schedule (it starts PENDING); an
 * Engineer, Admin or Approver approves or rejects it. Categories carry a colour
 * used across the calendar chips and legend.
 */

export type ScheduleStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface ScheduleCategory {
  key: string;
  label: string;
  color: string; // hex — the chip / dot colour
}

export const SCHEDULE_CATEGORIES: ScheduleCategory[] = [
  { key: "general", label: "General", color: "#64748b" },
  { key: "meeting", label: "Meeting", color: "#4f46e5" },
  { key: "delivery", label: "Delivery", color: "#2563eb" },
  { key: "production", label: "Production", color: "#16a34a" },
  { key: "payment", label: "Payment", color: "#d97706" },
  { key: "maintenance", label: "Maintenance", color: "#0d9488" },
  { key: "other", label: "Other", color: "#7c3aed" },
];

const CAT_BY_KEY = new Map(SCHEDULE_CATEGORIES.map((c) => [c.key, c] as const));
export function scheduleCategory(key: string | null | undefined): ScheduleCategory {
  return CAT_BY_KEY.get(key ?? "") ?? SCHEDULE_CATEGORIES[0];
}

export const SCHEDULE_STATUS_LABEL: Record<ScheduleStatus, string> = {
  PENDING: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export type RsvpStatus = "going" | "maybe" | "no" | "invited";
export interface ScheduleAttendee { userId: string; name: string; rsvp: RsvpStatus }
export interface ScheduleAttachment { path: string; name: string; uploadedAt: string }
export interface ScheduleComment { id: string; byId: string; byName: string; text: string; at: string }

export type Recurrence = "daily" | "weekly" | "monthly";
export const RECURRENCE_OPTIONS: { key: string; label: string }[] = [
  { key: "", label: "Does not repeat" },
  { key: "daily", label: "Every day" },
  { key: "weekly", label: "Every week" },
  { key: "monthly", label: "Every month" },
];
export function recurrenceLabel(r: string | null | undefined): string {
  return RECURRENCE_OPTIONS.find((o) => o.key === (r ?? ""))?.label ?? "Does not repeat";
}

/** In-app reminder options — minutes before the event start. */
export const REMINDER_OPTIONS: { key: number | null; label: string }[] = [
  { key: null, label: "No reminder" },
  { key: 0, label: "At start time" },
  { key: 10, label: "10 minutes before" },
  { key: 30, label: "30 minutes before" },
  { key: 60, label: "1 hour before" },
  { key: 180, label: "3 hours before" },
  { key: 1440, label: "1 day before" },
];
export function reminderLabel(m: number | null | undefined): string {
  if (m == null) return "No reminder";
  return REMINDER_OPTIONS.find((o) => o.key === m)?.label ?? `${m} minutes before`;
}

export const RSVP_LABEL: Record<RsvpStatus, string> = { going: "Going", maybe: "Maybe", no: "Can't go", invited: "Invited" };

export function coerceAttendees(v: unknown): ScheduleAttendee[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : null))
    .filter((o): o is Record<string, unknown> => !!o && typeof o.userId === "string" && typeof o.name === "string")
    .map((o) => ({ userId: String(o.userId), name: String(o.name), rsvp: (["going", "maybe", "no", "invited"].includes(String(o.rsvp)) ? String(o.rsvp) : "invited") as RsvpStatus }));
}
export function coerceAttachments(v: unknown): ScheduleAttachment[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : null))
    .filter((o): o is Record<string, unknown> => !!o && typeof o.path === "string" && typeof o.name === "string")
    .map((o) => ({ path: String(o.path), name: String(o.name), uploadedAt: typeof o.uploadedAt === "string" ? o.uploadedAt : "" }));
}
export function coerceComments(v: unknown): ScheduleComment[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : null))
    .filter((o): o is Record<string, unknown> => !!o && typeof o.text === "string")
    .map((o) => ({ id: String(o.id ?? ""), byId: String(o.byId ?? ""), byName: String(o.byName ?? ""), text: String(o.text), at: typeof o.at === "string" ? o.at : "" }));
}

/** The row shape the calendar renders (dates as ISO strings, plus permissions). */
export interface ScheduleView {
  id: string;
  title: string;
  details: string | null;
  category: string;
  startAt: string; // ISO
  endAt: string | null; // ISO
  allDay: boolean;
  location: string | null;
  status: ScheduleStatus;
  createdByName: string;
  decidedByName: string | null;
  decidedAt: string | null; // ISO
  decisionNote: string | null;
  isOwner: boolean;
  canEdit: boolean;
  canDecide: boolean;
  // Extras:
  recurrence: string | null;
  recurrenceUntil: string | null; // ISO date
  remindMinutes: number | null;
  calendar: string | null;
  attendees: ScheduleAttendee[];
  attachments: ScheduleAttachment[];
  comments: ScheduleComment[];
  // Filled per occurrence when a recurring series is expanded:
  recurring?: boolean;
  instanceKey?: string;
}

/** A stored Schedule row (Prisma), for building a ScheduleView. */
export interface ScheduleRow {
  id: string; title: string; details: string | null; category: string;
  startAt: Date; endAt: Date | null; allDay: boolean; location: string | null;
  status: ScheduleStatus; createdById: string; createdByName: string;
  decidedByName: string | null; decidedAt: Date | null; decisionNote: string | null;
  recurrence: string | null; recurrenceUntil: Date | null; remindMinutes: number | null;
  calendar: string | null; attendees: unknown; attachments: unknown; comments: unknown;
}

/** Build the client ScheduleView from a stored row + viewer context. */
export function buildScheduleView(s: ScheduleRow, ctx: { viewerId?: string; canDecide: boolean }): ScheduleView {
  const isOwner = ctx.viewerId != null && s.createdById === ctx.viewerId;
  return {
    id: s.id, title: s.title, details: s.details, category: s.category,
    startAt: s.startAt.toISOString(), endAt: s.endAt ? s.endAt.toISOString() : null,
    allDay: s.allDay, location: s.location, status: s.status,
    createdByName: s.createdByName, decidedByName: s.decidedByName, decidedAt: s.decidedAt ? s.decidedAt.toISOString() : null,
    decisionNote: s.decisionNote, isOwner, canEdit: ctx.canDecide || isOwner, canDecide: ctx.canDecide,
    recurrence: s.recurrence, recurrenceUntil: s.recurrenceUntil ? s.recurrenceUntil.toISOString() : null,
    remindMinutes: s.remindMinutes, calendar: s.calendar,
    attendees: coerceAttendees(s.attendees), attachments: coerceAttachments(s.attachments), comments: coerceComments(s.comments),
  };
}

const MS_PH_ = 8 * 3600 * 1000;
const DAY_ = 86_400_000;
function phOf(ms: number) {
  const d = new Date(ms + MS_PH_);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}
const instantOf = (y: number, mo: number, d: number, hh: number, mm: number) => Date.UTC(y, mo, d, hh, mm) - MS_PH_;

/**
 * Expand recurring schedules into their occurrences within [windowStartMs,
 * windowEndMs]. Non-recurring rows pass through unchanged. Each occurrence keeps
 * the series id (so edit/approve/delete act on the whole series) plus its own
 * start/end and a unique instanceKey for React.
 */
export function expandOccurrences(views: ScheduleView[], windowStartMs: number, windowEndMs: number): ScheduleView[] {
  const out: ScheduleView[] = [];
  for (const v of views) {
    if (!v.recurrence) { out.push(v); continue; }
    const startMs = Date.parse(v.startAt);
    const endMs = v.endAt ? Date.parse(v.endAt) : null;
    const dur = endMs != null ? endMs - startMs : null;
    const untilMs = v.recurrenceUntil ? Date.parse(v.recurrenceUntil) + DAY_ : windowEndMs; // inclusive day
    const hardEnd = Math.min(untilMs, windowEndMs);
    const p0 = phOf(startMs);
    // Start near the window to avoid iterating from a long-ago series start.
    let iStart = 0;
    if (startMs < windowStartMs) {
      if (v.recurrence === "daily") iStart = Math.floor((windowStartMs - startMs) / DAY_) - 1;
      else if (v.recurrence === "weekly") iStart = Math.floor((windowStartMs - startMs) / (7 * DAY_)) - 1;
      else iStart = (phOf(windowStartMs).y - p0.y) * 12 + (phOf(windowStartMs).mo - p0.mo) - 1;
      iStart = Math.max(0, iStart);
    }
    for (let i = iStart, n = 0; n < 800; i++) {
      const occStart =
        v.recurrence === "daily" ? startMs + i * DAY_
        : v.recurrence === "weekly" ? startMs + i * 7 * DAY_
        : instantOf(p0.y, p0.mo + i, p0.d, p0.hh, p0.mm);
      if (occStart > hardEnd) break;
      n++;
      const occEnd = dur != null ? occStart + dur : occStart;
      if (occEnd < windowStartMs) continue;
      out.push({ ...v, startAt: new Date(occStart).toISOString(), endAt: dur != null ? new Date(occStart + dur).toISOString() : null, recurring: true, instanceKey: `${v.id}#${occStart}` });
    }
  }
  return out;
}
