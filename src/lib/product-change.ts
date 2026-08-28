/**
 * A product add / save / delete waiting on the catalogue price owner.
 *
 * Why Products needs this and Inventory did not: Inventory already held every
 * per-row edit in a double handshake (`lib/stock-action`), so the price owner
 * only had to join it as a third party. The Products **Save** button wrote
 * straight through — and the supplier price lives *inside* the product record,
 * so that button is one keystroke from the figure a purchase order defaults to.
 *
 * The change is parked whole rather than stripped. `price-authority` already
 * drops prices a proposer may not set; doing only that would mean a Purchaser
 * who spots a wrong price has no way to say so, and a save that silently loses
 * half of what was typed. Parking it keeps the proposal intact and hands the
 * decision to the person who owns it.
 *
 * Types + view helpers only — the writes live in the Products server actions.
 */
import type { ProductChangeKind, ProductChangeStatus } from "@prisma/client";
import type { ProductSupplierLink } from "@/lib/products";

/** The proposed product, as typed. `id` is absent on a CREATE. */
export interface ProductChangePayload {
  name: string;
  unit: string;
  category: string | null;
  note: string | null;
  suppliers: ProductSupplierLink[];
}

/** The row the Products page renders. */
export interface ProductChangeView {
  id: string;
  productId: string | null;
  productName: string;
  kind: ProductChangeKind;
  kindLabel: string;
  status: ProductChangeStatus;
  summary: string;
  /** Field-by-field before → after, empty on a CREATE or DELETE. */
  diff: { field: string; before: string; after: string }[];
  /** The proposal changes a supplier price — the reason this queue exists. */
  touchesPrice: boolean;
  proposedByName: string;
  proposedAt: string;
  /** Whether the viewer may confirm or reject it. */
  canDecide: boolean;
  /** Whether the viewer is the person who proposed it. */
  mine: boolean;
}

export const PRODUCT_CHANGE_LABEL: Record<ProductChangeKind, string> = {
  CREATE: "New product",
  UPDATE: "Product edit",
  DELETE: "Product removal",
};

const peso = (n: number) => "₱" + new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/** One supplier rendered for the eye: "WINGS (B50) ₱210". */
const supplierText = (s: ProductSupplierLink): string =>
  `${s.company}${s.code ? ` (${s.code})` : ""}${typeof s.price === "number" && s.price > 0 ? ` ${peso(s.price)}` : ""}`;

const suppliersText = (list: ProductSupplierLink[]): string =>
  list.length === 0 ? "—" : list.map(supplierText).join("; ");

/** A one-line human snapshot, stored with the change so it reads the same later. */
export function productChangeSummary(kind: ProductChangeKind, payload: ProductChangePayload): string {
  if (kind === "DELETE") return `Remove ${payload.name}`;
  const bits = [
    payload.unit ? `unit ${payload.unit}` : null,
    payload.category ? `category ${payload.category}` : null,
    `suppliers ${suppliersText(payload.suppliers)}`,
  ].filter(Boolean);
  return `${kind === "CREATE" ? "Add" : "Edit"} ${payload.name}: ${bits.join(", ")}`;
}

/**
 * Field-by-field before → after, so the reviewer confirms a change and not just
 * a name. Only fields that actually differ are listed; the suppliers line is
 * compared as its rendered text, which is what the reviewer is judging anyway
 * (a reordered list with the same prices is not a change worth showing).
 */
export function productChangeDiff(
  before: ProductChangePayload | null,
  after: ProductChangePayload,
): { field: string; before: string; after: string }[] {
  if (!before) return [];
  const rows: { field: string; before: string; after: string }[] = [];
  const add = (field: string, b: string, a: string) => {
    if (b !== a) rows.push({ field, before: b || "—", after: a || "—" });
  };
  add("Name", before.name, after.name);
  add("Unit", before.unit, after.unit);
  add("Category", before.category ?? "", after.category ?? "");
  add("Note", before.note ?? "", after.note ?? "");
  add("Suppliers", suppliersText(before.suppliers), suppliersText(after.suppliers));
  return rows;
}

/**
 * Whether a proposal actually touches a price — the reason this queue exists.
 * A change that only renames an item is still confirmed by the owner (they own
 * the record they are releasing), but the queue flags the priced ones so a long
 * list can be read at a glance.
 */
export function productChangeTouchesPrice(before: ProductChangePayload | null, after: ProductChangePayload): boolean {
  const priced = (list: ProductSupplierLink[]) =>
    list
      .filter((s) => typeof s.price === "number" && s.price > 0)
      .map((s) => `${s.company.trim().toLowerCase()}=${s.price}`)
      .sort()
      .join("|");
  if (!before) return priced(after.suppliers) !== "";
  return priced(before.suppliers) !== priced(after.suppliers);
}
