/**
 * Audit purchase-order line prices against the product catalogue.
 *
 * READ ONLY — this is a diagnostic; nothing here writes.
 *
 * Why it exists: PO 615 bought BELT B-50 at ₱128 while both of that product's
 * suppliers list ₱210, and its stock item is costed at ₱210 too.
 *
 * A CORRECTION TO AN EARLIER READING OF THIS FILE. The first version blamed the
 * seeding fallback — "lowest supplier price, else the stock item's unit cost" —
 * on the assumption that the unit cost was ₱128. It is not; inventory carries
 * ₱210. Every automatic path (the chosen supplier's price, the reference price,
 * the unit cost) yields ₱210 for this line, and the description matcher resolves
 * "BELT B-50 (JO 2600080)" to the product correctly, so auto-fill would have
 * offered ₱210. The ₱128 did not come from the catalogue.
 *
 * What that leaves is the real gap: ONCE A PRICE IS IN THE BOX, NOTHING EVER
 * CHECKS IT AGAIN. `withCatalogPrices` fills blanks only (it overwrites solely
 * when the supplier is re-picked), and no later step — save, approve, print,
 * voucher — compares the line against what the supplier lists. A figure typed by
 * hand, or one seeded when the catalogue said something different, travels
 * untouched all the way to a signed voucher.
 *
 * So this audit is that missing check, applied after the fact. It compares each
 * PO line against the catalogue as it stands today and sorts the differences:
 *
 *   - `inventory_cost` — the price equals the stock unit cost and no supplier
 *     lists that price. Kept because it is a genuine signal when it happens;
 *     it is NOT what happened to PO 615.
 *   - `differs` — the price is not one any supplier lists. This is PO 615.
 *
 * A caveat that has to stay attached to every row: **a PO legitimately records
 * the price agreed at the time.** If a supplier raised its price after the PO
 * was raised, a difference here is history, not an error. This audit narrows the
 * question down to a handful of lines to look at; it does not decide them.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getProducts } from "@/lib/product-catalog";
import { coercePurchaseOrder } from "@/lib/purchase-order";
import { catalogPriceFor, matchKey, REF_PRICE_KEY, type CatalogPrices } from "@/lib/po-catalog";

export type PriceIssueKind = "inventory_cost" | "differs";

export interface PriceIssue {
  requestId: string;
  poNumber: string;
  supplier: string;
  description: string;
  qty: string;
  /** What the PO says. */
  poPrice: number;
  /** What the chosen supplier lists now, when it lists this product at all. */
  supplierPrice: number | null;
  /** Every price any supplier lists for the matched product, ascending. */
  allSupplierPrices: number[];
  /** The stock item's unit cost, when there is one. */
  stockCost: number | null;
  kind: PriceIssueKind;
  /** Line value at the PO price vs at the supplier's price. */
  poLineTotal: number;
  correctedLineTotal: number | null;
}

export interface PriceAudit {
  purchaseOrders: number;
  lines: number;
  issues: PriceIssue[];
}

const num = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
/** Prices are money — compare to the centavo, not by identity. */
const same = (a: number, b: number) => Math.abs(a - b) < 0.005;

export async function auditPoPrices(): Promise<PriceAudit> {
  const [products, stockItems, requests] = await Promise.all([
    getProducts().catch(() => []),
    prisma.stockItem
      .findMany({ where: { active: true }, select: { name: true, unitCost: true } })
      .catch(() => [] as { name: string; unitCost: unknown }[]),
    prisma.purchaseRequest
      // `po` is a nullable Json column, so the absence of a PO is Prisma's
      // DbNull, not JS null — filtering on `null` does not type-check here.
      .findMany({ where: { po: { not: Prisma.DbNull } }, select: { id: true, po: true } })
      .catch(() => [] as { id: string; po: unknown }[]),
  ]);

  // Built exactly as the purchasing page builds it, so the audit and the seeding
  // logic can never disagree about what a product costs.
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
  for (const [n, c] of costByName) if (!catalog[n]) catalog[n] = { [REF_PRICE_KEY]: c };

  // Resolve a line description to its catalogue entry through the SAME matcher
  // the PO form uses, so "BELT B-50 (JO 2600080)" resolves to the BELT B-50
  // product and the audit judges exactly what the seeding judged.
  const keys = Object.keys(catalog);
  const entryFor = (description: string): Record<string, number> | undefined => {
    const key = matchKey(description, keys);
    return key ? catalog[key] : undefined;
  };
  /** Every distinct supplier price for a description, ascending. */
  const pricesFor = (description: string): number[] => {
    const entry = entryFor(description);
    if (!entry) return [];
    return [...new Set(Object.entries(entry).filter(([co, n]) => co !== REF_PRICE_KEY && n > 0).map(([, n]) => n))].sort(
      (a, b) => a - b,
    );
  };
  /**
   * The stock item's unit cost for a description.
   *
   * This has to come from the inventory map directly, NOT from
   * `fallbackPriceFor` — that returns the catalogue's reference price, which is
   * the lowest SUPPLIER price whenever the product has one, and only falls
   * through to unit cost when it does not. Reading the reference price here
   * would compare 210 against 210 and never spot the ₱128 line.
   */
  const stockKeys = [...costByName.keys()];
  const stockCostFor = (description: string): number | null => {
    const key = matchKey(description, stockKeys);
    return key ? costByName.get(key) ?? null : null;
  };

  const issues: PriceIssue[] = [];
  let lineCount = 0;
  let poCount = 0;

  for (const pr of requests) {
    const po = coercePurchaseOrder(pr.po);
    if (!po) continue;
    poCount++;
    const supplier = po.supplier?.company ?? "";
    const supplierLower = supplier.trim().toLowerCase();

    for (const line of po.lines) {
      const poPrice = num(line.unitPrice);
      const qty = num(line.qty);
      if (!line.description.trim() || poPrice <= 0) continue;
      lineCount++;

      const supplierPrice = supplierLower ? catalogPriceFor(line.description, supplierLower, catalog) ?? null : null;
      const all = pricesFor(line.description);
      const stockCost = stockCostFor(line.description);

      // Nothing to compare against — the product is not in the catalogue.
      if (supplierPrice === null && all.length === 0) continue;
      // The price agrees with the chosen supplier, or with some supplier's list.
      if (supplierPrice !== null && same(poPrice, supplierPrice)) continue;
      if (supplierPrice === null && all.some((p) => same(poPrice, p))) continue;

      // Seeded from inventory unit cost: the price equals the fallback figure
      // and no supplier lists it.
      const fromInventory =
        stockCost !== null && same(poPrice, stockCost) && !all.some((p) => same(p, stockCost));

      const corrected = supplierPrice ?? (all.length ? all[0] : null);
      issues.push({
        requestId: pr.id,
        poNumber: po.poNumber,
        supplier,
        description: line.description,
        qty: line.qty,
        poPrice,
        supplierPrice,
        allSupplierPrices: all,
        stockCost,
        kind: fromInventory ? "inventory_cost" : "differs",
        poLineTotal: Math.round(poPrice * qty * 100) / 100,
        correctedLineTotal: corrected === null ? null : Math.round(corrected * qty * 100) / 100,
      });
    }
  }

  // Worst first: the inventory-cost signature, then by how much money is at stake.
  issues.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "inventory_cost" ? -1 : 1;
    const av = Math.abs((a.correctedLineTotal ?? a.poLineTotal) - a.poLineTotal);
    const bv = Math.abs((b.correctedLineTotal ?? b.poLineTotal) - b.poLineTotal);
    return bv - av;
  });

  return { purchaseOrders: poCount, lines: lineCount, issues };
}
