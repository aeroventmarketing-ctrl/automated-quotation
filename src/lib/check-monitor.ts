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

/** *"notify the admin at least 3 days before clearing"* — the owner's number. */
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

/** The states the admin is meant to be told about: due within 3 days, or already past. */
export function needsAttention(state: CheckWatchState): boolean {
  return state === "overdue" || state === "due" || state === "soon";
}

export const CHECK_STATE_LABEL: Record<CheckWatchState, string> = {
  cleared: "Cleared",
  overdue: "Overdue — not cleared",
  due: "Clears today",
  soon: "Clearing soon",
  scheduled: "Scheduled",
  undated: "No clearing date read",
};

/** One check, as the monitoring screen and the tile see it. */
export interface CheckWatchRow {
  prId: string;
  path: string; // identifies the check within its PO
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
    poOf: (v: unknown) => { poNumber: string; supplierCompany: string } | null;
  },
): CheckWatchRow[] {
  const rows: CheckWatchRow[] = [];
  for (const pr of prs) {
    const po = helpers.poOf(pr.po);
    for (const doc of helpers.coerceDocs(pr.voucherCheckDocs)) {
      const due = effectiveClearingYMD(doc);
      const original = doc.read?.clearingYMD ?? null;
      const moves = doc.reschedules?.length ?? 0;
      rows.push({
        prId: pr.id,
        path: doc.path,
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
        state: checkWatchState(doc, todayYMD),
        clearedOn: doc.cleared?.on ?? null,
        clearedByName: doc.cleared?.byName ?? null,
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
    nextYMD: dated[0]?.clearingYMD ?? null,
  };
}
