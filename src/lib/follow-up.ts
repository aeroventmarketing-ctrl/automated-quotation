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
  const offsetDate = (i: number) => new Date(startOfDay(input.sentAt).getTime() + offsets[i] * DAY_MS);

  if (input.won) return { state: "won", daysSinceSent, nudgeNumber: sent, dueDate: null };

  if (input.validUntil && calendarDaysBetween(input.validUntil, input.now) > 0) {
    return { state: "expired", daysSinceSent, nudgeNumber: sent, dueDate: null };
  }

  if (sent >= offsets.length) {
    return { state: "exhausted", daysSinceSent, nudgeNumber: sent, dueDate: null };
  }

  // The next unsent nudge is index `sent`. Due once its offset day has arrived.
  const nudgeNumber = sent + 1;
  const dueDate = offsetDate(sent);
  const passed = offsets.filter((o) => daysSinceSent >= o).length;
  if (passed > sent) return { state: "due", daysSinceSent, nudgeNumber, dueDate };
  return { state: "waiting", daysSinceSent, nudgeNumber, dueDate };
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
