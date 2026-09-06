/**
 * The item code beside an item.
 *
 * The owner, on a Fans & Blower requisition: *"Show the sku number at the right
 * side of the item. Show it in mrf, requisition, PO or anywhere it can show.
 * Show it to all roles that is allowed access. Do not show the sku to downloaded
 * excel or csv file for submission to supplier."*
 *
 * Every one of those documents stores its items as **free text** — a PO line is
 * `{ description, qty, unit, unitPrice }` and a requisition line is a string —
 * so there is no code to print. The code lives on the catalogue: `StockItem.sku`
 * (the warehouse's short scan code, "10001") and `Product.sku` ("PRD10001").
 * This looks one up by the item's NAME, which is exactly how the rest of the app
 * already joins the two — the MRF form validates a description against the
 * product catalogue, so a line's text is a catalogue name in all but the
 * hand-typed cases.
 *
 * ## Why it is a lookup and not a field
 *
 * Writing the code INTO the description would put it on the supplier's copy —
 * the printed PO and the xlsx both emit `line.description` verbatim — and the
 * owner asked for the opposite. Keeping it beside the description means the
 * export cannot pick it up by accident: there is nothing in the string to strip.
 */
/**
 * The only shape this needs — deliberately structural rather than the concrete
 * `StockOptWithAvail` / `ProductRow`, so every screen can pass whatever narrowed
 * list it already holds (`StockOpt`, `ScanProduct`, a `select` of two columns)
 * without a conversion step whose only job would be to satisfy a type.
 */
export interface SkuSource {
  name: string;
  sku?: string | null;
}

/**
 * Item names as people type them differ in whitespace and case far more often
 * than in substance — `G.I. BOLT 3/8"Ø x 1"  length` and `G.I. Bolt 3/8"Ø x 1"
 * length` are the same bolt. Nothing else is normalised: punctuation and the
 * inch marks ARE the item.
 */
export const normalizeItemName = (s: string | null | undefined): string =>
  String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** A name → code index. Opaque on purpose; build it with `buildSkuIndex`. */
export type SkuIndex = ReadonlyMap<string, string>;

/** Nothing to look anything up in — for a caller with no catalogue to hand. */
export const EMPTY_SKU_INDEX: SkuIndex = new Map();

/**
 * Build the index from what a page already loaded.
 *
 * **Stock wins over the catalogue** where an item is in both. The two are
 * different series — `10001` on the bin and the barcode, `PRD10001` in the
 * product list — and a person reading an MRF or a requisition line is on their
 * way to a shelf. A product-only item still shows its `PRD…` code rather than
 * nothing.
 *
 * The precedence is the order the sources are read BELOW, not the order a caller
 * wrote them — no call site can flip it by swapping two keys — and an entry
 * already in the index is never overwritten, so adding a source can only fill
 * gaps, never change an answer.
 */
export function buildSkuIndex(sources: {
  stock?: readonly SkuSource[];
  products?: readonly SkuSource[];
}): SkuIndex {
  const index = new Map<string, string>();
  const add = (name: string, sku: string | null | undefined) => {
    const key = normalizeItemName(name);
    const code = String(sku ?? "").trim();
    if (!key || !code || index.has(key)) return;
    index.set(key, code);
  };
  for (const s of sources.stock ?? []) add(s.name, s.sku);
  for (const p of sources.products ?? []) add(p.name, p.sku);
  return index;
}

/**
 * The code for one item, or null when the catalogue has never heard of it.
 *
 * Null rather than a placeholder: a line with no code is a line somebody typed
 * by hand, and "—" on every such row would train the eye past the real codes.
 */
export function skuFor(description: string | null | undefined, index: SkuIndex): string | null {
  return index.get(normalizeItemName(description)) ?? null;
}
