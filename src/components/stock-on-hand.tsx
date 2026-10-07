import type { OnHand } from "@/lib/stock-on-hand";

/** `2`, `2.5`, `0` — never `2.000`. */
const fmtQty = (n: number): string => String(Math.round(n * 1000) / 1000);

/**
 * How many of this item the warehouse has, beside the item — the owner's *"show
 * the available quantity in each row … show 0 in stock if no stock is available
 * or 2 in stock if 2 items is available."*
 *
 * Three states, and the third is the point: **null is not zero**. An item the
 * inventory list has never heard of is a different fact from an item with none
 * left, and saying "0 in stock" for both would quietly claim the warehouse was
 * asked and answered. Both still mean "this has to be bought", so the row reads
 * the same way at a glance — it is the hover, and the colour, that separate a
 * counted zero from an unanswered question.
 */
export function StockOnHand({ on }: { on: OnHand | null }) {
  if (!on) {
    return (
      <span
        className="ml-2 whitespace-nowrap rounded border border-dashed px-1.5 py-0.5 text-[10px] text-muted-foreground"
        title="No inventory item matches this line — so there is no stock figure for it, which is not the same as a counted zero."
      >
        Not in inventory
      </span>
    );
  }
  const empty = on.available <= 0;
  return (
    <span
      className={`ml-2 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ${
        empty ? "bg-red-500/10 text-red-700 dark:text-red-400" : "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400"
      }`}
      title={
        `Free to issue now — on hand minus active reservations${on.places > 1 ? `, across ${on.places} locations` : ""}.` +
        " From the Inventory tab."
      }
    >
      {fmtQty(on.available)}{on.unit ? ` ${on.unit}` : ""} in stock
    </span>
  );
}
