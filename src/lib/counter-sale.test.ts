import { describe, it, expect } from "vitest";
import { adhocLines, hasAdhocLines } from "./counter-sale";

/**
 * The owner: *"Counter sales transaction — item doesn't deduct on inventory
 * record."*
 *
 * The deduction itself is correct — `completeCounterSale` issues stock for every
 * line that carries a `stockItemId`. The trap is that the item picker DEFAULTS
 * to *"Ad-hoc / Not In Inventory"*, so a line whose name was typed into the
 * description box beside it never links to stock, sells the goods, and leaves
 * the on-hand untouched without a word.
 */
describe("the lines that bypass the warehouse", () => {
  const line = (description: string, stockItemId: string | null) => ({ stockItemId, description, qty: 1 });

  it("names the lines that will not be deducted", () => {
    const items = [
      line("BELT B-50", "stock-1"),
      line("Courier charge", null),
      line("GI SHEET 24GA", "stock-2"),
      line("Custom bracket", null),
    ];
    expect(adhocLines(items).map((i) => i.description)).toEqual(["Courier charge", "Custom bracket"]);
    expect(hasAdhocLines(items)).toBe(true);
  });

  it("says nothing when every line came from stock", () => {
    const items = [line("BELT B-50", "stock-1"), line("GI SHEET 24GA", "stock-2")];
    expect(adhocLines(items)).toEqual([]);
    expect(hasAdhocLines(items)).toBe(false);
  });

  /**
   * An empty string is what a form sends for "nothing picked", and it must count
   * as unlinked — a falsy id that slipped through as "linked" would promise a
   * deduction that `completeCounterSale` never performs.
   */
  it("treats an empty id as unlinked, exactly as the server does", () => {
    for (const id of [null, undefined, ""]) {
      expect(hasAdhocLines([line("typed in", id as string | null)]), String(id)).toBe(true);
    }
  });

  it("says nothing about a sale with no lines at all", () => {
    expect(hasAdhocLines([])).toBe(false);
    expect(adhocLines([])).toEqual([]);
  });
});
