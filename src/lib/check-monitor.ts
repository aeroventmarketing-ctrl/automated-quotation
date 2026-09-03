/**
 * Check monitoring — watching every issued check towards the day it clears.
 *
 * The owner's rule: *"Purpose of check monitoring tile is to monitor the checks
 * clearing date, notify the admin at least 3 days before clearing. Move the
 * cleared check to a separate tab once check is cleared. If in case the check
 * cannot be cleared because of lack of funds, admin has the option to move the
 * check date to other date."*
 *
 * The whole thing rests on a date the AI read off the face of the check, so two
 * things are deliberate:
 *
 *  - **An undated check is called undated, never assumed.** A photo with glare
 *    over the date box yields no clearing date, and inventing one would put a
 *    real payment on a day nobody agreed to.
 *  - **"Cleared" is recorded by a person.** Only the bank knows whether a check
 *    cleared; a date passing proves nothing. So a check does not move itself to
 *    the Cleared tab on its due date — it waits to be told.
 */
import type { CheckDoc } from "@/lib/voucher-check";
import { effectiveClearingYMD } from "@/lib/voucher-check";

/**
 * How far ahead a check reads as *Clearing soon* on screen.
 *
 * This is a DISPLAY threshold only. It began life as the owner's *"notify the
 * admin at least 3 days before clearing"*, but they withdrew the notification:
 * *"do not notify the admin for checks that will soon clear."* The badge stays
 * so the schedule can be read at a glance; nothing is pushed at anyone because
 * of it.
 */
export const CHECK_NOTICE_DAYS = 3;

export type CheckWatchState =
  | "cleared" // the bank cleared it — the Cleared tab
  | "overdue" // its clearing date has passed and nobody has cleared it
  | "due" // clears today
  | "soon" // within CHECK_NOTICE_DAYS — this is what the admin is notified about
  | "scheduled" // further out
  | "undated"; // the check was never read, or its date couldn't be made out

/** Whole days from `fromYMD` to `toYMD`. Negative when `toYMD` is in the past. */
export function daysBetweenYMD(fromYMD: string, toYMD: string): number {
  const a = Date.parse(`${fromYMD}T00:00:00Z`);
  const b = Date.parse(`${toYMD}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function checkWatchState(doc: CheckDoc, todayYMD: string): CheckWatchState {
  if (doc.cleared) return "cleared";
  const due = effectiveClearingYMD(doc);
  if (!due) return "undated";
  const days = daysBetweenYMD(todayYMD, due);
  if (days < 0) return "overdue";
  if (days === 0) return "due";
  return days <= CHECK_NOTICE_DAYS ? "soon" : "scheduled";
}

/**
 * The states drawn in amber ON SCREEN — clearing within 3 days, today, or
 * already past. A display rule: it decides colour, not who gets told.
 */
export function needsAttention(state: CheckWatchState): boolean {
  return state === "overdue" || state === "due" || state === "soon";
}

/**
 * The one state that PUSHES a task at the admin — a check whose date has passed
 * and which nobody has cleared.
 *
 * Deliberately narrower than `needsAttention`, on the owner's instruction: *"do
 * not notify the admin for checks that will soon clear."* A check that is merely
 * approaching, today's included, is on the register and in First Priority where
 * they are already looking; a check that should have cleared and did not is the
 * exception worth interrupting someone for.
 */
export function notifiesAdmin(state: CheckWatchState): boolean {
  return state === "overdue";
}

export const CHECK_STATE_LABEL: Record<CheckWatchState, string> = {
  cleared: "Cleared",
  overdue: "Overdue — not cleared",
  due: "Clears today",
  soon: "Clearing soon",
  scheduled: "Scheduled",
  undated: "No clearing date read",
};

/**
 * The owner's own status vocabulary, taken from the legend at the foot of their
 * register (`Pending · For Payment · Check Clearing · Finished`).
 *
 * This screen only ever holds the last two: a row exists here because a check
 * exists, so it is either still clearing or finished. *Pending* and *For
 * Payment* describe a PO before any check is written, which is a payables
 * question, not a check one.
 */
export function registerStatus(state: CheckWatchState): "Check Clearing" | "Finished" {
  return state === "cleared" ? "Finished" : "Check Clearing";
}

/**
 * Post-dated or not. Every row in the owner's register reads **PDC**, which is
 * the norm for a terms supplier — but it is derived rather than assumed, so a
 * current-dated check is not mislabelled.
 */
export function formOfPayment(poDate: string | null, clearingYMD: string | null): "PDC" | "Check" {
  if (!poDate || !clearingYMD) return "Check";
  return clearingYMD > poDate.slice(0, 10) ? "PDC" : "Check";
}

/** One check, as the monitoring screen and the tile see it. */
export interface CheckWatchRow {
  prId: string;
  path: string; // identifies the check within its PO
  /** The date on the PO itself — the register's leading column. */
  poDate: string | null;
  poNumber: string;
  supplier: string;
  orderId: string | null;
  checkNo: string | null;
  amount: number | null;
  /** The date it is expected to clear — rescheduled if it was moved. */
  clearingYMD: string | null;
  /** The date printed on the check, when it differs from the one above. */
  originalYMD: string | null;
  /** How many times the date has been moved. */
  moves: number;
  /** Why it was last moved (typically insufficient funds). */
  lastMoveReason: string | null;
  daysLeft: number | null;
  state: CheckWatchState;
  clearedOn: string | null;
  clearedByName: string | null;
  /** "Check Clearing" / "Finished" — the owner's register wording. */
  statusLabel: string;
  /** "PDC" for a post-dated check, the register's Form of Payment column. */
  form: "PDC" | "Check";
  /** Why a date was moved, or the note left when it cleared. */
  remarks: string | null;
}

/** The PurchaseRequest fields this reads — a subset, so callers can select narrowly. */
export interface CheckWatchSource {
  id: string;
  quotationId: string | null;
  po: unknown;
  voucherCheckDocs: unknown;
}

export function buildCheckWatch(
  prs: CheckWatchSource[],
  todayYMD: string,
  helpers: {
    coerceDocs: (v: unknown) => CheckDoc[];
  poOf: (v: unknown) => { poNumber: string; supplierCompany: string; date: string | null } | null;
  },
): CheckWatchRow[] {
  const rows: CheckWatchRow[] = [];
  for (const pr of prs) {
    const po = helpers.poOf(pr.po);
    for (const doc of helpers.coerceDocs(pr.voucherCheckDocs)) {
      const due = effectiveClearingYMD(doc);
      const original = doc.read?.clearingYMD ?? null;
      const moves = doc.reschedules?.length ?? 0;
      const state = checkWatchState(doc, todayYMD);
      const poDate = po?.date ? po.date.slice(0, 10) : null;
      rows.push({
        prId: pr.id,
        path: doc.path,
        poDate,
        poNumber: po?.poNumber ?? "—",
        supplier: po?.supplierCompany ?? "",
        orderId: pr.quotationId,
        checkNo: doc.read?.checkNo ?? null,
        amount: doc.read?.amount ?? null,
        clearingYMD: due,
        originalYMD: original && original !== due ? original : null,
        moves,
        lastMoveReason: moves ? doc.reschedules![moves - 1].reason || null : null,
        daysLeft: due ? daysBetweenYMD(todayYMD, due) : null,
        state,
        clearedOn: doc.cleared?.on ?? null,
        clearedByName: doc.cleared?.byName ?? null,
        statusLabel: registerStatus(state),
        form: formOfPayment(poDate, due),
        // The register's Remarks column, filled with what the system actually
        // knows: why a date moved, or the note left when it cleared.
        remarks: doc.cleared?.note ?? (moves ? doc.reschedules![moves - 1].reason || null : null),
      });
    }
  }
  // Soonest first among the live ones; most recently cleared first among the rest.
  return rows.sort((a, b) => {
    if (a.state === "cleared" && b.state !== "cleared") return 1;
    if (b.state === "cleared" && a.state !== "cleared") return -1;
    if (a.state === "cleared" && b.state === "cleared") return (b.clearedOn ?? "").localeCompare(a.clearedOn ?? "");
    // An undated check sorts last among the live ones — it has no day to sort by.
    if (!a.clearingYMD) return b.clearingYMD ? 1 : 0;
    if (!b.clearingYMD) return -1;
    return a.clearingYMD.localeCompare(b.clearingYMD) || a.poNumber.localeCompare(b.poNumber);
  });
}

export interface CheckWatchSummary {
  /** Everything not yet cleared. */
  open: number;
  /** Of those, the ones the admin is being told about (≤3 days, today, or past). */
  attention: number;
  overdue: number;
  cleared: number;
  undated: number;
  /** Total peso value still to clear (checks with a readable amount). */
  openAmount: number;
  /**
   * The owner's **Total First Priority**: every uncleared check whose clearing
   * date has ARRIVED — today or earlier.
   *
   * *"if not cleared it will stay in this row"* — a check whose date has passed
   * is more urgent, not less, so it keeps counting until someone confirms the
   * bank took it. Deliberately NOT the same set as the 3-day notice: that warns
   * ahead of time, this is money the bank can take today.
   */
  firstPriorityAmount: number;
  /** The next clearing date among the open checks. */
  nextYMD: string | null;
}

export function checkWatchSummary(rows: CheckWatchRow[]): CheckWatchSummary {
  const open = rows.filter((r) => r.state !== "cleared");
  const dated = open.filter((r) => r.clearingYMD).sort((a, b) => a.clearingYMD!.localeCompare(b.clearingYMD!));
  return {
    open: open.length,
    attention: open.filter((r) => needsAttention(r.state)).length,
    overdue: open.filter((r) => r.state === "overdue").length,
    cleared: rows.length - open.length,
    undated: open.filter((r) => r.state === "undated").length,
    openAmount: open.reduce((s, r) => s + (r.amount ?? 0), 0),
    firstPriorityAmount: open
      .filter((r) => r.state === "due" || r.state === "overdue")
      .reduce((s, r) => s + (r.amount ?? 0), 0),
    nextYMD: dated[0]?.clearingYMD ?? null,
  };
}
