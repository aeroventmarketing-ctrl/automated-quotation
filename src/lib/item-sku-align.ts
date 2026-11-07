/**
 * Keeping a purchase request's per-line catalogue codes (`itemSkus`) in step
 * with its lines.
 *
 * `itemSkus` is aligned BY INDEX with `items` (lib/pr-item-skus), and the stored
 * code wins over a lookup by name wherever a line's SKU is shown, its stock
 * counted, its price matched or its receipt pre-selected. So any write that
 * rewrites `items` without rewriting `itemSkus` leaves codes on the wrong lines.
 * The owner found it on PO-AFBM20260001051: *"Sku223 and sku253 is different in
 * sku and description"* — a DRILL BIT line carrying another item's code and its
 * "11 pc in stock". Three writes did that — the admin's Edit of the lines, a
 * split for a second supplier, and a partial issue from stock (one line becomes
 * two) — and each now goes through here.
 *
 * Pure and client-safe.
 */
import { poLineFromPRItem, stripToPurchasePrefix, parseIssuedFromStockLine } from "@/lib/purchase-order";
import { skuFor, type SkuIndex } from "@/lib/item-sku";

/** The article a stored request line names — what its code should belong to. */
export function lineArticle(item: string): string {
  const issued = parseIssuedFromStockLine(item);
  if (issued) return issued.desc;
  return poLineFromPRItem(stripToPurchasePrefix(String(item ?? ""))).description;
}

const codeAt = (skus: readonly unknown[] | null | undefined, i: number) => String(skus?.[i] ?? "").trim();

/**
 * Codes for a request's NEW lines after an edit: a line whose text is exactly an
 * old line's keeps that line's code (each old line used once, so duplicates pair
 * up in order); any other line — changed, added, moved past a deletion — is
 * looked up by its name, `""` when the catalogue doesn't know it. An old code is
 * never carried onto a line whose text changed.
 */
export function realignSkus(
  oldItems: readonly string[],
  oldSkus: readonly unknown[] | null | undefined,
  newItems: readonly string[],
  index: SkuIndex,
): string[] {
  const used = new Set<number>();
  return newItems.map((line) => {
    const j = oldItems.findIndex((o, k) => !used.has(k) && o === line);
    if (j >= 0) {
      used.add(j);
      const carried = codeAt(oldSkus, j);
      if (carried) return carried;
    }
    return skuFor(lineArticle(line), index) ?? "";
  });
}

export type SkuCheck =
  /** No stored code, or the stored code is the one the line's name gives. */
  | { status: "ok" }
  /** The line's name is a catalogue item with a DIFFERENT code than the stored one. */
  | { status: "mismatch"; stored: string; expected: string };

/**
 * Does a line's stored code belong to it? Only a clear contradiction counts — the
 * line's own name looks up to another code. A name the catalogue doesn't know
 * can't be checked (a product renamed since, a free-typed line), so it passes.
 */
export function checkLineSku(item: string, stored: string | null | undefined, index: SkuIndex): SkuCheck {
  return checkArticleSku(lineArticle(item), stored, index);
}

/** `checkLineSku` for a bare article name — a PO line's description. */
export function checkArticleSku(article: string, stored: string | null | undefined, index: SkuIndex): SkuCheck {
  const code = String(stored ?? "").trim();
  if (!code) return { status: "ok" };
  const expected = skuFor(article, index);
  return expected && expected !== code ? { status: "mismatch", stored: code, expected } : { status: "ok" };
}

/** Every clearly wrong code on a request, corrected to the one its line's name gives. */
export function correctSkus(
  items: readonly string[],
  skus: readonly unknown[] | null | undefined,
  index: SkuIndex,
): { skus: string[]; fixed: { line: number; item: string; from: string; to: string }[] } {
  const out = items.map((_, i) => codeAt(skus, i));
  const fixed: { line: number; item: string; from: string; to: string }[] = [];
  items.forEach((item, i) => {
    const c = checkLineSku(item, out[i], index);
    if (c.status === "mismatch") {
      fixed.push({ line: i, item, from: c.stored, to: c.expected });
      out[i] = c.expected;
    }
  });
  return { skus: out, fixed };
}

/**
 * The code to USE for a line — for its chip, its stock count, its receipt: the
 * stored code, unless the line's own name clearly gives another (then that one,
 * with the stored code reported so the card can say so); a line with no stored
 * code is looked up by name.
 */
export function effectiveLineSku(item: string, stored: string | null | undefined, index: SkuIndex): { code: string | null; mismatch: { stored: string; expected: string } | null } {
  const c = checkLineSku(item, stored, index);
  if (c.status === "mismatch") return { code: c.expected, mismatch: { stored: c.stored, expected: c.expected } };
  const code = String(stored ?? "").trim();
  return { code: code || skuFor(lineArticle(item), index), mismatch: null };
}
