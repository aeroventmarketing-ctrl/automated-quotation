/**
 * Stock movement history — where each item went, when, and who moved it.
 *
 * The owner, on the Inventory tab: *"Add stock movement history, where and when
 * the item go, when it was added and deducted, who edited and other important
 * details for monitoring."*
 *
 * The movement ledger (`StockMovement`) has been written by every stock change
 * from the start — receipts, MRF issues, order releases, counter sales,
 * transfers, adjustments — with the quantity, the balance after, who and why.
 * The "why" is a sentence each writer composes; this reads it back into a type
 * and a destination ("where it went") the history can filter and show.
 */

export type MovementCategory = "in" | "out" | "transfer" | "adjust";

export const MOVEMENT_CATEGORY_LABEL: Record<MovementCategory, string> = {
  in: "Added",
  out: "Deducted",
  transfer: "Transfer",
  adjust: "Adjustment",
};

export interface MovementClass {
  category: MovementCategory;
  /** What happened, e.g. "Purchase received", "Issued on MRF". */
  label: string;
  /** Where it went / came from, as far as the ledger says. */
  where: string | null;
  mrfNo?: string;
  orderNo?: string;
  saleNo?: string;
  /** A received purchase — its PO is matched in by time (`stock-history-data`). */
  purchase?: boolean;
  /** What the person typed, if anything — the rest of the reason is the system's own wording. */
  note?: string;
}

/** Read a ledger row's kind + reason into a type and a destination. */
export function classifyMovement(kind: string, delta: number, reason: string | null | undefined): MovementClass {
  const r = (reason ?? "").trim();
  let m: RegExpMatchArray | null;

  if (/^Purchase received/i.test(r)) {
    return { category: "in", label: "Purchase received", where: /combined/i.test(r) ? "From supplier (combined PO)" : "From supplier", purchase: true };
  }
  if (/^Reorder received/i.test(r)) return { category: "in", label: "Reorder received", where: "From supplier (reorder)" };

  if ((m = r.match(/^MRF #(\S+)(?: released to (.+))?$/i))) {
    return { category: "out", label: m[2] ? "Released on MRF" : "Issued on MRF", where: m[2] ? m[2] : "Production (MRF)", mrfNo: m[1] };
  }
  if ((m = r.match(/^Order (.+?) released from stock$/i))) {
    return { category: "out", label: "Released for order", where: `Client order ${m[1]}`, orderNo: m[1] };
  }
  if ((m = r.match(/^Requisition · (.+)$/i))) return { category: "out", label: "Issued on requisition", where: m[1] };

  if ((m = r.match(/^(Void|Edit|Delete) counter sale\s*(.*)$/i))) {
    const verb = m[1].toLowerCase() === "void" ? "voided" : m[1].toLowerCase() === "delete" ? "deleted" : "edited";
    return { category: "in", label: `Returned — counter sale ${verb}`, where: "Back from counter sale", ...(m[2] ? { saleNo: m[2] } : {}) };
  }
  if ((m = r.match(/^Counter sale\s*(\S*)/i))) {
    return { category: "out", label: "Counter sale", where: "Customer (counter sale)", ...(m[1] ? { saleNo: m[1] } : {}) };
  }

  if ((m = r.match(/^Transfer to (.+?) cancelled — returned$/i))) {
    return { category: "transfer", label: "Transfer cancelled — returned", where: `Back from ${m[1]}` };
  }
  if ((m = r.match(/^Transfer to (.+?) \(in transit\)(?: · (.+))?$/i))) {
    return { category: "transfer", label: "Transfer out", where: `To ${m[1]}`, ...(m[2] ? { note: m[2] } : {}) };
  }
  if (/^Office transfer released/i.test(r)) return { category: "transfer", label: "Transfer out", where: "To Office (in transit)" };
  if ((m = r.match(/^(?:Office )?Transfer received from (.+)$/i))) return { category: "transfer", label: "Transfer in", where: `From ${m[1]}` };

  if (/^Opening balance/i.test(r)) return { category: "adjust", label: /import/i.test(r) ? "Opening balance (import)" : "Opening balance", where: null };
  if (/^Bulk import update/i.test(r)) return { category: "adjust", label: "Count set by import", where: null };
  if (/^Set on the item list/i.test(r)) return { category: "adjust", label: "On hand set (Edit)", where: null };

  // A receive / issue / adjust typed in on Inventory: the reason is the person's own.
  const note = r ? { note: r } : {};
  if (kind === "RECEIPT") return { category: "in", label: "Received", where: null, ...note };
  if (kind === "ISSUE") return { category: "out", label: "Issued", where: null, ...note };
  return { category: "adjust", label: delta > 0 ? "Count adjusted up" : delta < 0 ? "Count adjusted down" : "Count checked — no change", where: null, ...note };
}

/**
 * Which received purchase a "Purchase received" row belongs to. The ledger row
 * and the purchase request's `receivedAt` are written in the same transaction by
 * the same person, so the closest receipt by that person within a minute is it.
 */
export function matchPurchaseReceipt<T extends { receivedAt: Date | string; receivedByName: string | null }>(
  at: Date | string,
  byName: string,
  receipts: T[],
  windowMs = 60_000,
): T | null {
  const t = new Date(at).getTime();
  let best: T | null = null;
  let bestGap = Infinity;
  for (const r of receipts) {
    if ((r.receivedByName ?? "") !== byName) continue;
    const gap = Math.abs(new Date(r.receivedAt).getTime() - t);
    if (gap <= windowMs && gap < bestGap) {
      best = r;
      bestGap = gap;
    }
  }
  return best;
}
