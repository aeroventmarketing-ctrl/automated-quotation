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
import { coerceReconciliation, isReconciled, canReconcileAt } from "@/lib/purchase-reconcile";
import { coerceLiquidation, isLiquidated, canLiquidateAt, type CashRequestStatus } from "@/lib/cash-request";
import { isDeptRequisition, type PRStatus } from "@/lib/purchasing";
import { poBatchId } from "@/lib/purchase-batch";
import { formatDateTime } from "@/lib/utils";

/**
 * What makes two PurchaseRequest rows the SAME purchase order.
 *
 * A combined PO stores the identical `po` JSON — same PO number, same combined
 * lines, same total — on **every member request** (see `lib/purchase-batch`). So
 * a PO covering four requests is four rows in this table, and a loop over
 * requests reports it four times at four times its value.
 *
 * The owner: *"List shows multiple same PO's."* — `PO-AFBM20260000797` four
 * times at ₱44,845.98 each.
 *
 * Keyed on the BATCH id, not the PO number. A single-request PO has no batch id
 * and falls back to its own request id, so it can never be merged with anything
 * — where keying on the PO number would silently collapse two unrelated requests
 * that happened to carry the same number, which is a data error to surface, not
 * to hide.
 */
const purchaseOrderKey = (prId: string, po: unknown): string => poBatchId(po) ?? prId;

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

  // POs / requisitions — reconciled by hand (not AI-verified). One entry per
  // purchase order: a combined PO puts the same `po` on every member request, so
  // without this a PO whose members were each tallied would be listed once per
  // member, at the combined total each time. See `purchaseOrderKey`.
  const seenPo = new Set<string>();
  for (const pr of prs) {
    const r = coerceReconciliation(pr.reconciliation);
    if (!isReconciled(r) || r.aiVerified === true || !r.recordedAt) continue;
    if (r.recordedRole && EXCLUDED_ROLES.has(r.recordedRole)) continue;
    // A discrepancy that's been authorised (by the Payment Approver or an Admin)
    // is already handled — drop it.
    if (r.approval) continue;
    const key = purchaseOrderKey(pr.id, pr.po);
    if (seenPo.has(key)) continue;
    seenPo.add(key);
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

/**
 * Counts of items still awaiting reconciliation — the backlog shown beside
 * "Reconciled by hand" on the Production Dashboard. An item is counted ONLY when
 * it has had NO reconciliation of any kind: not reconciled by hand, by the AI
 * receipt reader (`aiVerified`), or by an Admin / Payment Approver — nor had its
 * discrepancy approved / settled. `firstPoId` / `firstVoucherId` are the ids the
 * dashboard tiles deep-link to (`/purchasing?req=` / `/cash-requests?id=`).
 */
/**
 * One item still awaiting reconciliation.
 *
 * Deliberately the same shape as {@link ManualReconRow} minus the `kind` badge —
 * the owner asked for these tiles to behave like "Reconciled by hand", and two
 * lists that look alike should be built from two rows that ARE alike. `detail`
 * carries who raised it and when, where the other list carries who tallied it.
 */
export interface UnreconciledRow {
  id: string;
  ref: string; // PO number or cash-voucher number
  title: string; // supplier (PO) or purpose (cash)
  amount: number;
  detail: string; // "Raised by Name · Aug 9, 2026, 6:27 PM"
  /** Newest first, and the tie-break the tile's deep link used to pick. */
  raisedAtISO: string;
  href: string;
}

const raisedLabel = (name?: string | null, at?: Date | null): string =>
  `Raised by ${name || "—"}${at ? ` · ${formatDateTime(at)}` : ""}`;

export async function getUnreconciledCounts(): Promise<{
  pos: number;
  vouchers: number;
  /** The items behind `pos` — the tile expands these in place. */
  poRows: UnreconciledRow[];
  /** The items behind `vouchers`. */
  voucherRows: UnreconciledRow[];
}> {
  const [prs, crs] = await Promise.all([
    prisma.purchaseRequest.findMany({ select: { id: true, status: true, po: true, reconciliation: true, createdByName: true, createdAt: true } }).catch(() => []),
    prisma.cashRequest.findMany({ select: { id: true, number: true, purpose: true, status: true, amount: true, liquidation: true, requestedByName: true, createdAt: true } }).catch(() => []),
  ]);

  // The counting rules below are UNCHANGED. The tiles now list what they count,
  // and a tile whose number disagreed with its own list would be worse than one
  // that only ever showed a number — so the rows are pushed from inside the very
  // same loop, after the very same guards, rather than recomputed alongside.
  /**
   * One entry per PURCHASE ORDER, not per request — see `purchaseOrderKey`.
   *
   * A combined PO is reconciled once, for the whole PO, and `recordReconciliation`
   * writes that record to a single member. So a PO counts as handled the moment
   * ANY of its members carries a reconciliation: `handled` remembers that even if
   * the reconciled member was visited after its unreconciled siblings, which is
   * the order they arrive in.
   */
  const byPo = new Map<string, UnreconciledRow & { members: number }>();
  const handled = new Set<string>();
  for (const pr of prs) {
    if (!canReconcileAt(pr.status as PRStatus)) continue;
    // Nothing purchased from a supplier (e.g. every line issued from stock) →
    // there's no PO spend to reconcile.
    const po = coercePurchaseOrder(pr.po);
    if (!po || poTotals(po).net <= 0) continue;
    const key = purchaseOrderKey(pr.id, pr.po);
    const r = coerceReconciliation(pr.reconciliation);
    // Handled by ANY method → not part of the backlog, and not for any sibling
    // of this PO either.
    if (isReconciled(r) || r.recordedAt || r.aiVerified === true || r.approval || r.settled) {
      handled.add(key);
      continue;
    }
    const prev = byPo.get(key);
    if (prev) {
      prev.members += 1;
      // Keep the OLDEST raise date: a backlog entry's age is how long the need
      // has been waiting, which is the first request on the PO, not the last.
      if (pr.createdAt && pr.createdAt.toISOString() < prev.raisedAtISO) {
        prev.detail = raisedLabel(pr.createdByName, pr.createdAt);
        prev.raisedAtISO = pr.createdAt.toISOString();
      }
      continue;
    }
    byPo.set(key, {
      id: `pr-${pr.id}`,
      ref: po.poNumber || "—",
      title: po.supplier?.company || "",
      amount: poTotals(po).net,
      detail: raisedLabel(pr.createdByName, pr.createdAt),
      raisedAtISO: pr.createdAt?.toISOString() ?? "",
      href: `/purchasing?req=${pr.id}`,
      members: 1,
    });
  }
  const poRows: UnreconciledRow[] = [...byPo.entries()]
    .filter(([key]) => !handled.has(key))
    .map(([, row]) => {
      const { members, ...r } = row;
      // Say so when one row stands for several requests, rather than leaving the
      // combined total looking like it belongs to the one request behind the link.
      return members > 1 ? { ...r, detail: `${r.detail} · ${members} requests on this PO` } : r;
    });

  const voucherRows: UnreconciledRow[] = [];
  for (const cr of crs) {
    if (!canLiquidateAt(cr.status as CashRequestStatus)) continue;
    if (Number(cr.amount) <= 0) continue; // no cash released → nothing to liquidate
    const l = coerceLiquidation(cr.liquidation);
    if (isLiquidated(l) || l.recordedAt || l.aiVerified === true || l.approval || l.settled || l.adminTally) continue;
    voucherRows.push({
      id: `cr-${cr.id}`,
      ref: cr.number,
      title: cr.purpose || "",
      amount: Number(cr.amount) || 0,
      detail: raisedLabel(cr.requestedByName, cr.createdAt),
      raisedAtISO: cr.createdAt?.toISOString() ?? "",
      href: `/cash-requests?id=${cr.id}`,
    });
  }

  // Newest first, like the hand-tallied list.
  const newestFirst = (a: UnreconciledRow, b: UnreconciledRow) => b.raisedAtISO.localeCompare(a.raisedAtISO);
  poRows.sort(newestFirst);
  voucherRows.sort(newestFirst);

  return { pos: poRows.length, vouchers: voucherRows.length, poRows, voucherRows };
}
