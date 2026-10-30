/**
 * Who may edit a purchase order — its supplier, terms, EWT, remarks and its
 * lines (add, change, delete) — and when.
 *
 * The owner: *"allow purchaser to edit purchase order, delete and modify rows in
 * purchase order in Purchasing Pending and Purchasing Approved Tab."* Until then
 * the Payment Approver's approval of the PO locked it to admins. Now the
 * Purchaser keeps editing through both tabs — up to the voucher being SIGNED,
 * which is when the request moves to Budgeted (`isBudgetCommitted`). An admin's
 * reach is unchanged.
 *
 * Pure and client-safe: the PO cards and the server actions read the same rule.
 */
import { prMainIndex, type PRStatus } from "@/lib/purchasing";

/** Purchasing's Pending and Approved tabs: PENDING_APPROVAL, APPROVED, VOUCHER_READY. */
export function inPendingOrApprovedTab(status: PRStatus | string): boolean {
  const i = prMainIndex(status as PRStatus);
  return i >= 0 && i < prMainIndex("VOUCHER_SIGNED");
}

/**
 * A single request's PO. The Purchaser: in the Pending / Approved tabs, or any
 * time before the Approver has approved the PO (a request that never takes that
 * approval — one linked to an order — keeps the reach it always had). An admin:
 * always.
 */
export function canEditSinglePo(o: { admin: boolean; purchaser: boolean; status: PRStatus | string; poApproved: boolean }): boolean {
  if (o.admin) return true;
  if (!o.purchaser) return false;
  return !o.poApproved || inPendingOrApprovedTab(o.status);
}

/** A combined PO: only before the voucher is signed, for the Purchaser and an admin alike. */
export function canEditCombinedPo(o: { admin: boolean; purchaser: boolean; status: PRStatus | string }): boolean {
  return (o.admin || o.purchaser) && inPendingOrApprovedTab(o.status);
}
