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
 * Words and numbers, with compound numbers kept whole:
 *
 * - **Decimals** — "1.5 Hp" → ["1.5","hp"]. This is the whole point: it's what
 *   separates a 1.5 HP motor from a 15 HP one. The leading-dot form matters
 *   too, because the real catalogue writes "3 PH .75KW" and reading that as
 *   75 kW would throw a correct match away.
 * - **Fractions** — `5/16"Ø x 1 1/2" length` → ["5/16","x","1","1/2","length"].
 *   Split into digits these become indistinguishable from `5/16"Ø x 1/2"`, and
 *   the catalogue stocks both.
 */
function tokens(s: string): string[] {
  return (s ?? "").toLowerCase().match(/[a-z]+|\d+\/\d+|\d*\.\d+|\d+/g) ?? [];
}

/**
 * Numbers the trade writes as words — "Three Phase" is "3 PH".
 */
const WORD_NUMBERS: Record<string, number> = {
  single: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  six: 6,
  eight: 8,
  ten: 10,
  twelve: 12,
};

function numberFrom(tok: string | undefined): number | null {
  if (!tok) return null;
  const word = WORD_NUMBERS[tok];
  if (word !== undefined) return word;
  const n = Number(tok);
  return Number.isFinite(n) ? n : null;
}

/**
 * The qualifiers that make one motor a different motor. Each is a number stated
 * immediately before a unit word, so "1.5 HP, 3PH, 4 POLE" carries three of
 * them. Disagreement on any of these is a hard reject, not a low score: a 1 HP
 * single-phase motor must never be sent because the line said 1 HP three-phase.
 */
const DIMENSIONS: { key: string; units: string[] }[] = [
  { key: "hp", units: ["hp"] },
  { key: "kw", units: ["kw"] },
  { key: "phase", units: ["ph", "phase"] },
  { key: "pole", units: ["pole", "poles"] },
];

/**
 * Every value a token list states for each dimension — a set, because a
 * quotation line is a label plus a description plus its specs, and the same
 * rating can be written more than once.
 */
function dimensionsOf(toks: string[]): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const d of DIMENSIONS) out.set(d.key, new Set<number>());
  for (let i = 1; i < toks.length; i++) {
    const dim = DIMENSIONS.find((d) => d.units.includes(toks[i]));
    if (!dim) continue;
    const n = numberFrom(toks[i - 1]);
    if (n !== null) out.get(dim.key)!.add(n);
  }
  return out;
}

/**
 * Brand names, learned from the catalogue rather than hard-coded: a word in
 * parentheses that more than one product carries. On the real catalogue that
 * finds TECO, HYUNDAI, IDEC and friends — which is what separates the two
 * otherwise identical 15 HP three-phase motors it stocks.
 */
function brandVocabulary(products: CatalogueProduct[]): Set<string> {
  const seen = new Map<string, number>();
  for (const p of products) {
    for (const m of p.name.matchAll(/\(([^)]*)\)/g)) {
      const inner = m[1].trim().toLowerCase();
      if (!/^[a-z]{3,}$/.test(inner)) continue;
      seen.set(inner, (seen.get(inner) ?? 0) + 1);
    }
  }
  return new Set([...seen.entries()].filter(([, n]) => n >= 2).map(([k]) => k));
}

function brandOf(name: string, vocab: Set<string>): string | null {
  for (const m of name.matchAll(/\(([^)]*)\)/g)) {
    const inner = m[1].trim().toLowerCase();
    if (vocab.has(inner)) return inner;
  }
  return null;
}

/**
 * The gate a product must clear before it can be ranked at all: at least two of
 * its WORDS (or all of them, for a one-word name) appear in the line. Words
 * identify the product family; the frame codes, mounting and trailing
 * qualifiers a catalogue carries are noise the quotation rarely repeats.
 * Demanding those too is what made every row on 3236J come back unmatched.
 */
const MIN_WORD_HITS = 2;

/**
 * How well a product name fits a line, balanced BOTH ways: how much of the
 * product's name the line accounts for, and how much of the line the product
 * accounts for, combined as a harmonic mean. 1 is a perfect fit.
 *
 * Both halves are load-bearing, and on DISTINCT tokens:
 *
 * - Rewarding matched tokens alone lets a long name win by accumulating
 *   incidental hits — `PULLEY 3"Ø x 2B BIG HUB` was resolving to
 *   `PULLEY 9 1/2"Ø x 3B x ATLEAST 1/2 MM HUB x SMALLER THAN 2" BORE`, whose
 *   repeated "1/2" scored twice over.
 * - Rewarding product coverage alone lets a bare `INDUCTION MOTOR` beat the
 *   15 HP three-phase one the line actually describes.
 */
function fitScore(prod: Set<string>, line: Set<string>): number {
  let shared = 0;
  for (const t of prod) if (line.has(t)) shared++;
  if (shared === 0) return 0;
  const precision = shared / prod.size;
  const recall = shared / line.size;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Resolve one quotation line to a catalogue product.
 *
 * Three rules, doing different jobs:
 *
 * 1. **Dimension safety (a hard reject).** If the product states an HP, kW,
 *    phase or pole figure the line contradicts, it is out — no score rescues
 *    it. A product that stays silent on a dimension is never rejected for it.
 * 2. **Brand safety (a hard reject).** The line naming TECO cannot be filled
 *    with the HYUNDAI equivalent, even though the catalogue lists both at the
 *    same rating and the HYUNDAI name happens to share more words.
 * 3. **Fit (the ranking).** Among what survives, the best fit wins — balanced
 *    both ways, see `fitScore`.
 *
 * A tie is genuine ambiguity and resolves to null: the requestor decides, not a
 * heuristic.
 */
export function matchCatalogueProduct(line: QuotationLineForMrf, products: CatalogueProduct[]): CatalogueProduct | null {
  return matchAgainst(line, indexCatalogue(products));
}

/** A product with everything matching needs from its name, worked out once. */
interface IndexedProduct {
  product: CatalogueProduct;
  toks: Set<string>;
  words: string[];
  dims: Map<string, Set<number>>;
  brand: string | null;
}

interface Catalogue {
  items: IndexedProduct[];
  vocab: Set<string>;
}

/**
 * Tokenise the catalogue once. It runs to a thousand products and a prefill
 * matches every line of the quotation against all of them.
 */
function indexCatalogue(products: CatalogueProduct[]): Catalogue {
  const vocab = brandVocabulary(products);
  const items: IndexedProduct[] = [];
  for (const product of products) {
    const nt = tokens(product.name);
    if (nt.length === 0) continue;
    items.push({
      product,
      toks: new Set(nt),
      words: nt.filter((t) => /^[a-z]+$/.test(t)),
      dims: dimensionsOf(nt),
      brand: brandOf(product.name, vocab),
    });
  }
  return { items, vocab };
}

function matchAgainst(line: QuotationLineForMrf, catalogue: Catalogue): CatalogueProduct | null {
  const lineToks = tokens([line.name, line.description ?? "", line.specText ?? ""].join(" "));
  if (lineToks.length === 0) return null;
  const lineSet = new Set(lineToks);
  const lineDims = dimensionsOf(lineToks);
  const lineBrands = new Set([...lineSet].filter((t) => catalogue.vocab.has(t)));

  let best: CatalogueProduct | null = null;
  let bestScore = 0;
  let bestDims: Map<string, Set<number>> | null = null;
  let tied = false;
  const survivors: { score: number; dims: Map<string, Set<number>> }[] = [];

  for (const { product: p, toks, words, dims: prodDims, brand } of catalogue.items) {
    // 1. Dimension safety.
    const contradicted = DIMENSIONS.some((d) => {
      const mine = prodDims.get(d.key)!;
      const theirs = lineDims.get(d.key)!;
      if (mine.size === 0 || theirs.size === 0) return false;
      return ![...mine].some((v) => theirs.has(v));
    });
    if (contradicted) continue;

    // 2. Brand safety.
    if (brand !== null && lineBrands.size > 0 && !lineBrands.has(brand)) continue;

    // 3. Fit, gated on the product's words.
    if (words.length === 0) continue; // a name of pure numbers identifies nothing
    const wordHits = words.filter((t) => lineSet.has(t)).length;
    if (wordHits < Math.min(MIN_WORD_HITS, words.length)) continue;

    const score = fitScore(toks, lineSet);
    if (score <= 0) continue;
    survivors.push({ score, dims: prodDims });
    if (score > bestScore) {
      best = p;
      bestScore = score;
      bestDims = prodDims;
      tied = false;
    } else if (score === bestScore && p.name !== best?.name) {
      tied = true;
    }
  }
  if (tied || best === null || bestDims === null) return null;
  return undecided(bestDims, bestScore, survivors, lineDims) ? null : best;
}

/**
 * How close a rival has to score before it counts as a real alternative rather
 * than a distant also-ran.
 */
const RIVAL_SCORE_RATIO = 0.75;

/**
 * Is the winner really a choice the line made, or one the ranking made for it?
 *
 * If the catalogue separates two close-scoring products by a dimension — the
 * same motor at 1 HP and at 3 HP — and the line never says which, then nothing
 * in the quotation picked the winner: its name was simply shorter. That is a
 * guess, and this is the one place a guess is expensive, so it resolves to
 * unmatched and the requestor chooses.
 *
 * A dimension the line DOES state can't trigger this: contradicting candidates
 * were already rejected outright.
 */
function undecided(
  bestDims: Map<string, Set<number>>,
  bestScore: number,
  survivors: { score: number; dims: Map<string, Set<number>> }[],
  lineDims: Map<string, Set<number>>,
): boolean {
  const rivals = survivors.filter((s) => s.score >= bestScore * RIVAL_SCORE_RATIO);
  return DIMENSIONS.some((d) => {
    if (lineDims.get(d.key)!.size > 0) return false;
    const mine = bestDims.get(d.key)!;
    if (mine.size === 0) return false;
    return rivals.some((r) => {
      const theirs = r.dims.get(d.key)!;
      return theirs.size > 0 && ![...theirs].some((v) => mine.has(v));
    });
  });
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
  /**
   * Inventory items, as a second place to look. Only ones whose name is ALSO a
   * product can be emitted — the form validates the description against the
   * product catalogue, so a stock-only name would fill the row and then block
   * submission.
   */
  stock: CatalogueProduct[] = [],
): MrfSuggestion[] {
  const byName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p]));
  const bridged = stock
    .map((s) => byName.get(s.name.trim().toLowerCase()))
    .filter((p): p is CatalogueProduct => p !== undefined);
  // Dedupe: a name in both lists must not be scored twice or it looks like a tie.
  const pool = [...new Map([...products, ...bridged].map((p) => [p.name, p])).values()];
  return mergeIdenticalRows(buildRows(lines, pool));
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
  const catalogue = indexCatalogue(products);
  return lines.map((l) => {
    const hit = matchAgainst(l, catalogue);
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
