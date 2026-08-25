/**
 * Storefront cart — the shared shape plus the SERVER-side repricing.
 *
 * The browser's cart holds only identifiers and quantities (slug + variant +
 * qty). Prices are NEVER taken from the client: `priceCart` re-reads the
 * catalogue, re-derives the website price and recomputes every line, so a
 * tampered cart or a stale tab can't buy at the wrong price. The priced result
 * is what the cart page shows and what checkout writes to the order.
 */
import { listStoreProducts, type StoreProduct } from "@/lib/store-catalog";

/** One line as the browser stores it (no prices — see above). */
export interface CartLine {
  slug: string;
  variantKey: string;
  qty: number;
}

/** A cart line after the server has priced it. */
export interface PricedLine {
  slug: string;
  variantKey: string;
  variantLabel: string;
  qty: number;
  modelCode: string;
  name: string;
  unit: string;
  photoPath: string | null;
  catalogueItemId: string;
  unitPrice: number;
  lineTotal: number;
}

export interface PricedCart {
  lines: PricedLine[];
  /** Lines dropped because the product is gone, unlisted, quote-only or unpriced. */
  dropped: { slug: string; reason: string }[];
  subtotal: number;
  total: number;
  currency: string;
}

/** Cap per line — a storefront order is retail, not a project supply contract. */
export const MAX_LINE_QTY = 99;

/** Clean a raw cart from the browser: valid shapes, sane quantities, deduped. */
export function normalizeCart(raw: unknown): CartLine[] {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map<string, CartLine>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const slug = String(o.slug ?? "").trim().toLowerCase();
    if (!slug) continue;
    const variantKey = String(o.variantKey ?? "default").trim() || "default";
    const qty = Math.floor(Number(o.qty));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const key = `${slug}::${variantKey}`;
    const prev = byKey.get(key);
    const merged = Math.min((prev?.qty ?? 0) + qty, MAX_LINE_QTY);
    byKey.set(key, { slug, variantKey, qty: merged });
  }
  return [...byKey.values()];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Price a cart against the live catalogue. Drops anything that can't legitimately
 * be bought online (unlisted, quote-only, or without a price for that variant)
 * and reports why, so the cart page can tell the shopper.
 */
export async function priceCart(lines: CartLine[]): Promise<PricedCart> {
  const clean = normalizeCart(lines);
  const products = await listStoreProducts();
  const bySlug = new Map<string, StoreProduct>(products.map((p) => [p.slug, p]));

  const priced: PricedLine[] = [];
  const dropped: { slug: string; reason: string }[] = [];

  for (const l of clean) {
    const p = bySlug.get(l.slug);
    if (!p) { dropped.push({ slug: l.slug, reason: "no longer available" }); continue; }
    if (p.quoteOnly) { dropped.push({ slug: l.slug, reason: "made to order — request a quotation" }); continue; }
    const variant = p.variants.find((v) => v.key === l.variantKey) ?? (p.variants.length === 1 ? p.variants[0] : undefined);
    if (!variant) { dropped.push({ slug: l.slug, reason: "that option is no longer priced" }); continue; }

    const unitPrice = variant.websitePrice;
    priced.push({
      slug: p.slug,
      variantKey: variant.key,
      variantLabel: variant.label,
      qty: l.qty,
      modelCode: p.modelCode,
      name: p.name,
      unit: p.uom,
      photoPath: p.photos[0]?.path ?? null,
      catalogueItemId: p.id,
      unitPrice,
      lineTotal: round2(unitPrice * l.qty),
    });
  }

  const subtotal = round2(priced.reduce((a, l) => a + l.lineTotal, 0));
  return { lines: priced, dropped, subtotal, total: subtotal, currency: "PHP" };
}
