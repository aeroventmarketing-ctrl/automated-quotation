import { describe, it, expect } from "vitest";
import { adhocLines, hasAdhocLines, unlinkedCounterLines, unlinkedCounterLineMessage } from "./counter-sale";

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

/**
 * *"Counter sales not deducting quantity in inventory tab."*
 *
 * The deduction was never broken. What was broken is that a line did not have to
 * name an inventory item — the picker's default was "Ad-hoc / Not In Inventory",
 * so a sale rung up without touching that dropdown moved no stock at all, on a
 * page that promises *"stock is deducted after you complete the sale."*
 *
 * Offered three ways to close it, the owner chose the strictest: a counter sale
 * can only sell things that exist in inventory.
 */
describe("every counter-sale line is an inventory item", () => {
  it("a linked line is fine", () => {
    expect(unlinkedCounterLines([{ stockItemId: "stk-1", description: "GI SHEET 24GA" }])).toEqual([]);
  });

  it("names the lines that would sell nothing out of the warehouse", () => {
    expect(unlinkedCounterLines([
      { stockItemId: "stk-1", description: "GI SHEET 24GA" },
      { stockItemId: null, description: "Delivery charge" },
      { description: "Labour" },
    ])).toEqual(["Delivery charge", "Labour"]);
  });

  /** An empty string is not an id — the "choose an item" state of the picker. */
  it("an unset picker is not a link", () => {
    expect(unlinkedCounterLines([{ stockItemId: "", description: "GI SHEET" }])).toEqual(["GI SHEET"]);
  });

  it("a nameless line can still be pointed at", () => {
    expect(unlinkedCounterLines([{ stockItemId: null, description: "  " }])).toEqual(["line 1"]);
  });

  describe("what the person reads", () => {
    it("says nothing when there is nothing to say", () => {
      expect(unlinkedCounterLineMessage([])).toBe("");
    });
    it("names the offending lines and where to fix it", () => {
      const m = unlinkedCounterLineMessage(["Delivery charge", "Labour"]);
      expect(m).toContain("Delivery charge, Labour");
      expect(m).toContain("add it in Inventory first");
    });
    it("does not recite a hundred of them", () => {
      const m = unlinkedCounterLineMessage(["a", "b", "c", "d", "e", "f"]);
      expect(m).toContain("a, b, c, d, and 2 more");
    });
  });
});
