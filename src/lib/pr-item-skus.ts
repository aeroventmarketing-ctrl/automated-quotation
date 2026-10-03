/**
 * Record what each purchase-request line IS, at the one point where it is known.
 *
 * The owner: *"In MRF there is an sku but in PO sku is not showing… It will be
 * better if products and inventory is referenced by sku."*
 *
 * A material request holds `description` and `remark` as separate fields, so its
 * own card can look the code up off a clean name — which is why the MRF shows
 * `SKU CAT00199` and purchasing did not. `mrfItemLine` then glues the two into
 * `"<qty> <unit> · <description> (<remark>)"` and everything downstream has to
 * take the article back out of a string written for a person to read. #563 fixed
 * one way that went wrong (a remark carrying brackets, which the peel refused);
 * the general problem is that it is a guess at all, and the thing being guessed
 * decides the supplier and the price.
 *
 * So the answer is recorded when the line is composed and carried from there.
 * Nothing here parses display text: `description` is the stored field, exactly
 * as the MRF card reads it.
 *
 * An unmatched line stores `""` rather than being skipped — the array is aligned
 * BY INDEX with `items`, and a hole would shift every later code onto the wrong
 * line.
 */
import { prisma } from "@/lib/db";
import { getProducts } from "@/lib/product-catalog";
import { buildSkuIndex, skuFor, type SkuIndex } from "@/lib/item-sku";

/** The fields of a line this needs — the stored description, not a rendered one. */
export interface SkuSourceLine {
  description: string;
}

/**
 * One SKU index over inventory and the product catalogue, built from the live
 * data. Stock wins over products where an item is in both — `buildSkuIndex`
 * owns that precedence.
 */
export async function buildCatalogueSkuIndex(): Promise<SkuIndex> {
  const [stock, products] = await Promise.all([
    prisma.stockItem
      .findMany({ where: { active: true }, select: { name: true, sku: true } })
      .catch(() => [] as { name: string; sku: string | null }[]),
    getProducts().catch(() => [] as { name: string; sku: string | null }[]),
  ]);
  return buildSkuIndex({ stock, products });
}

/** The catalogue code for each line, aligned by index, `""` where unmatched. */
export function skusForLines(lines: readonly SkuSourceLine[], index: SkuIndex): string[] {
  return lines.map((l) => skuFor(l.description, index) ?? "");
}

/** Build the index and resolve in one step, for the write paths that compose lines. */
export async function resolveItemSkus(lines: readonly SkuSourceLine[]): Promise<string[]> {
  if (lines.length === 0) return [];
  return skusForLines(lines, await buildCatalogueSkuIndex());
}
