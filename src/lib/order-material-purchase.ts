/**
 * "Total Material Purchase" — what has been committed to buy for one client
 * order, shown in the order's Phase 1 box.
 *
 * The owner: *"Put a word 'Total Material Purchase' which shows the total amount
 * of materials purchased specific to that client order."* Their answers to how:
 *
 *  - **Which POs:** approved and budgeted — every PO on the order once it sits in
 *    Purchasing's Approved or Budgeted tab, through bought and received
 *    (`statusBucket` "approved", COMPLETED included). Pending, rejected and
 *    cancelled ones don't count.
 *  - **Which amount:** the PO total as printed (VAT-inclusive), before EWT.
 *  - **A combined PO** that also covers other orders' requests counts only this
 *    order's lines, at the PO's prices. When every request on it is this
 *    order's, the whole PO counts — once.
 *  - **Who sees it:** admin and the Payment Approver (decided on the page).
 *
 * Pure: the page passes the order's own purchase requests.
 */
import { statusBucket, isDeptRequisition, isPoApproved, type PRStatus } from "@/lib/purchasing";
import { coercePurchaseOrder, poLinesFromPRItems, poTotals, poLineAmount, type POLine } from "@/lib/purchase-order";
import { poBatchId, poMemberIds } from "@/lib/purchase-batch";
import { round2 } from "@/lib/quote";

export interface OrderPurchaseRequest {
  id: string;
  status: string;
  kind?: string | null;
  mrfId?: string | null;
  chainLog?: unknown;
  items?: unknown;
  itemSkus?: unknown;
  po?: unknown;
}

/** In Purchasing's Approved or Budgeted tab (or finished): its PO is committed. */
export const isCommittedPurchase = (pr: OrderPurchaseRequest): boolean =>
  statusBucket(pr.status as PRStatus, { isDept: isDeptRequisition(pr), poApproved: isPoApproved(pr.chainLog) }) === "approved";

const key = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * One request's share of a combined PO: each line it asked for, at the price the
 * PO puts on that product (matched by SKU, else by description), times the
 * quantity it asked for. A line the PO no longer carries (removed or renamed in
 * an edit) adds nothing.
 */
export function memberShare(pr: OrderPurchaseRequest, poLines: readonly POLine[]): number {
  const items = Array.isArray(pr.items) ? (pr.items as unknown[]).map(String) : [];
  const skus = Array.isArray(pr.itemSkus) ? (pr.itemSkus as unknown[]).map((v) => String(v ?? "")) : null;
  let sum = 0;
  for (const mine of poLinesFromPRItems(items, skus)) {
    const hit =
      (mine.sku && poLines.find((l) => l.sku && l.sku === mine.sku)) ||
      poLines.find((l) => key(l.description) === key(mine.description));
    if (hit) sum += poLineAmount({ ...mine, unitPrice: hit.unitPrice });
  }
  return round2(sum);
}

export interface OrderMaterialPurchase {
  total: number;
  /** Distinct POs counted. */
  poCount: number;
}

export function orderMaterialPurchase(prs: readonly OrderPurchaseRequest[]): OrderMaterialPurchase {
  const mine = new Set(prs.map((p) => p.id));
  const seenBatch = new Set<string>();
  let total = 0;
  let poCount = 0;
  for (const pr of prs) {
    if (!isCommittedPurchase(pr)) continue;
    const po = coercePurchaseOrder(pr.po);
    if (!po) continue;
    const batch = poBatchId(pr.po);
    const members = poMemberIds(pr.po);
    if (!batch || members.length === 0) {
      total += poTotals(po).total;
      poCount += 1;
      continue;
    }
    // A combined PO: wholly this order's → count it once; shared with other
    // orders → each of this order's requests counts its own lines.
    if (members.every((id) => mine.has(id))) {
      if (seenBatch.has(batch)) continue;
      seenBatch.add(batch);
      total += poTotals(po).total;
    } else {
      total += memberShare(pr, po.lines);
      if (seenBatch.has(batch)) continue;
      seenBatch.add(batch);
    }
    poCount += 1;
  }
  return { total: round2(total), poCount };
}
