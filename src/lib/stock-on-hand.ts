/**
 * How many of a requested item the warehouse actually has.
 *
 * The owner, on the Purchasing workspace: *"In purchasing pending and approved
 * tab, show the available quantity in each row. Get the details in inventory
 * tab. For example if Induction Motor 5.5HP, 3PH or SKU CAT00182 show 0 in stock
 * if no stock is available or 2 in stock if 2 items is available."*
 *
 * The page already loads the inventory (`listStockItemsWithAvailability`) — it
 * hands it to the receive/issue panels — so this is a join over two lists that
 * are both already in memory, not a new read.
 *
 * ## What "available" means
 *
 * On hand **minus active reservations**: what could be issued this minute. A
 * purchaser deciding whether to buy wants the free quantity, not a total that
 * includes units already promised to another job.
 *
 * ## Matching
 *
 * By **item code first**, then by name. The code is the line's recorded
 * identity — `PurchaseRequest.itemSkus`, written when the line was composed and
 * its description was still clean — and an exact code beats any name similarity.
 * The name pass reuses `skuNameCandidates`, the same peeling the SKU chip uses,
 * so a line and its own code agree about which item they are.
 *
 * Quantities **sum across locations**: the same bolt in Plant and Office stock is
 * one answer to "how many do we have", and the row has no room to say where.
 */
import { normalizeItemName, skuNameCandidates } from "./item-sku";

/**
 * Structural, like `SkuSource` — any narrowed inventory list a screen already
 * holds (`StockOpt`, `StockOptWithAvail`, a two-column `select`) fits without a
 * conversion step.
 */
export interface StockLevelSource {
  name: string;
  sku?: string | null;
  unit?: string | null;
  /** Free to issue (on hand − active reservations). Absent ⇒ unknown, not zero. */
  available?: number | null;
}

/** What one item adds up to across every location that carries it. */
export interface OnHand {
  available: number;
  unit: string;
  /** How many stock records were summed — >1 means more than one location. */
  places: number;
}

/** Code → quantity and name → quantity. Build it with {@link buildOnHandIndex}. */
export interface OnHandIndex {
  byCode: ReadonlyMap<string, OnHand>;
  byName: ReadonlyMap<string, OnHand>;
}

export const EMPTY_ON_HAND_INDEX: OnHandIndex = { byCode: new Map(), byName: new Map() };

const normCode = (s: string | null | undefined): string => String(s ?? "").trim().toUpperCase();

export function buildOnHandIndex(stock: readonly StockLevelSource[]): OnHandIndex {
  const byCode = new Map<string, OnHand>();
  const byName = new Map<string, OnHand>();
  const add = (map: Map<string, OnHand>, key: string, qty: number, unit: string) => {
    if (!key) return;
    const prev = map.get(key);
    if (prev) {
      prev.available = Math.round((prev.available + qty) * 1000) / 1000;
      prev.places += 1;
      // Keep the first non-empty unit: the bins agree in practice, and a blank
      // one on a second location should not erase the one we can show.
      if (!prev.unit) prev.unit = unit;
      return;
    }
    map.set(key, { available: qty, unit, places: 1 });
  };
  for (const s of stock) {
    // An item whose availability was not computed is UNKNOWN, and unknown must
    // not be summed in as zero — that would read as "we have none of it".
    if (s.available == null || !Number.isFinite(Number(s.available))) continue;
    const qty = Number(s.available);
    const unit = String(s.unit ?? "").trim();
    add(byCode, normCode(s.sku), qty, unit);
    add(byName, normalizeItemName(s.name), qty, unit);
  }
  return { byCode, byName };
}

/**
 * What the warehouse holds for one request line, or **null** when no inventory
 * item answers to it.
 *
 * Null is not zero, and the caller must keep them apart: zero means the item is
 * on the shelf list with none left; null means nothing on that list is this
 * item, which is a different fact and an honest one to show as such.
 */
export function onHandFor(
  description: string | null | undefined,
  code: string | null | undefined,
  index: OnHandIndex,
): OnHand | null {
  const byCode = index.byCode.get(normCode(code));
  if (byCode) return byCode;
  for (const name of skuNameCandidates(description)) {
    const hit = index.byName.get(normalizeItemName(name));
    if (hit) return hit;
  }
  return null;
}
