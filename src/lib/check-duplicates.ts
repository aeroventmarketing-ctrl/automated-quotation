/**
 * "Is this check already recorded somewhere else?" — asked per PURCHASE ORDER,
 * not per purchase-request row.
 *
 * The owner, on a PO whose check carried the warning: *"check the error Check
 * No. 0000486718 is already recorded on another purchase order."*
 *
 * Two things made that question answer wrong, and a third made it impossible to
 * check:
 *
 *  - **A combined PO is several PurchaseRequest rows sharing one PO number.**
 *    `purchase-batch.ts` says it outright: *"every member PurchaseRequest carries
 *    the SAME `po` JSON (with the combined lines and one PO number)"*. The old
 *    test compared row against row, so one check attached to two members of ONE
 *    combined PO reported itself as a duplicate of itself.
 *  - **Cancelled and rejected requests still counted.** No money moves on those.
 *    A PO that was cancelled and re-raised with the same check is one payment,
 *    and being told otherwise sends someone looking for a second one.
 *  - **The message never said WHICH PO**, so nobody could go and look.
 *
 * The unit here is therefore the purchase order: its batch id when it is a
 * combined PO, else its PO number, else the row's own id for a request that has
 * no PO yet.
 */
import { normalizeCheckNo } from "@/lib/voucher-check";

/** What this needs from a purchase request — a subset, so callers select narrowly. */
export interface CheckHolder {
  id: string;
  /** The PO's number, when one has been prepared. */
  poNumber: string | null;
  /** The combined-PO batch id, when this row is part of one. */
  batchId: string | null;
  /** PR status — CANCELLED / REJECTED rows are not competing records. */
  status: string;
  /** Check numbers read off this row's photos, exactly as read. */
  checkNos: string[];
}

/** A PO that never happened is not another record of the payment. */
const DEAD: ReadonlySet<string> = new Set(["CANCELLED", "REJECTED"]);

/**
 * What identifies the PURCHASE ORDER a row belongs to.
 *
 * The batch id first: it is the only thing that holds a combined PO's members
 * together, and it is what stops one check on two members reading as two POs.
 */
export function purchaseOrderKey(row: Pick<CheckHolder, "id" | "poNumber" | "batchId">): string {
  return row.batchId ? `batch:${row.batchId}` : row.poNumber ? `po:${row.poNumber.trim().toLowerCase()}` : `pr:${row.id}`;
}

/** How a PO is NAMED in the warning, so the reader can go and open it. */
const label = (row: CheckHolder): string => row.poNumber?.trim() || "a purchase order with no PO number yet";

/**
 * Every OTHER purchase order carrying this check number, named.
 *
 * Empty when there is no genuine duplicate — including when the only other
 * holders are rows of the same combined PO, or requests that were cancelled or
 * rejected.
 *
 * Deduplicated and sorted so the message is stable: the same facts must not
 * produce two different sentences depending on row order.
 */
export function otherPurchaseOrdersWithCheck(
  checkNo: string | null | undefined,
  mine: Pick<CheckHolder, "id" | "poNumber" | "batchId">,
  rows: readonly CheckHolder[],
): string[] {
  const wanted = normalizeCheckNo(String(checkNo ?? ""));
  if (!wanted) return [];
  const mineKey = purchaseOrderKey(mine);
  const names = new Set<string>();
  for (const row of rows) {
    if (DEAD.has(row.status)) continue;
    if (purchaseOrderKey(row) === mineKey) continue;
    if (!row.checkNos.some((n) => normalizeCheckNo(n) === wanted)) continue;
    names.add(label(row));
  }
  return [...names].sort();
}
