/**
 * Prefilling an Office Material Request from the order it belongs to.
 *
 * An Office MRF on a bought-in order is asking the warehouse for the very items
 * the order sells, so retyping them is busywork. These helpers turn the order's
 * bought-in product lines into MRF rows.
 *
 * The catch: the MRF's Articles / Description field is **selection-only** — a
 * row whose text isn't an exact catalogue product name is rejected and blocks
 * submission. So a suggestion is only useful if it resolves to a real product,
 * and when it can't we say so rather than prefilling something that looks right
 * and then refuses to submit.
 *
 * Matching deliberately refuses to guess. An order line naming "Induction Motor
 * (TECO)" against a catalogue holding several ratings ("… 1.5 HP", "… 3 HP")
 * is AMBIGUOUS, and silently picking one would put the wrong motor on a real
 * material request. Ambiguity is left for the requestor to resolve.
 */

export interface MrfSuggestion {
  /** Catalogue product name when resolved, else the order's own wording. */
  description: string;
  qty: string;
  unit: string;
  remark?: string;
  /** True when `description` is a real catalogue product and will pass submission. */
  matched: boolean;
}

interface CatalogueProduct {
  name: string;
  unit: string;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
/** Normalised with any "(…)" qualifier dropped — "Induction Motor (TECO)" → "induction motor". */
const bare = (s: string) => norm(s.replace(/\([^)]*\)/g, " "));

/**
 * Resolve one order line to a catalogue product.
 *
 * Exact name, then name-without-qualifier, then a containment match — but only
 * when containment finds exactly ONE candidate. Several candidates means the
 * order's wording isn't specific enough to choose from, which is the requestor's
 * call, not ours.
 */
export function matchCatalogueProduct(name: string, products: CatalogueProduct[]): CatalogueProduct | null {
  const n = norm(name);
  if (!n) return null;

  const exact = products.find((p) => norm(p.name) === n);
  if (exact) return exact;

  const b = bare(name);
  if (b) {
    const byBare = products.filter((p) => bare(p.name) === b);
    if (byBare.length === 1) return byBare[0];
    if (byBare.length > 1) return null; // several products share the bare name
  }

  const contains = products.filter((p) => {
    const pn = norm(p.name);
    return b !== "" && (pn.includes(b) || b.includes(pn));
  });
  return contains.length === 1 ? contains[0] : null;
}

/**
 * MRF rows for an Office request, built from the order's bought-in lines.
 *
 * `detail` (the quotation's specification — "Foot Mounted", "Rated capacity
 * 80 kg") goes in the Remark, where it's free text: it can't go in the
 * description without breaking the selection-only rule, but the warehouse needs
 * to see it to pick the right item off the shelf.
 */
export function suggestOfficeMrfRows(
  lines: { name: string; qty: number; detail?: string[] }[],
  products: CatalogueProduct[],
): MrfSuggestion[] {
  return lines.map((l) => {
    const hit = matchCatalogueProduct(l.name, products);
    return {
      description: hit ? hit.name : l.name,
      qty: l.qty > 0 ? String(l.qty) : "",
      unit: (hit?.unit ?? "unit").trim().toLowerCase(),
      remark: (l.detail ?? []).join(" · ") || undefined,
      matched: hit !== null,
    };
  });
}
