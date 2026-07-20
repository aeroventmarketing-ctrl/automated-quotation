/**
 * Supplier returns for a purchase request. When items in a PO fail inspection
 * (quality or any other reason) the inspector records a return here; the item
 * goes back to the supplier for replacement. A PO can't be received into stock
 * while any return is still unresolved (awaiting the replacement).
 *
 * Returns ride in the PurchaseRequest.returns JSON column (array). For a combined
 * PO they attach to the anchor request — the whole PO.
 */
import type { PRStatus } from "@/lib/purchasing";

export interface PurchaseReturn {
  id: string;
  items: string; // free text: which item(s) + quantity being returned
  reason: string; // why it was disapproved (quality / wrong item / damaged / …)
  raisedByName: string;
  raisedRole: string; // designation the return was raised in
  raisedAt: string; // ISO
  resolvedByName?: string;
  resolvedRole?: string;
  resolvedAt?: string; // ISO — replacement received / return settled
  resolutionNote?: string;
}

export function coercePurchaseReturns(v: unknown): PurchaseReturn[] {
  if (!Array.isArray(v)) return [];
  const out: PurchaseReturn[] = [];
  for (const e of v) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string") continue;
    out.push({
      id: o.id,
      items: typeof o.items === "string" ? o.items : "",
      reason: typeof o.reason === "string" ? o.reason : "",
      raisedByName: typeof o.raisedByName === "string" ? o.raisedByName : "",
      raisedRole: typeof o.raisedRole === "string" ? o.raisedRole : "",
      raisedAt: typeof o.raisedAt === "string" ? o.raisedAt : "",
      resolvedByName: typeof o.resolvedByName === "string" ? o.resolvedByName : undefined,
      resolvedRole: typeof o.resolvedRole === "string" ? o.resolvedRole : undefined,
      resolvedAt: typeof o.resolvedAt === "string" ? o.resolvedAt : undefined,
      resolutionNote: typeof o.resolutionNote === "string" ? o.resolutionNote : undefined,
    });
  }
  return out;
}

/** True once at least one return is still awaiting its replacement. */
export function hasUnresolvedReturn(returns: PurchaseReturn[]): boolean {
  return returns.some((r) => !r.resolvedAt);
}

/**
 * A return can be raised only after the items exist to inspect — from the
 * purchaser's check through the plant manager's final approval, and while the
 * items are in transit for approval.
 */
const RETURNABLE_STATUSES: PRStatus[] = ["PURCHASED", "CHECKED", "DELIVERED", "RECEIVED", "PLANT_APPROVED"];
export function canRaiseReturnAt(status: PRStatus): boolean {
  return RETURNABLE_STATUSES.includes(status);
}
