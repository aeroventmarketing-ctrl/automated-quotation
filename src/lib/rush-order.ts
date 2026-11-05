/**
 * Rush orders — a client order that has to move faster than the rest.
 *
 * The owner: *"Sometimes we have a rush client order. I need to show it to every
 * role and every stage of the workflow that it is a rush order."* Their rulings:
 *
 *  - The order's **Sales in-charge** (the account holder — who prepared the
 *    quotation) **requests** RUSH, with a reason; the **Payment Approver or an
 *    admin approves** (or declines) it. Those two may also mark an order RUSH
 *    directly, and only they may remove it. A client due date is required — a
 *    rush with no date is not something anyone can act on.
 *  - **One level:** Rush.
 *  - Shown **everywhere the order appears**, to every role, and **stamped on the
 *    printed Job Order, MRF and PO** (the supplier sees it).
 *  - Rush work sorts **first**, and a rush task waiting **4 hours** or more at
 *    one step turns red. No suggested deadlines.
 *  - A **Rush orders** tile on the Management Dashboard.
 *
 * It changes nothing about who acts, the step order or the gating — it is a flag
 * to see and to sort by. Stored on the quotation's classification as `rush`, its
 * own key beside the workflow (like `clientDue`), with an append-only history.
 *
 * Pure and client-safe.
 */

export type RushState = "requested" | "active" | "declined" | "removed";
export type RushAction = "requested" | "approved" | "declined" | "marked" | "removed";

export interface RushEvent {
  action: RushAction;
  byName: string;
  at: string;
  note: string;
}

export interface OrderRush {
  state: RushState;
  /** Why the order is a rush — given with the request (or the direct mark). */
  reason: string;
  requestedByName: string;
  requestedAt: string;
  /** Who approved / declined / marked / removed it last, and when. */
  decidedByName: string;
  decidedAt: string;
  /** Every step, newest first. */
  history: RushEvent[];
}

const STATES: RushState[] = ["requested", "active", "declined", "removed"];
const ACTIONS: RushAction[] = ["requested", "approved", "declined", "marked", "removed"];
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function readRush(classification: unknown): OrderRush | null {
  const v = (classification as Record<string, unknown> | null)?.rush as Record<string, unknown> | undefined;
  if (!v || typeof v !== "object" || !STATES.includes(v.state as RushState)) return null;
  const history: RushEvent[] = Array.isArray(v.history)
    ? (v.history as unknown[])
        .filter((h): h is Record<string, unknown> => !!h && typeof h === "object" && ACTIONS.includes((h as Record<string, unknown>).action as RushAction))
        .map((h) => ({ action: h.action as RushAction, byName: str(h.byName), at: str(h.at), note: str(h.note) }))
    : [];
  return {
    state: v.state as RushState,
    reason: str(v.reason),
    requestedByName: str(v.requestedByName),
    requestedAt: str(v.requestedAt),
    decidedByName: str(v.decidedByName),
    decidedAt: str(v.decidedAt),
    history,
  };
}

/** The order is a RUSH (approved / marked, not removed). */
export const isRushActive = (classification: unknown): boolean => readRush(classification)?.state === "active";

// --- Who ------------------------------------------------------------------------

/** The order's Sales in-charge — the person who prepared its quotation. */
export const canRequestRush = (o: { userId: string | null | undefined; preparedById: string | null | undefined }): boolean =>
  !!o.userId && !!o.preparedById && o.userId === o.preparedById;

/** Approve / decline a request, mark RUSH directly, remove it: the Payment Approver or an admin. */
export const canDecideRush = (o: { admin: boolean; paymentApprover: boolean }): boolean => o.admin || o.paymentApprover;

// --- What each step does ---------------------------------------------------------

export type RushStep =
  | { kind: "request"; reason: string }
  | { kind: "approve"; note: string }
  | { kind: "decline"; note: string }
  | { kind: "mark"; reason: string }
  | { kind: "remove"; note: string };

/**
 * The rush record after a step — or the sentence that refuses it. The server
 * action checks WHO first; this checks WHAT: the step must fit the current state,
 * a reason is required to ask for or mark a rush and to remove one, and a rush
 * needs a client due date.
 */
export function applyRushStep(
  current: OrderRush | null,
  step: RushStep,
  ctx: { byName: string; at: string; hasClientDue: boolean; closed: boolean },
): OrderRush | string {
  const state = current?.state ?? null;
  const text = ("reason" in step ? step.reason : step.note).trim();
  if (text.length > 300) return "Keep it under 300 characters.";
  const ev = (action: RushAction): RushEvent => ({ action, byName: ctx.byName, at: ctx.at, note: text });
  const history = current?.history ?? [];
  switch (step.kind) {
    case "request":
    case "mark": {
      if (ctx.closed) return "This order is closed.";
      if (state === "active") return "This order is already a RUSH.";
      if (step.kind === "request" && state === "requested") return "RUSH has already been requested — it is waiting for the Payment Approver or an admin.";
      if (!text) return "Say why this order is a rush.";
      if (!ctx.hasClientDue) return "Set the Client Due Date first — a rush needs a date to work to.";
      const req = step.kind === "request";
      return {
        state: req ? "requested" : "active",
        reason: text,
        requestedByName: ctx.byName,
        requestedAt: ctx.at,
        decidedByName: req ? "" : ctx.byName,
        decidedAt: req ? "" : ctx.at,
        history: [ev(req ? "requested" : "marked"), ...history],
      };
    }
    case "approve":
    case "decline": {
      if (state !== "requested" || !current) return "There's no RUSH request waiting on this order.";
      const ok = step.kind === "approve";
      if (ok && !ctx.hasClientDue) return "Set the Client Due Date first — a rush needs a date to work to.";
      return { ...current, state: ok ? "active" : "declined", decidedByName: ctx.byName, decidedAt: ctx.at, history: [ev(ok ? "approved" : "declined"), ...history] };
    }
    case "remove": {
      if (state !== "active" || !current) return "This order isn't a RUSH.";
      if (!text) return "Say why the rush is over.";
      return { ...current, state: "removed", decidedByName: ctx.byName, decidedAt: ctx.at, history: [ev("removed"), ...history] };
    }
  }
}

// --- Seeing it --------------------------------------------------------------------

const dayNo = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** Whole Manila days from today to the client due date (negative = overdue), or null. */
export function rushDaysLeft(clientDueYMD: string | null | undefined, todayYMD: string): number | null {
  if (!clientDueYMD || !/^\d{4}-\d{2}-\d{2}$/.test(clientDueYMD) || !/^\d{4}-\d{2}-\d{2}$/.test(todayYMD)) return null;
  return dayNo(clientDueYMD) - dayNo(todayYMD);
}

/** "RUSH · 3d left", "RUSH · due today", "RUSH · 2d overdue", or "RUSH". */
export function rushLabel(daysLeft: number | null): string {
  if (daysLeft == null) return "RUSH";
  if (daysLeft === 0) return "RUSH · due today";
  if (daysLeft < 0) return `RUSH · ${-daysLeft}d overdue`;
  return `RUSH · ${daysLeft}d left`;
}

/** A rush task waiting this long at one step turns red. */
export const RUSH_ALARM_HOURS = 4;

/** Whole hours a rush task has waited, when it is at or past the alarm — else null. */
export function rushWaitAlarm(sinceISO: string | null | undefined, nowMs: number): number | null {
  if (!sinceISO) return null;
  const t = Date.parse(sinceISO);
  if (!Number.isFinite(t)) return null;
  const h = Math.floor((nowMs - t) / 3_600_000);
  return h >= RUSH_ALARM_HOURS ? h : null;
}

/** "Waiting 5h — RUSH", "Waiting 2d — RUSH" (from 48 hours). */
export function rushWaitText(hours: number): string {
  return hours >= 48 ? `Waiting ${Math.floor(hours / 24)}d — RUSH` : `Waiting ${hours}h — RUSH`;
}

/** Rush first, the rest after — each group keeping the order it had. */
export function rushFirst<T>(items: readonly T[], isRush: (t: T) => boolean): T[] {
  return [...items.filter(isRush), ...items.filter((t) => !isRush(t))];
}

/** "Requested", "Approved", … — a history line's verb. */
export const RUSH_ACTION_LABEL: Record<RushAction, string> = {
  requested: "Requested",
  approved: "Approved",
  declined: "Declined",
  marked: "Marked RUSH",
  removed: "Removed",
};

/**
 * The stamp on a printed Job Order / MRF / PO of a RUSH order still open:
 * "RUSH ORDER — due Nov 8, 2026" (or just "RUSH ORDER"), else null.
 */
export function rushStampText(classification: unknown): string | null {
  if (!isRushActive(classification)) return null;
  const wf = (classification as Record<string, unknown> | null)?.workflow as Record<string, unknown> | undefined;
  if (wf?.stage === "closed") return null;
  const due = ((classification as Record<string, unknown>).clientDue as Record<string, unknown> | undefined)?.date;
  if (typeof due !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return "RUSH ORDER";
  const [y, m, d] = due.split("-").map(Number);
  const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  return `RUSH ORDER — due ${label}`;
}
