/**
 * Prefilling an Office Material Request from the won quotation behind the order.
 *
 * An Office MRF on a bought-in order asks the warehouse for the very items the
 * quotation sells, so the form is seeded from the quotation's OWN line items —
 * one MRF row per quotation line, with that line's quantity and specification.
 * (The Phase 4 requisition combines identical products, which is right for a PO
 * but would collapse five motors of different ratings into a single row.)
 *
 * The catch: the MRF's Articles / Description field is **selection-only** — a
 * row whose text isn't an exact catalogue product name is rejected and blocks
 * submission. So a suggestion is only useful if it resolves to a real product,
 * and when it can't we say so rather than prefilling something that looks right
 * and then refuses to submit.
 *
 * Matching deliberately refuses to guess. Putting the wrong motor on a real
 * material request is far worse than asking the requestor to pick one.
 */

export interface MrfSuggestion {
  /** Catalogue product name when resolved, else the quotation's own wording. */
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

/** One quotation line, as much of it as matching can use. */
export interface QuotationLineForMrf {
  name: string;
  qty: number;
  detail?: string[];
  /** The quotation's multi-line description, verbatim. */
  description?: string;
  /** The line's spec values flattened to text (HP, phase, pole, frame …). */
  specText?: string;
}

/**
 * Words and numbers, with decimals kept whole — "1.5 Hp, 11 Kw" →
 * ["1.5","hp","11","kw"]. Keeping "1.5" intact is the whole point: it's what
 * separates a 1.5 HP motor from a 15 HP one.
 */
function tokens(s: string): string[] {
  return (s ?? "").toLowerCase().match(/[a-z]+|\d+(?:\.\d+)?/g) ?? [];
}

/**
 * Resolve one quotation line to a catalogue product.
 *
 * A product is a candidate when EVERY token of its name appears somewhere in
 * the line's text (label + description + specs). The most specific candidate —
 * the one with the most tokens — wins, because "Induction Motor 1.5 HP" beats a
 * bare "Induction Motor" when both fit. A tie at the top is genuine ambiguity
 * and resolves to null: the requestor decides, not a heuristic.
 */
export function matchCatalogueProduct(line: QuotationLineForMrf, products: CatalogueProduct[]): CatalogueProduct | null {
  const haystack = new Set(tokens([line.name, line.description ?? "", line.specText ?? ""].join(" ")));
  if (haystack.size === 0) return null;

  let best: CatalogueProduct | null = null;
  let bestLen = 0;
  let tied = false;
  for (const p of products) {
    const t = tokens(p.name);
    if (t.length === 0 || !t.every((tok) => haystack.has(tok))) continue;
    if (t.length > bestLen) {
      best = p;
      bestLen = t.length;
      tied = false;
    } else if (t.length === bestLen && p.name !== best?.name) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/**
 * MRF rows for an Office request, built from the quotation's bought-in lines.
 *
 * The quotation's description goes in the Remark, where it's free text: it
 * can't go in the description field without breaking the selection-only rule,
 * but the warehouse needs it to pick the right item off the shelf.
 */
export function suggestOfficeMrfRows(
  lines: QuotationLineForMrf[],
  products: CatalogueProduct[],
): MrfSuggestion[] {
  return mergeIdenticalRows(buildRows(lines, products));
}

/**
 * Combine rows that are identical in every respect — same product, same unit,
 * same remark — summing their quantities. Two quotation lines for the same
 * 1 HP motor become one row of 4 rather than two of 2.
 *
 * Identity deliberately includes the REMARK. Two lines can resolve to the same
 * catalogue product while the quotation describes them differently ("TEFC,
 * 1.5 Hp, 1.1 Kw" vs "220V, 4 Pole, 90L Frame, TECO"); merging those would throw
 * one description away, and the warehouse needs both to know what it's picking.
 */
function mergeIdenticalRows(rows: MrfSuggestion[]): MrfSuggestion[] {
  const out: MrfSuggestion[] = [];
  const at = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.description}\u0000${r.unit}\u0000${r.remark ?? ""}`;
    const seen = at.get(key);
    if (seen === undefined) {
      at.set(key, out.length);
      out.push({ ...r });
      continue;
    }
    const total = (Number(out[seen].qty) || 0) + (Number(r.qty) || 0);
    out[seen] = { ...out[seen], qty: total > 0 ? String(total) : "" };
  }
  return out;
}

function buildRows(lines: QuotationLineForMrf[], products: CatalogueProduct[]): MrfSuggestion[] {
  return lines.map((l) => {
    const hit = matchCatalogueProduct(l, products);
    // Prefer the quotation's own description lines for the remark; fall back to
    // the derived detail when a line carried nothing extra.
    const spec = (l.description ?? "")
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    const remark = (spec.length > 0 ? spec : (l.detail ?? [])).join(" · ");
    return {
      description: hit ? hit.name : l.name,
      qty: l.qty > 0 ? String(l.qty) : "",
      unit: (hit?.unit ?? "unit").trim().toLowerCase(),
      remark: remark || undefined,
      matched: hit !== null,
    };
  });
}
