/**
 * A purchase settled in CASH rather than by check.
 *
 * Check monitoring lists every PO that owes a check but has none attached yet —
 * the owner's *"For Payment"* rows, sitting in Upcoming with an **Attach check**
 * button. Some of those were simply paid in cash, and no check is ever coming.
 * With nothing to attach and nothing to clear, they stayed there permanently,
 * inflating both the attention count and the **Still to clear** total with money
 * that had already left the business.
 *
 * So a person can tick one as paid in cash, and the register treats it exactly
 * as it treats a cleared check: the row moves to the Cleared tab, its form of
 * payment reads *Cash*, and it stops being owed.
 *
 * ## "Cleared", not "hidden"
 *
 * The row is not removed. The money was spent and belongs on the register — the
 * Cleared tab is where spent money lives, and it carries who ticked it and when.
 * Ticking is undoable for the same reason `unclearCheck` exists: this is a human
 * recording a fact, and humans mis-click.
 *
 * ## Why this is a column and not part of the PO
 *
 * `coercePurchaseOrder` rebuilds the `po` JSON field by field and drops keys it
 * does not recognise, so a stamp kept there would survive until the next time
 * anybody saved the PO and then silently vanish. `PurchaseRequest.cashPayment`
 * is its own column, and "how this purchase was paid" is a fact about the
 * purchase rather than about the document sent to the supplier.
 */

export interface CashPayment {
  /** The day it was paid, `YYYY-MM-DD`. */
  on: string;
  /** Who recorded it. */
  byName: string;
  /** When they recorded it, ISO — which is not the same as when it was paid. */
  at: string;
  note?: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read a stored cash payment, or null.
 *
 * Strict about the DATE and forgiving about everything else. `on` is what the
 * register renders in its Date Paid/Cleared column and sorts by, so a row whose
 * date is missing or malformed is not a cash payment with a cosmetic problem —
 * it is a row that would sort wrongly and print blank. A missing name is merely
 * a name nobody recorded.
 */
export function coerceCashPayment(value: unknown): CashPayment | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const on = typeof o.on === "string" ? o.on.slice(0, 10) : "";
  if (!YMD.test(on)) return null;
  const note = typeof o.note === "string" ? o.note.trim() : "";
  return {
    on,
    byName: typeof o.byName === "string" ? o.byName : "",
    at: typeof o.at === "string" ? o.at : "",
    ...(note ? { note } : {}),
  };
}

/** True when this purchase has been recorded as paid in cash. */
export const isPaidInCash = (value: unknown): boolean => coerceCashPayment(value) !== null;
