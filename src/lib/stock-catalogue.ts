/**
 * The warehouse catalogue, split by how fast each part changes.
 *
 * The order page loads every active stock item on every render, and it
 * auto-refreshes — Postgres measured **~20,000 whole-table reads in 40 hours**,
 * 1,046 rows each. It is the second-largest reader in the database after the
 * product catalogue.
 *
 * ## Why this is not simply `unstable_cache` over the whole row
 *
 * Two reasons, and the first is the serious one.
 *
 * **Stale quantities are the one kind of staleness that could cost money.** A
 * warehouse hand issuing against a number that is thirty seconds old is exactly
 * the failure this must not introduce. (The server re-checks availability inside
 * the issuing transaction and caps at what is actually there — see
 * `processMaterialRequest` — so a stale display could not oversell stock. It
 * could still send someone to a shelf for something that is gone, which is bad
 * enough.)
 *
 * **And `quantity` is a Prisma `Decimal`**, which does not survive Next's data
 * cache as the same shape it went in. `ProductRow` is cacheable precisely
 * because every field on it is a string, a null or a coerced plain object;
 * `StockItem` is not.
 *
 * ## So: the wide part is cached, the volatile part is live
 *
 * Every render still reads `{ id, quantity }` for every active item — 1,046
 * narrow rows instead of 1,046 wide ones, which is where the saving comes from —
 * and the names, codes and locations come from cache.
 *
 * The live read is also what defines **which items exist**:
 *
 *  · an item DEACTIVATED since the cache was filled is absent from the live read,
 *    so it disappears here at once rather than lingering for the TTL;
 *  · an item CREATED since is present in the live read but missing from the
 *    cache, so its details are fetched directly — usually nothing, occasionally
 *    one row. A new item invisible on the order page would be a far worse
 *    failure than a name that is a minute out of date.
 *
 * What can lag, and only until the next write or the TTL, is an item's NAME, SKU
 * or LOCATION. Those change when somebody edits the catalogue, not in the course
 * of a day's picking.
 */
import { cache } from "react";
import { unstable_cache, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";

/** The shape the order page and its panels already expect. */
export interface StockCatalogueItem {
  id: string;
  sku: string | null;
  name: string;
  unit: string;
  location: string | null;
  quantity: number;
}

export const STOCK_CATALOGUE_TAG = "catalogue:stock";

/**
 * Drop the cached item details. Call from a server action AFTER any write that
 * changes a stock item's NAME, SKU, UNIT or LOCATION — a create, an edit, a
 * merge, an import.
 *
 * A quantity-only movement (issue, receive, transfer) does **not** need this:
 * quantities are never cached.
 */
export function revalidateStockCatalogue(): void {
  revalidateTag(STOCK_CATALOGUE_TAG);
}

/** Name, code and location — the part that changes when somebody edits, not when stock moves. */
const readStockDetails = unstable_cache(
  async () =>
    prisma.stockItem.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, sku: true, name: true, unit: true, location: true },
    }),
  ["stock-catalogue-details"],
  { tags: [STOCK_CATALOGUE_TAG], revalidate: 120 },
);

/**
 * Every active stock item, with a live quantity.
 *
 * Ordered by name, like the query it replaces — the pickers and the match panels
 * present this list to a human, and an order that shifted between renders would
 * be its own small bug.
 */
export const getStockCatalogue = cache(async function getStockCatalogue(): Promise<StockCatalogueItem[]> {
  const [details, live] = await Promise.all([
    readStockDetails(),
    // The authoritative set AND the authoritative quantities, every time.
    prisma.stockItem.findMany({ where: { active: true }, select: { id: true, quantity: true } }),
  ]);

  const byId = new Map(details.map((d) => [d.id, d]));
  const missing = live.filter((r) => !byId.has(r.id)).map((r) => r.id);
  if (missing.length > 0) {
    // Created since the cache was filled. Rare, and cheap when it happens.
    const fresh = await prisma.stockItem.findMany({
      where: { id: { in: missing } },
      select: { id: true, sku: true, name: true, unit: true, location: true },
    });
    for (const f of fresh) byId.set(f.id, f);
  }

  const out: StockCatalogueItem[] = [];
  for (const r of live) {
    const d = byId.get(r.id);
    if (!d) continue; // Deleted between the two reads — not an item any more.
    out.push({ ...d, quantity: Number(r.quantity) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
});
