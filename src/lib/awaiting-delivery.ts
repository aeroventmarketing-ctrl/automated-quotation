/**
 * Bought stock that is in the inventory but **not usable yet**.
 *
 * The owner: *"once I pressed the Cash & Check Released button purchased item
 * will be added to inventory but warehouseman should press the Receive & Add to
 * stock button to confirm the delivery of the item"* — chose to add it to stock
 * straight away (Option B), with *"a message in the bought and added item that it
 * can only be usable once warehouseman press the received … button. By this
 * everyone will see the notification and can notify the warehouseman."*
 * Clarified:
 *  - It becomes usable on the Warehouseman's **Receive & Add Stock**.
 *  - A **short delivery** leaves the missing quantity in stock, still not usable,
 *    until the rest arrives and is confirmed.
 *  - A line with **no inventory item carrying its SKU** is added on Receive, as
 *    before.
 *  - Until confirmed it is kept out of **MRF issue / release, counter sales,
 *    Check availability and the Purchasing covered-by-stock rule**.
 *
 * ## How: a reservation, tagged with the PO
 *
 * Every "free to use" figure in the app is already *on hand − active
 * reservations*, and every place that hands stock out reads it. So the bought
 * quantity is added to on hand AND held by an active reservation whose `forRef`
 * names the PO with {@link AWAITING_SUFFIX}. Nothing new for the database, and no
 * screen that counts free stock can count it by mistake. The Warehouseman's
 * Receive releases the hold (rather than adding stock a second time).
 */
import { unitsComparable } from "@/lib/stock-covered";
import { parseIssuedFromStockLine, poLineFromPRItem, stripToPurchasePrefix } from "@/lib/purchase-order";
import { stockRowsForLine } from "@/lib/stock-line-match";
import { pickIssueRow } from "@/lib/stock-location";

export const AWAITING_SUFFIX = " · awaiting delivery confirmation";
export const AWAITING_NOTE = "Bought — added at Cash & Check Released. Not usable until the Warehouseman presses Receive & Add Stock.";
/** Stamped on a hold a short delivery left behind (the PO is already received). */
export const SHORT_DELIVERY_MARK = "Short delivery:";
export const isShortDeliveryLeftover = (note: string | null | undefined): boolean => String(note ?? "").includes(SHORT_DELIVERY_MARK);

/** The reservation's "for" text: "PO-AFBM20260001114 · awaiting delivery confirmation". */
export const awaitingRef = (poRef: string) => `${poRef.trim()}${AWAITING_SUFFIX}`;
export const isAwaitingRef = (forRef: string | null | undefined): boolean => String(forRef ?? "").endsWith(AWAITING_SUFFIX);
/** "PO-AFBM20260001114" back out of the reservation's "for" text. */
export const poRefOfAwaiting = (forRef: string): string => (isAwaitingRef(forRef) ? forRef.slice(0, -AWAITING_SUFFIX.length) : forRef);

/** The words on the item: "10 pc not usable yet — awaiting the Warehouseman's Receive & Add Stock (PO-…)". */
export function awaitingMessage(qty: number, unit: string, poRefs: string[]): string {
  const n = String(Math.round(qty * 1000) / 1000);
  const refs = [...new Set(poRefs)].join(", ");
  return `${n}${unit ? ` ${unit}` : ""} not usable yet — awaiting the Warehouseman's Receive & Add Stock${refs ? ` (${refs})` : ""}`;
}

// --- Cash & Check Released: what goes into stock --------------------------------

export interface CashReleaseLine {
  description: string;
  qty: string | number;
  unit: string;
  sku?: string | null;
}
export interface CashReleaseMember {
  items: string[];
  skus: readonly string[];
  dept: string | null;
  /** Never received into stock (an Office bought-in requisition goes to the client). */
  skip: boolean;
}
export interface CashReleaseStock {
  id: string;
  sku: string | null;
  unit: string;
  location: string | null;
}
export interface CashReleaseAdd {
  stockItemId: string;
  qty: number;
  /** The PO lines it came from, for the ledger. */
  lines: string[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Which PO lines go into stock now, and where. A line is added only when it is
 * certain: its SKU (recorded on the line, or on the request line it was drafted
 * from) is carried by an inventory item, the units agree, and its quantity
 * reads. Anything else waits for the Warehouseman's Receive, as today.
 */
export function planCashReleaseAdds(lines: readonly CashReleaseLine[], members: readonly CashReleaseMember[], stock: readonly CashReleaseStock[]): CashReleaseAdd[] {
  // Request line description → its SKU and request, for lines the PO doesn't carry a code on.
  const byDesc = new Map<string, { sku: string; member: CashReleaseMember }>();
  const memberOfDesc = new Map<string, CashReleaseMember>();
  for (const m of members) {
    m.items.forEach((it, i) => {
      if (parseIssuedFromStockLine(it)) return;
      const d = norm(poLineFromPRItem(stripToPurchasePrefix(it)).description);
      if (!d) return;
      if (!memberOfDesc.has(d)) memberOfDesc.set(d, m);
      const sku = (m.skus[i] ?? "").trim();
      if (sku && !byDesc.has(d)) byDesc.set(d, { sku, member: m });
    });
  }
  const out = new Map<string, CashReleaseAdd>();
  for (const l of lines) {
    const qty = Number(l.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const d = norm(l.description);
    const member = memberOfDesc.get(d) ?? (members.length === 1 ? members[0] : undefined);
    if (member?.skip) continue;
    const sku = (l.sku ?? "").trim() || byDesc.get(d)?.sku || "";
    if (!sku) continue;
    const row = pickIssueRow(stockRowsForLine(sku, stock), member?.dept ?? null);
    if (!row) continue;
    if (!unitsComparable(l.unit, row.unit)) continue;
    const prev = out.get(row.id);
    if (prev) {
      prev.qty = Math.round((prev.qty + qty) * 1000) / 1000;
      prev.lines.push(l.description);
    } else out.set(row.id, { stockItemId: row.id, qty, lines: [l.description] });
  }
  return [...out.values()];
}

// --- Receive & Add Stock: confirming ---------------------------------------------

export interface AwaitingHold {
  id: string;
  stockItemId: string;
  qty: number;
  createdAt: Date | string;
}
export interface ConfirmPlan {
  /** What Receive still adds to stock — the part that was not already added at cash release. */
  adds: { stockItemId: string; qty: number }[];
  /** Holds fully confirmed — release them. */
  release: string[];
  /** Holds partly confirmed — keep, at this smaller quantity (the rest is still to arrive). */
  reduce: { id: string; to: number }[];
  /** Per item, how much became usable. */
  confirmed: { stockItemId: string; qty: number }[];
}

/**
 * The Warehouseman's Receive against this PO's holds. Whatever arrived for an
 * item with a hold first confirms the hold (oldest first) — it is already in
 * stock — and only the excess is added. What did not arrive stays held.
 */
export function planConfirm(matches: readonly { stockItemId: string; qty: number }[], holds: readonly AwaitingHold[]): ConfirmPlan {
  const at = (h: AwaitingHold) => new Date(h.createdAt).getTime();
  const left = new Map(holds.map((h) => [h.id, h.qty]));
  const byItem = new Map<string, AwaitingHold[]>();
  for (const h of [...holds].sort((a, b) => at(a) - at(b))) (byItem.get(h.stockItemId) ?? byItem.set(h.stockItemId, []).get(h.stockItemId)!).push(h);
  const adds = new Map<string, number>();
  const confirmed = new Map<string, number>();
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  for (const m of matches) {
    let q = Number(m.qty);
    if (!m.stockItemId || !Number.isFinite(q) || q <= 0) continue;
    for (const h of byItem.get(m.stockItemId) ?? []) {
      if (q <= 0) break;
      const hold = left.get(h.id) ?? 0;
      if (hold <= 0) continue;
      const take = Math.min(q, hold);
      left.set(h.id, r3(hold - take));
      q = r3(q - take);
      confirmed.set(m.stockItemId, r3((confirmed.get(m.stockItemId) ?? 0) + take));
    }
    if (q > 0) adds.set(m.stockItemId, r3((adds.get(m.stockItemId) ?? 0) + q));
  }
  const release: string[] = [];
  const reduce: { id: string; to: number }[] = [];
  for (const h of holds) {
    const l = left.get(h.id) ?? h.qty;
    if (l <= 0) release.push(h.id);
    else if (l < h.qty) reduce.push({ id: h.id, to: l });
  }
  return {
    adds: [...adds].map(([stockItemId, qty]) => ({ stockItemId, qty })),
    release,
    reduce,
    confirmed: [...confirmed].map(([stockItemId, qty]) => ({ stockItemId, qty })),
  };
}

