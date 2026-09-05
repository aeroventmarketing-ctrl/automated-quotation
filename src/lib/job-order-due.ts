/**
 * The job-order deadlines an order is working to, and the date its purchases
 * have to beat.
 *
 * The owner, looking at the Purchasing page: *"Show job order deadline at the
 * right side of order number."* A purchaser deciding what to buy first cannot
 * see, from that screen, when production actually needs it — the deadlines are
 * set on the order page, three clicks away.
 *
 * They asked for **every department's**, not just the soonest: an order can be
 * feeding Fans, Duct, Accessories and Motor Controller at once, and which one a
 * given purchase belongs to is not something this screen can know.
 */
import { PRODUCTION_DEPTS, type OrderWorkflow, type ProductionDeptKey } from "@/lib/order-workflow";

export interface JobOrderDue {
  dept: ProductionDeptKey;
  /** "Fans & Blower", "Duct", … — the department as a person names it. */
  label: string;
  /** YYYY-MM-DD. */
  dueAt: string;
}

/**
 * Every department deadline on this order, earliest first.
 *
 * Departments with no job order, or a job order nobody has dated, are left out
 * rather than shown blank — a list of "—" teaches the eye to skip the whole row.
 * Earliest first because that is the one under pressure, whatever else is there.
 */
export function jobOrderDues(wf: OrderWorkflow): JobOrderDue[] {
  return PRODUCTION_DEPTS
    .flatMap(({ key, label }) => {
      const due = wf.jobOrders?.[key]?.dueAt;
      return due ? [{ dept: key, label, dueAt: due }] : [];
    })
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.label.localeCompare(b.label));
}

/**
 * Is this deadline already behind us?
 *
 * Compared as YYYY-MM-DD strings against the caller's "today", so the answer is
 * the same in every timezone the app is read in — a deadline is a calendar day,
 * not an instant.
 */
export const isOverdueDue = (dueAt: string, todayYMD: string): boolean => dueAt < todayYMD;

/** Whole days from today to the deadline. Negative once it has passed. */
export function daysToDue(dueAt: string, todayYMD: string): number {
  const a = Date.parse(`${todayYMD}T00:00:00Z`);
  const b = Date.parse(`${dueAt}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}


/**
 * Who may set the **due date of purchase** on a request.
 *
 * The owner named them: *"purchaser or admin/payment approver can add due date
 * of purchase."* Accounting is deliberately not on the list — they handle the
 * voucher and the check, not when the buying happens.
 *
 * A date, unlike a stage, can be corrected without unwinding anything, so this
 * carries no status window: a purchase that slipped its date needs a new one
 * more than a finished one needs protecting.
 */
export function canSetPurchaseDue(opts: { admin?: boolean; purchaser?: boolean; paymentApprover?: boolean }): boolean {
  return !!opts.admin || !!opts.purchaser || !!opts.paymentApprover;
}

/** How a purchase due date reads on the card. */
export type PurchaseDueState = "none" | "due" | "soon" | "overdue" | "met";

/**
 * Where a purchase stands against its own deadline.
 *
 * `met` once the goods are bought — the date has done its job and stops
 * shouting, however long ago it was. A screen that keeps a purchased item red
 * teaches people to ignore red.
 */
export function purchaseDueState(dueYMD: string | null | undefined, todayYMD: string, purchased: boolean): PurchaseDueState {
  if (!dueYMD) return "none";
  // No "today" to measure against — show the date, claim nothing about it.
  // Without this an unsupplied todayYMD made every dated purchase read "due
  // today", which is the one answer that is always wrong.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayYMD)) return "none";
  if (purchased) return "met";
  const days = daysToDue(dueYMD, todayYMD);
  if (days < 0) return "overdue";
  if (days === 0) return "due";
  return days <= 3 ? "soon" : "none";
}
