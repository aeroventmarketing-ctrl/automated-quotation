/**
 * The figures on an Inventory row that are CALCULATED, not stored.
 *
 * The owner asked to *"change name, unit, on hand, reserved, available, unit
 * cost, sell price, value and status"*. Three of those have no column of their
 * own — they follow from the others — and, asked how editing them should work,
 * the owner chose **"Recalculate live"**: edit the inputs, and watch Available,
 * Value and Status change in the panel before saving. They can then never
 * disagree with the stock they describe.
 *
 * One definition, used by the page that lists the items and by the edit panel
 * that previews them, so the preview is the row that will appear after Save.
 */

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type StockStatus = "ok" | "low" | "out";

/** Free to issue: on hand less what is held for orders. Can go negative — shown red. */
export function stockAvailable(quantity: number, reserved: number): number {
  return round3(quantity - reserved);
}

/** Stock valuation at cost. */
export function stockValue(quantity: number, unitCost: number): number {
  return round2(quantity * unitCost);
}

/**
 * Out when nothing is on hand; Low at or under the reorder level (when one is
 * set); otherwise OK. Measured on ON HAND, as it always has been — a reserved
 * unit is still on the shelf.
 */
export function stockStatus(quantity: number, reorderLevel: number): StockStatus {
  if (quantity <= 0) return "out";
  if (reorderLevel > 0 && quantity <= reorderLevel) return "low";
  return "ok";
}
