/**
 * Client follow-up rules engine (Sales/CRM module, ERP Stage 2).
 *
 * Pure, side-effect-free evaluation of whether a SENT quotation is due for a
 * follow-up nudge. The scheduler / UI feed it a quote's dates and how many
 * nudges have already gone out; it answers "due / waiting / exhausted / …" plus
 * which nudge is next. Nothing here sends anything — sending and logging live in
 * later increments. Settings ride in config/JSON (no schema change), so the
 * cadence is tunable without a migration.
 */

export interface FollowUpSettings {
  /** Days after the quote was sent that each nudge becomes due, ascending. */
  offsetsDays: number[];
  /** Hard cap on how many nudges a single quote will ever receive. */
  maxNudges: number;
}

/** Business default: nudge on day 3, 7, 14; never more than 3 times. */
export const FOLLOW_UP_DEFAULTS: FollowUpSettings = { offsetsDays: [3, 7, 14], maxNudges: 3 };

export type FollowUpState =
  | "won" // the deal is closed — stop
  | "expired" // the quote's validity has lapsed — stop
  | "exhausted" // every allowed nudge has already been sent — stop
  | "due" // a nudge is due now
  | "waiting"; // in the window, next nudge is still in the future

export interface FollowUpInput {
  /** When the quote was marked SENT (fall back to createdAt if never stamped). */
  sentAt: Date;
  /** Quote validity end date, if any. */
  validUntil: Date | null;
  /** Deal already won (or the inquiry closed) — stop following up. */
  won: boolean;
  /** How many nudges have already been sent for this quote (0 in dry-run). */
  nudgesSent: number;
  /** "Now" — passed in so the function stays pure and testable. */
  now: Date;
  /**
   * Optional campaign start. When set, a quote's FIRST nudge is due no earlier
   * than this date — so a whole backlog of already-sent quotes all become due for
   * nudge 1 on the campaign start day, instead of nothing (or everything's later
   * nudges) firing at once. New quotes sent after the start keep their normal
   * `sentAt + offsets[0]` timing.
   */
  campaignStartAt?: Date | null;
  /**
   * When the most recent nudge actually went out. When known, each SUBSEQUENT
   * nudge is spaced by the cadence interval from this date (not from `sentAt`), so
   * throttled/backlog sends never bunch several nudges together for one client.
   */
  lastSentAt?: Date | null;
}

export interface FollowUpResult {
  state: FollowUpState;
  /** Whole calendar days since the quote was sent. */
  daysSinceSent: number;
  /** 1-based nudge that is due (when `due`) or next up (when `waiting`). */
  nudgeNumber: number;
  /** The date the current/next nudge is (or was) due. */
  dueDate: Date | null;
}

const DAY_MS = 86_400_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole calendar days from `a` to `b` (b - a), ignoring the time of day. */
export function calendarDaysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
}

/**
 * Decide the follow-up state for one quote. Precedence: won → expired →
 * exhausted → due → waiting. A nudge is "due" when its day-offset has passed and
 * it hasn't been sent yet; `nudgeNumber` is the earliest unsent nudge.
 */
export function evaluateFollowUp(
  input: FollowUpInput,
  settings: FollowUpSettings = FOLLOW_UP_DEFAULTS,
): FollowUpResult {
  const offsets = settings.offsetsDays.slice(0, settings.maxNudges);
  const daysSinceSent = calendarDaysBetween(input.sentAt, input.now);
  const sent = Math.max(0, input.nudgesSent);

  if (input.won) return { state: "won", daysSinceSent, nudgeNumber: sent, dueDate: null };

  if (input.validUntil && calendarDaysBetween(input.validUntil, input.now) > 0) {
    return { state: "expired", daysSinceSent, nudgeNumber: sent, dueDate: null };
  }

  if (sent >= offsets.length) {
    return { state: "exhausted", daysSinceSent, nudgeNumber: sent, dueDate: null };
  }

  // Due date for the next unsent nudge (index `sent`).
  const nudgeNumber = sent + 1;
  let dueDate: Date;
  if (sent === 0) {
    // First nudge: normally `sentAt + offsets[0]`, but never earlier than the
    // campaign start — so an old backlog quote becomes due on the start day while
    // a freshly-sent quote still waits its offset.
    const baseDue = startOfDay(input.sentAt).getTime() + offsets[0] * DAY_MS;
    const campaign = input.campaignStartAt ? startOfDay(input.campaignStartAt).getTime() : -Infinity;
    dueDate = new Date(Math.max(baseDue, campaign));
  } else if (input.lastSentAt) {
    // Subsequent nudge: space the cadence interval from the last ACTUAL send, so
    // a client reached late in a backlog isn't hit with several nudges at once.
    const gap = Math.max(1, offsets[sent] - offsets[sent - 1]);
    dueDate = new Date(startOfDay(input.lastSentAt).getTime() + gap * DAY_MS);
  } else {
    // No send timestamp known — fall back to the classic offset-from-sent timing.
    dueDate = new Date(startOfDay(input.sentAt).getTime() + offsets[sent] * DAY_MS);
  }

  const due = calendarDaysBetween(dueDate, input.now) >= 0; // now has reached the due day
  return { state: due ? "due" : "waiting", daysSinceSent, nudgeNumber, dueDate };
}

/** Read the count of auto follow-ups already sent from a quote's classification JSON. */
export function nudgesSentFrom(classification: unknown): number {
  const fu = (classification as Record<string, unknown> | null)?.followUp as
    | Record<string, unknown>
    | undefined;
  const sent = fu?.sent;
  return Array.isArray(sent) ? sent.length : 0;
}

/** Read the sent-date stamp (ISO) from classification JSON, or null. */
export function sentAtFrom(classification: unknown): string | null {
  const v = (classification as Record<string, unknown> | null)?.sentAt;
  return typeof v === "string" ? v : null;
}

/** The latest "at" among the auto follow-ups already sent for a quote, or null. */
export function lastNudgeAtFrom(classification: unknown): string | null {
  return latestAtOf(classification, "sent");
}

/** Count of auto follow-up SMS already sent for a quote (independent channel). */
export function smsNudgesSentFrom(classification: unknown): number {
  const fu = (classification as Record<string, unknown> | null)?.followUp as Record<string, unknown> | undefined;
  const sent = fu?.smsSent;
  return Array.isArray(sent) ? sent.length : 0;
}

/** The latest "at" among the auto follow-up SMS already sent for a quote, or null. */
export function lastSmsAtFrom(classification: unknown): string | null {
  return latestAtOf(classification, "smsSent");
}

/** Latest "at" timestamp within a `followUp.<key>` array (`sent` / `smsSent`). */
function latestAtOf(classification: unknown, key: "sent" | "smsSent"): string | null {
  const fu = (classification as Record<string, unknown> | null)?.followUp as Record<string, unknown> | undefined;
  const arr = fu?.[key];
  if (!Array.isArray(arr) || arr.length === 0) return null;
  let latest: string | null = null;
  for (const s of arr) {
    const at = (s as Record<string, unknown> | null)?.at;
    if (typeof at === "string" && (latest === null || at > latest)) latest = at;
  }
  return latest;
}
