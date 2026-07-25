/**
 * Client-safe helpers that connect PO forms to the product catalogue: which
 * suppliers carry a line's product, and the catalogue price for a line + supplier.
 * Matching tolerates order-reference suffixes on the line description.
 */
import type { POLine } from "@/lib/purchase-order";

export type CatalogPrices = Record<string, Record<string, number>>; // productNameLower → companyLower → price
export type CatalogSuppliers = Record<string, string[]>; // productNameLower → supplier company[]

/** Best product-name key in a catalogue map for a (possibly suffixed) description. */
function matchKey(description: string, keys: string[]): string | undefined {
  const desc = description.trim().toLowerCase();
  if (!desc) return undefined;
  if (keys.includes(desc)) return desc;
  return [...keys].sort((a, b) => b.length - a.length).find((n) => n.length >= 3 && (desc.includes(n) || n.includes(desc)));
}

/** The catalogue price for a line description + supplier (order-suffix tolerant). */
export function catalogPriceFor(description: string, companyLower: string, catalog: CatalogPrices): number | undefined {
  if (!companyLower) return undefined;
  const key = matchKey(description, Object.keys(catalog));
  return key ? catalog[key]?.[companyLower] : undefined;
}

/**
 * A reference price for a line before a supplier is chosen — used only when the
 * product has a SINGLE known catalogue price (unambiguous). When several
 * suppliers list different prices we leave it blank so the purchaser picks the
 * supplier first (avoids seeding a wrong-supplier price).
 */
export function catalogReferencePriceFor(description: string, catalog: CatalogPrices): number | undefined {
  const key = matchKey(description, Object.keys(catalog));
  if (!key) return undefined;
  const prices = [...new Set(Object.values(catalog[key] ?? {}).filter((n) => n > 0))];
  return prices.length === 1 ? prices[0] : undefined;
}

/** Seed each blank line's unit price with its unambiguous catalogue reference price. */
export function withReferencePrices(lines: POLine[], catalog: CatalogPrices): POLine[] {
  return lines.map((l) => {
    if (l.unitPrice) return l;
    const price = catalogReferencePriceFor(l.description, catalog);
    return price ? { ...l, unitPrice: String(price) } : l;
  });
}

/** Fill each line's unit price from the catalogue for the chosen supplier (blanks only unless forced). */
export function withCatalogPrices(lines: POLine[], company: string, catalog: CatalogPrices, force = false): POLine[] {
  const co = company.trim().toLowerCase();
  if (!co) return lines;
  return lines.map((l) => {
    if (l.unitPrice && !force) return l;
    const price = catalogPriceFor(l.description, co, catalog);
    return price ? { ...l, unitPrice: String(price) } : l;
  });
}

/** Supplier companies that carry a line's product (order-suffix tolerant). */
export function suppliersForDescription(description: string, catalog: CatalogSuppliers): string[] {
  const key = matchKey(description, Object.keys(catalog));
  return key ? catalog[key] ?? [] : [];
}

/** The set of supplier companies (lowercased) that carry any of the given lines' products. */
export function carriersForLines(lines: POLine[], catalog: CatalogSuppliers): Set<string> {
  const set = new Set<string>();
  for (const l of lines) for (const co of suppliersForDescription(l.description, catalog)) set.add(co.toLowerCase());
  return set;
}
