import { describe, it, expect } from "vitest";
import { catalogueNameSet, unknownCatalogueItems, unknownItemsMessage } from "./catalogue-items";

const CATALOGUE = [
  { name: "GI SHEET 24GA" },
  { name: 'G.I. BOLT 3/8"Ø x 1" length' },
  { name: "COTTON GLOVES W/ RUBBER" },
];

/**
 * The owner: *"In requisitions, disallow editing in articles/description to all
 * roles including the purchaser role… Let all roles choose from drop down only."*
 *
 * The forms already refused an unknown item and the picker now has no text input
 * to type one into — but both are the browser's opinion. This is the rule.
 */
describe("an item has to be a product that exists", () => {
  it("accepts what the catalogue holds, however it was typed", () => {
    expect(unknownCatalogueItems(["GI SHEET 24GA", "  gi sheet 24ga  "], CATALOGUE)).toEqual([]);
  });

  it("names the ones it has never heard of, in the order given", () => {
    expect(unknownCatalogueItems(["GI SHEET 24GA", "MADE UP ITEM", "ANOTHER ONE"], CATALOGUE))
      .toEqual(["MADE UP ITEM", "ANOTHER ONE"]);
  });

  it("ignores empty rows rather than calling them unknown", () => {
    expect(unknownCatalogueItems(["", "   ", "GI SHEET 24GA"], CATALOGUE)).toEqual([]);
  });

  /**
   * A near miss is a miss. The punctuation and the inch marks ARE the item, and
   * quietly accepting a close-enough string is how a catalogue stops meaning
   * anything.
   */
  it("does not accept a near miss", () => {
    expect(unknownCatalogueItems(["GI SHEET 24", "GI SHEET 24GA x 10", "GI SHEET"], CATALOGUE))
      .toEqual(["GI SHEET 24", "GI SHEET 24GA x 10", "GI SHEET"]);
  });

  /**
   * A catalogue that failed to load must not become "nothing is a valid item",
   * which would refuse every requisition in the company over a transient
   * database error. The picker says the same at the other end: with nothing to
   * choose from it stays shut rather than accepting text.
   */
  it("says nothing when there is no catalogue to judge against", () => {
    expect(unknownCatalogueItems(["ANYTHING AT ALL"], [])).toEqual([]);
    expect(catalogueNameSet([]).size).toBe(0);
  });

  it("ignores a blank name in the catalogue rather than matching every empty row to it", () => {
    expect(catalogueNameSet([{ name: "  " }, { name: "REAL" }])).toEqual(new Set(["real"]));
  });

  it("names the items in the message, so nobody has to hunt for the bad row", () => {
    expect(unknownItemsMessage(["MADE UP ITEM"])).toContain("This item is");
    expect(unknownItemsMessage(["A", "B"])).toContain("These items are");
    expect(unknownItemsMessage(["A", "B"])).toContain("A, B");
    expect(unknownItemsMessage(["A"])).toContain("dropdown");
  });
});
