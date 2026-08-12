/**
 * "Reconciled by hand" — every item whose reconciliation / liquidation figures
 * were typed in manually (tallied against the PO / released cash) rather than
 * AI-read and verified against the uploaded receipt. Read-only reporting for the
 * Production Dashboard. Covers two sources:
 *
 *  - PurchaseRequest reconciliations → POs and department requisitions
 *    (`/purchasing?req=<id>` opens the Purchasing tab on that request).
 *  - CashRequest liquidations → cash vouchers
 *    (`/cash-requests?id=<id>` opens the Cash Requests tab on that voucher).
 *
 * A row qualifies when it was recorded (has `recordedAt`) and was NOT AI-verified
 * (`aiVerified !== true`). Tallies recorded by an Admin or the Payment Approver are
 * excluded — they're the authorised manual-tally roles, so this list surfaces only
 * the hand-tallies done by everyone else (Accounting / Purchaser / requestor). A
 * cash liquidation whose per-line tally an admin has since corrected (`adminTally`),
 * or a reconciliation / liquidation whose discrepancy has already been approved (by
 * the Payment Approver or an Admin), is also excluded (it's been handled). Each row
 * keeps who recorded it, their designation, and the date/time.
 */
import { prisma } from "@/lib/db";
import { coercePurchaseOrder, poTotals } from "@/lib/purchase-order";
import { coerceReconciliation, isReconciled } from "@/lib/purchase-reconcile";
import { coerceLiquidation, isLiquidated } from "@/lib/cash-request";
import { isDeptRequisition } from "@/lib/purchasing";
import { formatDateTime } from "@/lib/utils";

export type ManualReconKind = "PO" | "Requisition" | "Cash";

export interface ManualReconRow {
  id: string;
  kind: ManualReconKind;
  ref: string; // PO number or cash-voucher number
  title: string; // supplier (PO) or purpose (cash)
  amount: number;
  recordedLabel: string; // "Name (Designation) · Aug 9, 2026, 6:27 PM"
  recordedAtISO: string;
  href: string;
}

const recordedLabel = (name?: string, role?: string, at?: string): string =>
  `${name || "—"}${role ? ` (${role})` : ""}${at ? ` · ${formatDateTime(new Date(at))}` : ""}`;

// Authorised manual-tally roles — a hand-tally by these is expected, so it's kept
// off the oversight list.
const EXCLUDED_ROLES = new Set(["Admin", "Payment Approver"]);

export async function getManualReconciliations(): Promise<ManualReconRow[]> {
  const [prs, crs] = await Promise.all([
    prisma.purchaseRequest
      .findMany({ select: { id: true, kind: true, mrfId: true, po: true, reconciliation: true } })
      .catch(() => []),
    prisma.cashRequest
      .findMany({ select: { id: true, number: true, purpose: true, amount: true, liquidation: true } })
      .catch(() => []),
  ]);

  const rows: ManualReconRow[] = [];

  // POs / requisitions — reconciled by hand (not AI-verified).
  for (const pr of prs) {
    const r = coerceReconciliation(pr.reconciliation);
    if (!isReconciled(r) || r.aiVerified === true || !r.recordedAt) continue;
    if (r.recordedRole && EXCLUDED_ROLES.has(r.recordedRole)) continue;
    // A discrepancy that's been authorised (by the Payment Approver or an Admin)
    // is already handled — drop it.
    if (r.approval) continue;
    const po = coercePurchaseOrder(pr.po);
    rows.push({
      id: `pr-${pr.id}`,
      kind: isDeptRequisition(pr) ? "Requisition" : "PO",
      ref: po?.poNumber || "—",
      title: po?.supplier?.company || "",
      amount: po ? poTotals(po).net : 0,
      recordedLabel: recordedLabel(r.recordedByName, r.recordedRole, r.recordedAt),
      recordedAtISO: r.recordedAt,
      href: `/purchasing?req=${pr.id}`,
    });
  }

  // Cash vouchers — liquidated by hand (not AI-verified).
  for (const cr of crs) {
    const l = coerceLiquidation(cr.liquidation);
    if (!isLiquidated(l) || l.aiVerified === true || !l.recordedAt) continue;
    if (l.recordedRole && EXCLUDED_ROLES.has(l.recordedRole)) continue;
    // An admin has corrected the per-line tally — an authorised hand-tally, so
    // it's handled and drops off this oversight list.
    if (l.adminTally) continue;
    // A discrepancy that's been authorised (Payment Approver or Admin) is handled.
    if (l.approval) continue;
    rows.push({
      id: `cr-${cr.id}`,
      kind: "Cash",
      ref: cr.number,
      title: cr.purpose || "",
      amount: typeof l.actualSpent === "number" ? l.actualSpent : Number(cr.amount) || 0,
      recordedLabel: recordedLabel(l.recordedByName, l.recordedRole, l.recordedAt),
      recordedAtISO: l.recordedAt,
      href: `/cash-requests?id=${cr.id}`,
    });
  }

  // Most recently recorded first.
  return rows.sort((a, b) => b.recordedAtISO.localeCompare(a.recordedAtISO));
}
