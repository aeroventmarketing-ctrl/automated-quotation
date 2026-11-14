/**
 * A request line the warehouse can already cover — left off the purchase order.
 *
 * The owner, on Purchasing · Approved: *"if requested number of item is greater
 * or equal in available stock in inventory, show the row so it can be purchased
 * or included in purchase order. If requested number of item is lesser than the
 * available stock in inventory, remove the row so it will not be included in the
 * purchase order."* Clarified:
 *  - **Hide, auto-return.** The line stays on the request, greyed as "Covered by
 *    stock — not purchased", and is left out of the PO the form drafts. Nothing
 *    is deleted: when free stock falls to the requested quantity or below, the
 *    line is purchasable again on its own.
 *  - A line that stays is bought at its **full requested quantity**.
 *  - Measured against **free stock** — on hand minus reservations, the "N in
 *    stock" figure the row already shows (`lib/stock-on-hand`, SKU match only).
 *  - Order MRFs, department requisitions, replenishment top-ups and combined POs.
 *
 * Covered means `requested < free`, strictly: equal stays purchasable, as the
 * owner put it ("greater or equal … show the row").
 *
 * Safe by default — a line is never hidden on a guess:
 *  - no inventory item answers to the line's SKU → purchasable;
 *  - the line's quantity can't be read (0 / blank) → purchasable;
 *  - the line and the stock count in different units (2 sheets vs 50 kg) →
 *    purchasable; the quantities aren't comparable.
 */
import { onHandFor, type OnHand, type OnHandIndex } from "@/lib/stock-on-hand";
import { parseIssuedFromStockLine, poLineFromPRItem, stripToPurchasePrefix } from "@/lib/purchase-order";

/** "pcs", "PC", "pc." → "pc"; "" stays "" (unknown). */
export function normUnit(u: string | null | undefined): string {
  const s = String(u ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!s) return "";
  return s.length > 2 && s.endsWith("s") && !s.endsWith("ss") ? s.slice(0, -1) : s;
}

/** The two units count the same thing — or one side doesn't say. */
export function unitsComparable(lineUnit: string | null | undefined, stockUnit: string | null | undefined): boolean {
  const a = normUnit(lineUnit);
  const b = normUnit(stockUnit);
  return !a || !b || a === b;
}

/** Is this line covered by free stock, so it should not be purchased? */
export function isCoveredByStock(requested: number, lineUnit: string | null | undefined, onHand: OnHand | null): boolean {
  if (!onHand) return false;
  if (!Number.isFinite(requested) || requested <= 0) return false;
  if (!unitsComparable(lineUnit, onHand.unit)) return false;
  return requested < onHand.available;
}

/**
 * Keep only the purchasable lines (and their SKUs, aligned by index). `covered`
 * is per line of `items`.
 */
export function withoutCovered(items: readonly string[], skus: readonly string[] | null | undefined, covered: readonly boolean[]): { items: string[]; skus: string[] } {
  const outItems: string[] = [];
  const outSkus: string[] = [];
  items.forEach((it, i) => {
    if (covered[i]) return;
    outItems.push(it);
    outSkus.push(skus?.[i] ?? "");
  });
  return { items: outItems, skus: outSkus };
}

/** The chip's wording: "Covered by stock — 12 pc free · not purchased". */
export function coveredLabel(onHand: OnHand): string {
  const n = Number.isInteger(onHand.available) ? String(onHand.available) : onHand.available.toFixed(2).replace(/\.?0+$/, "");
  return `Covered by stock — ${n}${onHand.unit ? ` ${onHand.unit}` : ""} free · not purchased`;
}

export interface LineCover {
  /** Per line of the request: left off the PO. */
  covered: boolean[];
  /** Per line: the free stock it was measured against (null: none found / not checked). */
  stock: (OnHand | null)[];
  /** Lines still to buy (not covered, not already issued from stock). */
  purchasable: number;
}

/**
 * Which lines of a request free stock covers. `codes` is the SKU per line — the
 * one the card prints (`effectiveLineSku`), so the rule and the chip agree.
 * Issued-from-stock records are never "covered": they aren't bought anyway.
 */
export function coverForItems(items: readonly string[], codes: readonly (string | null | undefined)[], index: OnHandIndex): LineCover {
  const covered: boolean[] = [];
  const stock: (OnHand | null)[] = [];
  let purchasable = 0;
  items.forEach((it, i) => {
    if (parseIssuedFromStockLine(it)) {
      covered.push(false);
      stock.push(null);
      return;
    }
    const pl = poLineFromPRItem(stripToPurchasePrefix(it));
    const on = onHandFor(pl.description, codes[i] ?? null, index);
    const c = isCoveredByStock(Number(pl.qty), pl.unit, on);
    covered.push(c);
    stock.push(on);
    if (!c) purchasable++;
  });
  return { covered, stock, purchasable };
}
