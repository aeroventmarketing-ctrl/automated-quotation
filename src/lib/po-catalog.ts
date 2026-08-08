/**
 * Client-safe helpers that connect PO forms to the product catalogue: which
 * suppliers carry a line's product, and the catalogue price for a line + supplier.
 * Matching tolerates order-reference suffixes on the line description.
 */
import type { POLine } from "@/lib/purchase-order";

export type CatalogPrices = Record<string, Record<string, number>>; // productNameLower → companyLower → price
export type CatalogSuppliers = Record<string, string[]>; // productNameLower → supplier company[]

// Compare on alphanumerics only, so punctuation / spacing differences don't block a
// match (e.g. "KDK Ceiling Cassette · 32CHH" vs "CEILING CASSETTE - KDK - 32CHH").
const canon = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
// Word / code tokens for the word-order-tolerant fallback. A "code" token carries a
// digit (a model / part number, e.g. "32chh", "25nfb", "24") — these disambiguate
// otherwise-similar items, so a fuzzy match must agree on ALL of them and two
// different models never cross-match.
const tokenize = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
const hasDigit = (t: string) => /\d/.test(t);

/**
 * Best product-name key in a catalogue map for a (possibly suffixed) description.
 * Uses the same token / model-code idea as the from-stock release picker's
 * `autoMatchId`, so "KDK Ceiling Cassette · 32CHH" matches a product named "CEILING
 * CASSETTE - KDK - 32CHH" regardless of word order / separators — while never
 * matching a different model (e.g. 24CDH). A match that agrees on the model code
 * always beats a generic / substring match, so the specific variant wins.
 */
function matchKey(description: string, keys: string[]): string | undefined {
  const desc = description.trim().toLowerCase();
  if (!desc) return undefined;
  if (keys.includes(desc)) return desc;
  const dc = canon(desc);
  if (!dc) return undefined;
  // The line's tokens + its code (digit-bearing) tokens. The line may carry extra
  // tokens beyond the product name (a qty, a "@price", an order reference), so the
  // cross-model guard is keyed on the PRODUCT's codes being present here — not the reverse.
  const dTokSet = new Set(tokenize(desc));
  const dCodeSet = new Set([...dTokSet].filter(hasDigit));
  let best: string | undefined;
  let score = 0;
  for (const key of keys) {
    const nc = canon(key);
    if (nc.length < 3) continue;
    const nToks = tokenize(key);
    const nCodes = nToks.filter(hasDigit);
    // Cross-model guard: EVERY model/part code in the product name must appear in the
    // line — so a specific model only matches a line that names it, and two different
    // models never cross-match (e.g. "…32CHH" must not match a line for "…24CDH").
    if (nCodes.some((c) => !dCodeSet.has(c))) continue;
    const shared = nToks.filter((t) => dTokSet.has(t)).length;
    let sc = 0;
    if (nc === dc) {
      sc = 10000; // identical name (ignoring punctuation/spacing)
    } else if (nCodes.length > 0) {
      // Model-code match — outranks any generic/substring match below.
      if (shared >= 2) sc = 1000 + shared * 10 + nCodes.length * 100;
    } else if ((nToks.length >= 2 && shared === nToks.length) || dc.includes(nc) || nc.includes(dc)) {
      // Generic / uncoded name (e.g. "Angle Bar"): all its words present, or a
      // plain substring either way (also covers single-word names).
      sc = 100 + shared * 10;
    }
    if (sc > score) { score = sc; best = key; }
  }
  return best;
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
