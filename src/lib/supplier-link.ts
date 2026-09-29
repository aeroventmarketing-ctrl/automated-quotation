/**
 * How firmly a product is wired to a supplier.
 *
 * A product's supplier link carries both an id and a company name, and which of
 * the two is doing the work is invisible on screen: the chip reads "IDEAL
 * CONTROLS INCORPORATED" either way. It only becomes visible when someone
 * renames the supplier — and then it is visible as a PO with the wrong company
 * on it.
 *
 * This is what the Products page marks, so the difference can be seen before it
 * costs anyone a purchase order rather than after.
 */
import type { ProductSupplierLink } from "@/lib/products";
import type { Supplier } from "@/lib/suppliers";

export type SupplierLinkState =
  /** Wired by id: the supplier can be renamed and the link still resolves. */
  | "linked"
  /** Only the name matches. It works today and breaks on a rename. */
  | "name-only"
  /** Neither the id nor the name is in the supplier list — already broken. */
  | "unregistered";

const norm = (s: string) => s.trim().toLowerCase();

export function supplierLinkState(
  link: Pick<ProductSupplierLink, "supplierId" | "company">,
  registered: readonly Pick<Supplier, "id" | "company">[],
): SupplierLinkState {
  const id = link.supplierId.trim();
  // An id that no supplier answers to is a DEAD id, not a link — the supplier it
  // pointed at was deleted. Fall through to the name, which may still match.
  if (id && registered.some((s) => s.id.trim() === id)) return "linked";
  if (registered.some((s) => norm(s.company) === norm(link.company))) return "name-only";
  return "unregistered";
}

/** One line for the marker's tooltip. Kept here so the two chip sites agree. */
export const SUPPLIER_LINK_HINT: Record<SupplierLinkState, string> = {
  linked: "",
  "name-only":
    "Matched by company name only — this product was linked by typing the name, not by picking the supplier. It works, but renaming the supplier would break it. Re-pick the supplier below and save to wire it by ID.",
  unregistered:
    "This company is not in the supplier list, so a purchase order can't offer it. Add it under Admin › Suppliers, then re-pick it here.",
};

/**
 * Plan the backfill: fill in the supplier id on every link that can be resolved
 * from the supplier list without guessing.
 *
 * Re-picking one product at a time is the right tool for one product. On a
 * catalogue where 999 of 1,041 links were made before ids were read, it is not a
 * tool at all — hence one pass over the lot.
 *
 * It is deliberately narrow. A link is only wired when **exactly one** supplier
 * carries that company name; nothing else is touched, no link is removed, no
 * price is read or written, and a company that is not in the supplier list is
 * left exactly as it is for a human to deal with. Two registry rows sharing a
 * name is a tie, and a tie is not resolved by picking the first one.
 */
export interface SupplierWiringPlan {
  /** Products to write, with their full new link list. */
  updates: { id: string; suppliers: ProductSupplierLink[] }[];
  /** Links that gained an id. */
  wired: number;
  /** Links whose company is not in the supplier list — a human must add it. */
  unmatched: number;
  /** Links whose company matches two or more suppliers — too ambiguous to wire. */
  ambiguous: number;
  /**
   * Products still carrying an unresolvable link once this has run.
   *
   * Counted in PRODUCTS, not links, because that is the unit the screen reports
   * — the "Name-only links (N)" button counts products, and a report that says
   * "20 left" beside a button that then reads 18 is a report nobody trusts.
   */
  leftoverProducts: number;
}

const sameName = (a: string, b: string) => norm(a) === norm(b);

export function planSupplierWiring(
  products: readonly { id: string; suppliers: ProductSupplierLink[] }[],
  registered: readonly Pick<Supplier, "id" | "company">[],
): SupplierWiringPlan {
  const plan: SupplierWiringPlan = { updates: [], wired: 0, unmatched: 0, ambiguous: 0, leftoverProducts: 0 };
  for (const p of products) {
    let touched = false;
    let leftover = false;
    const next = p.suppliers.map((link) => {
      if (supplierLinkState(link, registered) === "linked") return link;
      const matches = registered.filter((s) => sameName(s.company, link.company));
      if (matches.length === 0) { plan.unmatched++; leftover = true; return link; }
      if (matches.length > 1) { plan.ambiguous++; leftover = true; return link; }
      touched = true;
      plan.wired++;
      // The name is adopted from the supplier list so the two agree exactly —
      // they already matched apart from case and spacing.
      return { ...link, supplierId: matches[0].id, company: matches[0].company };
    });
    if (touched) plan.updates.push({ id: p.id, suppliers: next });
    if (leftover) plan.leftoverProducts++;
  }
  return plan;
}

/** How many of a product's links are less than firmly wired. */
export function weakLinkCount(
  links: readonly Pick<ProductSupplierLink, "supplierId" | "company">[],
  registered: readonly Pick<Supplier, "id" | "company">[],
): number {
  return links.filter((l) => supplierLinkState(l, registered) !== "linked").length;
}
