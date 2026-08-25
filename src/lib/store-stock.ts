/**
 * Storefront ⇄ inventory link (Phase B5).
 *
 * A store product is a `CatalogueItem`; the thing that actually ships is a
 * `StockItem`. They're joined on the shared **Item Code**: the catalogue's
 * `modelCode` against the stock item's `sku` — the same "Item Listing Standard"
 * the MRF stock matcher uses — falling back to an exact name match.
 *
 * Used for two things:
 *  - the storefront's availability (don't sell what we can't ship);
 *  - the ERP handoff, so a counter-sale line carries a `stockItemId` and the
 *    warehouse can issue it through the normal flow.
 *
 * A product with NO matching stock item is "not tracked" (`null`), which is
 * deliberately treated as sellable — a resale item that's drop-shipped or not
 * yet in the ledger must not be blocked by a missing inventory row.
 *
 * When the same code exists in several locations (see migration 0045),
 * availability is SUMMED and the fullest row is the one offered for issuing.
 */
import { listStockItemsWithAvailability, type StockOptWithAvail } from "@/lib/inventory";

export interface StoreStockInfo {
  stockItemId: string;
  /** Total free-to-issue across every location holding this code. */
  available: number;
  /** Location of the fullest row — where it would be issued from. */
  location: string | null;
}

/** Canonical form for code/name comparison (alphanumerics only). */
const canon = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

/** Stock rows matching one catalogue item, by Item Code first then exact name. */
function matchRows(rows: StockOptWithAvail[], modelCode: string, name: string): StockOptWithAvail[] {
  const code = canon(modelCode);
  const byCode = code ? rows.filter((s) => s.sku && canon(s.sku) === code) : [];
  if (byCode.length > 0) return byCode;
  const nm = canon(name);
  return nm ? rows.filter((s) => canon(s.name) === nm) : [];
}

/** Fold matched rows into one availability figure + the row to issue from. */
function fold(matched: StockOptWithAvail[]): StoreStockInfo | null {
  if (matched.length === 0) return null;
  const best = matched.reduce((a, b) => (b.available > a.available ? b : a));
  return {
    stockItemId: best.id,
    available: matched.reduce((sum, s) => sum + s.available, 0),
    location: best.location,
  };
}

/** One catalogue item's stock, or null when it isn't tracked in inventory. */
export async function stockForCatalogue(modelCode: string, name: string): Promise<StoreStockInfo | null> {
  const rows = await listStockItemsWithAvailability().catch(() => [] as StockOptWithAvail[]);
  return fold(matchRows(rows, modelCode, name));
}

/**
 * Stock for many catalogue items in ONE inventory read — keyed by `modelCode`.
 * A missing entry means the item isn't tracked (sellable, see the note above).
 */
export async function stockForCatalogueMany(
  entries: { modelCode: string; name: string }[],
): Promise<Map<string, StoreStockInfo>> {
  const rows = await listStockItemsWithAvailability().catch(() => [] as StockOptWithAvail[]);
  const out = new Map<string, StoreStockInfo>();
  for (const e of entries) {
    const info = fold(matchRows(rows, e.modelCode, e.name));
    if (info) out.set(e.modelCode, info);
  }
  return out;
}
