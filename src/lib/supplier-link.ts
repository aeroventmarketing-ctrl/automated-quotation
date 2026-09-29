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

/** How many of a product's links are less than firmly wired. */
export function weakLinkCount(
  links: readonly Pick<ProductSupplierLink, "supplierId" | "company">[],
  registered: readonly Pick<Supplier, "id" | "company">[],
): number {
  return links.filter((l) => supplierLinkState(l, registered) !== "linked").length;
}
