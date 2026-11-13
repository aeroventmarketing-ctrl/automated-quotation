import { describe, it, expect } from "vitest";
import { describeMove, highestSupplierPrice, planStockCost, supplierPriceMoves, unitsAgree } from "./supplier-cost-sync";

const s = (company: string, price?: number) => ({ supplierId: "", company, price });
const TKL = "TKL Steel";
const MEX = "Metal Exponent";

describe("supplier price moves", () => {
  it("lists only the suppliers whose price moved, new and removed ones included", () => {
    const moves = supplierPriceMoves([s(TKL, 3800), s(MEX, 3800), s("Old Co", 3700)], [s(TKL, 3865), s(MEX, 3800), s("New Co", 3900)]);
    expect(moves).toEqual([
      { company: TKL, from: 3800, to: 3865 },
      { company: "New Co", from: null, to: 3900 },
      { company: "Old Co", from: 3700, to: null },
    ]);
  });
  it("matches suppliers by name, any case or spacing", () => {
    expect(supplierPriceMoves([s("tkl steel ", 3800)], [s(TKL, 3800)])).toEqual([]);
  });
  it("reads each move as the owner would", () => {
    expect(describeMove({ company: TKL, from: 3800, to: 3865 })).toBe("TKL Steel ₱3,800 → ₱3,865");
    expect(describeMove({ company: "New Co", from: null, to: 3900.5 })).toBe("New Co (new) ₱3,900.5");
    expect(describeMove({ company: "Old Co", from: 3700, to: null })).toBe("Old Co removed (was ₱3,700)");
  });
});

describe("the item's unit cost after a supplier price change", () => {
  it("is the highest supplier price (MS PLATE 3/16\": TKL ₱3,865 vs Metal Exponent ₱3,800)", () => {
    expect(highestSupplierPrice([s(TKL, 3865), s(MEX, 3800), s("Unpriced")])).toBe(3865);
    const plan = planStockCost({ unit: "pcs", unitCost: 3800 }, { unit: "pcs" }, [s(TKL, 3800), s(MEX, 3800)], [s(TKL, 3865), s(MEX, 3800)]);
    expect(plan).toEqual({ newUnitCost: 3865, note: "Supplier price: TKL Steel ₱3,800 → ₱3,865 · unit cost = highest supplier price (₱3,865)" });
  });
  it("still records the row when the highest was already the cost", () => {
    const plan = planStockCost({ unit: "pcs", unitCost: 3865 }, { unit: "pcs" }, [s(TKL, 3865), s(MEX, 3700)], [s(TKL, 3865), s(MEX, 3800)]);
    expect(plan?.newUnitCost).toBe(3865);
    expect(plan?.note).toMatch(/already the highest/);
  });
  it("is nothing at all when no supplier price moved (a rename, a note)", () => {
    expect(planStockCost({ unit: "pcs", unitCost: 1 }, { unit: "pcs" }, [s(TKL, 3800)], [s(TKL, 3800)])).toBeNull();
  });
  it("keeps the cost when the units differ — a per-kg price is not a per-sheet cost", () => {
    const plan = planStockCost({ unit: "sheet", unitCost: 3800 }, { unit: "kg" }, [s(TKL, 80)], [s(TKL, 85)]);
    expect(plan?.newUnitCost).toBeNull();
    expect(plan?.note).toMatch(/unit cost kept — Products prices per kg, Inventory counts in sheet/);
  });
  it("keeps the cost when every supplier price was cleared", () => {
    expect(planStockCost({ unit: "pcs", unitCost: 3800 }, { unit: "pcs" }, [s(TKL, 3800)], [s(TKL)])?.newUnitCost).toBeNull();
  });
  it("treats blank units as pcs, any case", () => {
    expect(unitsAgree("", "PCS")).toBe(true);
    expect(unitsAgree("pc", "pcs")).toBe(false);
  });
});
