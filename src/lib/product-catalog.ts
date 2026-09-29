/**
 * Server-side product catalogue helpers (no "use server" — internal use). Reads
 * the Product table. Products are added only by the Purchaser or an admin on the
 * Products page (with a supplier and price) — nothing is auto-saved from forms.
 */
import { cache } from "react";
import { unstable_cache, revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { coerceProductSuppliers, type ProductSupplierLink } from "@/lib/products";

export interface ProductRow {
  id: string;
  sku: string | null;
  name: string;
  unit: string;
  category: string | null;
  note: string | null;
  suppliers: ProductSupplierLink[];
}

/** Claim the next product SKU (e.g. "PRD10001"). Runs inside a transaction. */
export async function nextProductSku(tx: Prisma.TransactionClient): Promise<string> {
  const KEY = "product_sku_counter";
  const row = await tx.appSetting.findUnique({ where: { key: KEY } });
  const cur = typeof (row?.value as { n?: unknown } | null)?.n === "number" ? (row!.value as { n: number }).n : 10000;
  const n = cur + 1;
  await tx.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: { n } as Prisma.InputJsonValue },
    update: { value: { n } as Prisma.InputJsonValue },
  });
  return `PRD${n}`;
}

/**
 * All active products, alphabetically, with their supplier links.
 *
 * The `select` is not decoration. This is read by the order page, the MRF page,
 * requisitions and purchasing — pages that re-render on a timer — so it runs
 * thousands of times a day, and Postgres ranks it among the largest sources of
 * rows leaving the database. It has always returned a `ProductRow`, so the three
 * columns dropped here (`active`, which the `where` already pins, and the two
 * timestamps) were being fetched and discarded by the mapping below on every one
 * of those calls.
 *
 * Keep this list and `ProductRow` in step: a field added to one and not the
 * other is a type error rather than a silently empty column.
 */
/**
 * The product catalogue is read ACROSS requests, not just within one.
 *
 * `cache()` alone memoises per request, and that was never the problem: Postgres
 * showed **9,600 calls returning 1,041 rows each** in 40 hours — the whole table,
 * over and over, because Purchasing and Requisitions load it on every render and
 * both refresh every eight seconds. By estimated bytes it was the single largest
 * reader left in the database after the account registry.
 *
 * It cannot be narrowed to the names on the page: `po-catalog`'s `matchKey` is
 * fuzzy and tokenised across the WHOLE catalogue, so a shorter list would change
 * which product a PO line matches — and with it the supplier and the unit price.
 * That is why this is a cache and not a `where`.
 *
 * **Invalidated by tag on every write**, so a price or supplier edit shows up at
 * once rather than after a wait. The `revalidate` is a floor, not the mechanism:
 * if a writer is ever added without calling `revalidateProductCatalogue`, the
 * catalogue goes stale for five minutes instead of forever.
 */
export const PRODUCT_CATALOGUE_TAG = "catalogue:products";

/**
 * Drop the cached catalogue. Call from a server action AFTER any write to
 * `Product` — a create, an edit, a price or supplier change, a deactivation.
 */
export function revalidateProductCatalogue(): void {
  revalidateTag(PRODUCT_CATALOGUE_TAG);
}

const readProducts = unstable_cache(
  async (): Promise<ProductRow[]> => {
    const list = await prisma.product.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, sku: true, name: true, unit: true, category: true, note: true, suppliers: true },
    });
    return list.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      category: p.category,
      note: p.note,
      suppliers: coerceProductSuppliers(p.suppliers),
    }));
  },
  ["product-catalogue"],
  { tags: [PRODUCT_CATALOGUE_TAG], revalidate: 300 },
);

/**
 * `cache()` on top of the data cache, deliberately: the first memoises the
 * PROMISE within one render (a page asking three times gets one call), the
 * second holds the RESULT across requests. Neither replaces the other.
 *
 * Nothing that reads `ProductRow` sees a Prisma `Decimal` — every field is a
 * string, a null or a coerced plain object — which is what makes it safe to put
 * through the data cache at all. A `Decimal` would come back a different shape
 * than it went in.
 */
export const getProducts = cache(async function getProducts(): Promise<ProductRow[]> {
  return readProducts();
});

/**
 * Just enough of a product to NAME it: the four fields an autocomplete, a
 * barcode scan and an MRF suggestion actually read.
 *
 * Structurally a `ScanProduct` (`lib/product-scan`) and a `CatalogueProduct`
 * (`lib/mrf-suggest`), which is what lets it be passed straight to both.
 */
export interface ProductOption {
  id: string;
  sku: string | null;
  name: string;
  unit: string;
}

/**
 * The same catalogue as `getProducts`, without the supplier links.
 *
 * `suppliers` is a JSON column — every supplier, price and lead time for every
 * product — and the pages that only need to offer a name were paying for all of
 * it and throwing it away. The order page fetched the lot and mapped it down to
 * exactly these four fields on the very next line, on a page that re-renders on
 * a timer.
 *
 * Use `getProducts` where a PRICE or a SUPPLIER is needed (purchasing,
 * requisitions, the P&L cost resolvers, the Products page). Use this where the
 * product is only being named.
 */
const readProductOptions = unstable_cache(
  async (): Promise<ProductOption[]> =>
    prisma.product.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, sku: true, name: true, unit: true },
    }),
  ["product-options"],
  { tags: [PRODUCT_CATALOGUE_TAG], revalidate: 300 },
);

/**
 * Cached on the SAME tag as `getProducts`, so one `revalidateProductCatalogue()`
 * clears both. Two tags would be two things to remember, and the one that got
 * forgotten would be the one showing yesterday's product names.
 */
export const getProductOptions = cache(async function getProductOptions(): Promise<ProductOption[]> {
  return readProductOptions();
});
