import { describe, it, expect } from "vitest";
import { buildOnHandIndex } from "./stock-on-hand";
import { coverForItems, coveredLabel, isCoveredByStock, normUnit, unitsComparable, withoutCovered } from "./stock-covered";
import { ISSUED_FROM_STOCK_PREFIX, TO_PURCHASE_PREFIX, poLinesFromPRItems } from "./purchase-order";

const on = (available: number, unit = "pc") => ({ available, unit, places: 1 });

describe("a line free stock covers is not purchased", () => {
  it("requested below free stock → covered; equal or above → purchased (the owner's 'greater or equal')", () => {
    expect(isCoveredByStock(2, "pc", on(5))).toBe(true);
    expect(isCoveredByStock(5, "pc", on(5))).toBe(false);
    expect(isCoveredByStock(10, "pc", on(4))).toBe(false);
  });
  it("never hides a line on a guess: no stock item, unreadable quantity, or different units", () => {
    expect(isCoveredByStock(1, "pc", null)).toBe(false);
    expect(isCoveredByStock(0, "pc", on(5))).toBe(false);
    expect(isCoveredByStock(NaN, "pc", on(5))).toBe(false);
    expect(isCoveredByStock(2, "sheet", on(50, "kg"))).toBe(false);
  });
  it("reads pc / pcs / PCS. as one unit, and a blank side as comparable", () => {
    expect(normUnit("PCS.")).toBe("pc");
    expect(normUnit("glass")).toBe("glass");
    expect(unitsComparable("pcs", "pc")).toBe(true);
    expect(unitsComparable("", "kg")).toBe(true);
    expect(unitsComparable("set", "pc")).toBe(false);
  });
});

describe("per request", () => {
  const index = buildOnHandIndex([
    { name: "Bolt", sku: "B1", unit: "pc", available: 100 },
    { name: "Motor", sku: "M1", unit: "unit", available: 1 },
  ]);
  const items = [
    "20 pc · Bolt",
    `${TO_PURCHASE_PREFIX}2 unit · Motor`,
    `${ISSUED_FROM_STOCK_PREFIX}5 pc · Bolt`,
    "3 pc · Washer",
  ];
  const codes = ["B1", "M1", "B1", null];

  it("covers the bolt (20 < 100), buys the motor (2 ≥ 1) and the uncatalogued washer, ignores the issued record", () => {
    const c = coverForItems(items, codes, index);
    expect(c.covered).toEqual([true, false, false, false]);
    expect(c.purchasable).toBe(2);
    expect(c.stock[0]).toMatchObject({ available: 100 });
  });

  it("drafts the PO without the covered line, SKUs still aligned", () => {
    const c = coverForItems(items, codes, index);
    const kept = withoutCovered(items, ["B1", "M1", "B1", ""], c.covered);
    const lines = poLinesFromPRItems(kept.items, kept.skus);
    expect(lines.map((l) => [l.description, l.qty, l.sku ?? ""])).toEqual([["Motor", "2", "M1"], ["Washer", "3", ""]]);
  });

  it("comes back on its own when free stock falls to the requested quantity", () => {
    const low = buildOnHandIndex([{ name: "Bolt", sku: "B1", unit: "pc", available: 20 }]);
    expect(coverForItems(["20 pc · Bolt"], ["B1"], low).covered).toEqual([false]);
  });

  it("says so on the chip", () => {
    expect(coveredLabel(on(12))).toBe("Covered by stock — 12 pc free · not purchased");
    expect(coveredLabel(on(2.5, ""))).toBe("Covered by stock — 2.5 free · not purchased");
  });
});
