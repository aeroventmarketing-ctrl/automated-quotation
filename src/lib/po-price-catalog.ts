/**
 * The price catalogue a purchase order draws on, built server-side.
 *
 * Products holds a price per supplier; Inventory holds a unit cost. They carry
 * the same figure, so either answers "what does this item cost?". The map is
 * `product name → supplier → price`, plus a REFERENCE entry per product: the
 * lowest supplier price, or the inventory unit cost when no supplier lists one.
 *
 * This lived inline in the Purchasing page, and was copied again by the price
 * audit. It is one function now because three places have to agree about what a
 * product costs: the PO form that fills the price in, the save that checks it,
 * and the audit that reports on it. Two copies is how they drift.
 */
import { prisma } from "@/lib/db";
import { getProducts } from "@/lib/product-catalog";
import { catalogPriceFor, catalogReferencePriceFor, REF_PRICE_KEY, type CatalogPrices } from "@/lib/po-catalog";

export type { CatalogPrices };

export async function buildPoPriceCatalog(): Promise<CatalogPrices> {
  const [products, stockItems] = await Promise.all([
    getProducts().catch(() => []),
    prisma.stockItem
      .findMany({ where: { active: true }, select: { name: true, unitCost: true } })
      .catch(() => [] as { name: string; unitCost: unknown }[]),
  ]);

  const catalog: CatalogPrices = {};
  for (const p of products) {
    const m: Record<string, number> = {};
    for (const s of p.suppliers) if (s.price && s.price > 0) m[s.company.toLowerCase()] = s.price;
    if (Object.keys(m).length) catalog[p.name.trim().toLowerCase()] = m;
  }

  const costByName = new Map<string, number>();
  for (const si of stockItems) {
    const n = si.name.trim().toLowerCase();
    const c = Number(si.unitCost);
    if (c > 0 && !costByName.has(n)) costByName.set(n, c);
  }

  for (const p of products) {
    const key = p.name.trim().toLowerCase();
    const m = catalog[key] ?? {};
    const supplierPrices = Object.values(m).filter((n) => n > 0);
    const ref = supplierPrices.length ? Math.min(...supplierPrices) : costByName.get(key) ?? 0;
    if (ref > 0) catalog[key] = { ...m, [REF_PRICE_KEY]: ref };
  }
  // Items stocked but not in the product catalogue still offer their unit cost.
  for (const [n, c] of costByName) if (!catalog[n]) catalog[n] = { [REF_PRICE_KEY]: c };

  return catalog;
}

/**
 * What the catalogue says a PO line should cost: the chosen supplier's price
 * when they list one, otherwise the reference figure. `null` when the product is
 * not in the catalogue at all — nothing to compare against, so nothing to
 * enforce.
 */
export function cataloguePriceForLine(
  description: string,
  company: string,
  catalog: CatalogPrices,
): number | null {
  const co = (company ?? "").trim().toLowerCase();
  return (
    (co ? catalogPriceFor(description, co, catalog) : undefined) ??
    catalogReferencePriceFor(description, catalog) ??
    null
  );
}
