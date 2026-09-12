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
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { type StockOptWithAvail } from "@/lib/inventory";

export interface StoreStockInfo {
  stockItemId: string;
  /** Total free-to-issue across every location holding this code. */
  available: number;
  /** Location of the fullest row — where it would be issued from. */
  location: string | null;
}

/** Canonical form for code/name comparison (alphanumerics only). */
const canon = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Every canonical string that could possibly match one of these catalogue items.
 *
 * `matchRows` below matches a stock row on `canon(sku) === canon(modelCode)` or
 * `canon(name) === canon(name)`. Both are EQUALITY on a canonical form, so the
 * complete set of rows it can ever return is the rows whose canonical sku or
 * canonical name appears in this list — which is what lets Postgres do the
 * narrowing instead of shipping the whole inventory for JavaScript to sift.
 *
 * Exported for the test that pins exactly that: a row `matchRows` accepts must
 * always be one these keys would have fetched. If it ever were not, the store
 * would quietly show an out-of-stock item as sellable, because an unmatched
 * product is treated as "not tracked" and untracked means sellable.
 */
export function stockMatchKeys(entries: readonly { modelCode: string; name: string }[]): string[] {
  return [...new Set(entries.flatMap((e) => [canon(e.modelCode), canon(e.name)]).filter(Boolean))];
}

/** Stock rows matching one catalogue item, by Item Code first then exact name. */
export function matchRows(rows: StockOptWithAvail[], modelCode: string, name: string): StockOptWithAvail[] {
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

/**
 * The stock rows that could match these catalogue items — **not the whole
 * inventory.**
 *
 * This used to be `listStockItemsWithAvailability()`: every active `StockItem`
 * plus a reservation groupBy, shipped to Node so `matchRows` could pick out the
 * few that correspond to listed products. In production that fingerprint
 * averaged **~1,024 rows per call** (143.7M rows over 140,315 calls), and it ran
 * on every storefront page view — a public, uncached page that `robots.ts`
 * opens to every crawler.
 *
 * The match is equality on a canonical form, so Postgres can do it. The
 * canonicalisation mirrors `canon` exactly — lowercase FIRST, then strip
 * everything outside `[a-z0-9]` — so the rows this returns are precisely the
 * rows `matchRows` could have chosen from. The JS matcher still runs, unchanged,
 * and still decides; this only stops the database from sending the rest.
 *
 * Fails the way the old read did: an error yields no rows, which reads as "not
 * tracked", which the storefront treats as sellable.
 */
async function candidateStock(entries: readonly { modelCode: string; name: string }[]): Promise<StockOptWithAvail[]> {
  const keys = stockMatchKeys(entries);
  if (keys.length === 0) return [];
  const rows = await prisma
    .$queryRaw<{ id: string; sku: string | null; name: string; unit: string; location: string | null; quantity: unknown }[]>`
      select "id", "sku", "name", "unit", "location", "quantity"
      from "StockItem"
      where "active"
        and (regexp_replace(lower(coalesce("sku", '')), '[^a-z0-9]', '', 'g') in (${Prisma.join(keys)})
          or regexp_replace(lower("name"), '[^a-z0-9]', '', 'g') in (${Prisma.join(keys)}))
    `
    .catch(() => []);
  if (rows.length === 0) return [];
  const resv = await prisma.stockReservation
    .groupBy({ by: ["stockItemId"], where: { active: true, stockItemId: { in: rows.map((r) => r.id) } }, _sum: { qty: true } })
    .catch(() => [] as { stockItemId: string; _sum: { qty: number | null } }[]);
  const reservedById = new Map(resv.map((r) => [r.stockItemId, Number(r._sum.qty ?? 0)]));
  return rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    name: r.name,
    unit: r.unit,
    location: r.location,
    // Same arithmetic and same rounding as `listStockItemsWithAvailability`.
    available: Math.round((Number(r.quantity) - (reservedById.get(r.id) ?? 0)) * 1000) / 1000,
  }));
}

/** One catalogue item's stock, or null when it isn't tracked in inventory. */
export async function stockForCatalogue(modelCode: string, name: string): Promise<StoreStockInfo | null> {
  const rows = await candidateStock([{ modelCode, name }]);
  return fold(matchRows(rows, modelCode, name));
}

/**
 * Stock for many catalogue items in ONE inventory read — keyed by `modelCode`.
 * A missing entry means the item isn't tracked (sellable, see the note above).
 */
export async function stockForCatalogueMany(
  entries: { modelCode: string; name: string }[],
): Promise<Map<string, StoreStockInfo>> {
  const rows = await candidateStock(entries);
  const out = new Map<string, StoreStockInfo>();
  for (const e of entries) {
    const info = fold(matchRows(rows, e.modelCode, e.name));
    if (info) out.set(e.modelCode, info);
  }
  return out;
}
