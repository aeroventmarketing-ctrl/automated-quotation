/**
 * A supplier price change in Products, carried into the Inventory item.
 *
 * The owner, on an item's Price movements tab: *"price movement is not updating
 * when I approve the price change"* — and asked for the change to be listed
 * there as a supplier price row, with the item's **unit cost set to the highest
 * supplier price after the change** (MS PLATE 3/16": TKL ₱3,865, Metal Exponent
 * ₱3,800 → unit cost ₱3,865).
 *
 * Products and Inventory are joined by name, as the PO price catalogue joins
 * them (`lib/po-price-catalog`). The selling price is left alone — it is the
 * owner's own figure, not a supplier's.
 */
import type { ProductSupplierLink } from "@/lib/products";

export interface SupplierPriceMove {
  company: string;
  /** Null: the supplier wasn't listed (or had no price) before. */
  from: number | null;
  /** Null: the supplier was removed, or its price cleared. */
  to: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const key = (company: string) => company.trim().toLowerCase();
const priced = (p: number | undefined | null): number | null => (p != null && Number.isFinite(p) && p > 0 ? round2(p) : null);

/** The products ↔ inventory join key: the name, trimmed, any case. */
export const catalogueNameKey = (name: string) => name.trim().toLowerCase();

/** Which suppliers' prices moved, in the order they're listed after the change (removed ones last). */
export function supplierPriceMoves(before: ProductSupplierLink[], after: ProductSupplierLink[]): SupplierPriceMove[] {
  const was = new Map<string, number | null>();
  for (const s of before) if (!was.has(key(s.company))) was.set(key(s.company), priced(s.price));
  const out: SupplierPriceMove[] = [];
  const seen = new Set<string>();
  for (const s of after) {
    const k = key(s.company);
    if (seen.has(k)) continue;
    seen.add(k);
    const from = was.get(k) ?? null;
    const to = priced(s.price);
    if (from !== to) out.push({ company: s.company.trim(), from, to });
  }
  for (const s of before) {
    const k = key(s.company);
    if (seen.has(k)) continue;
    seen.add(k);
    const from = priced(s.price);
    if (from != null) out.push({ company: s.company.trim(), from, to: null });
  }
  return out;
}

/** The highest supplier price on the list; null when none is priced. */
export function highestSupplierPrice(suppliers: ProductSupplierLink[]): number | null {
  let best: number | null = null;
  for (const s of suppliers) {
    const p = priced(s.price);
    if (p != null && (best == null || p > best)) best = p;
  }
  return best;
}

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** "TKL Steel ₱3,800 → ₱3,865" / "Acme (new) ₱120" / "Acme removed (was ₱120)". */
export function describeMove(m: SupplierPriceMove): string {
  if (m.from == null && m.to != null) return `${m.company} (new) ${peso(m.to)}`;
  if (m.to == null && m.from != null) return `${m.company} removed (was ${peso(m.from)})`;
  return `${m.company} ${peso(m.from ?? 0)} → ${peso(m.to ?? 0)}`;
}

/**
 * Units agree enough for a supplier's per-unit price to be the item's unit cost.
 * Blank counts as the default "pcs" on both sides.
 */
export function unitsAgree(productUnit: string | null | undefined, stockUnit: string | null | undefined): boolean {
  const u = (s: string | null | undefined) => (s ?? "").trim().toLowerCase() || "pcs";
  return u(productUnit) === u(stockUnit);
}

export interface StockCostPlan {
  /** The unit cost to set; null = leave the item's unit cost as it is. */
  newUnitCost: number | null;
  /** The note on the price-movement row. */
  note: string;
}

/**
 * What the approval does to one inventory item: the unit cost it gets, and the
 * note the price-movement row carries. Null when no supplier price moved —
 * a rename or a note edit isn't a price movement.
 */
export function planStockCost(
  item: { unit: string; unitCost: number },
  product: { unit: string },
  before: ProductSupplierLink[],
  after: ProductSupplierLink[],
): StockCostPlan | null {
  const moves = supplierPriceMoves(before, after);
  if (moves.length === 0) return null;
  const parts = [`Supplier price: ${moves.map(describeMove).join("; ")}`];
  const high = highestSupplierPrice(after);
  let newUnitCost: number | null = null;
  if (high == null) {
    parts.push("no supplier priced — unit cost kept");
  } else if (!unitsAgree(product.unit, item.unit)) {
    parts.push(`unit cost kept — Products prices per ${product.unit || "pcs"}, Inventory counts in ${item.unit || "pcs"}`);
  } else {
    newUnitCost = high;
    parts.push(round2(item.unitCost) === high ? `unit cost already the highest (${peso(high)})` : `unit cost = highest supplier price (${peso(high)})`);
  }
  return { newUnitCost, note: parts.join(" · ") };
}
