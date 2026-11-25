import { describe, it, expect } from "vitest";
import { stockRowsForLine, itemNameOfLabel } from "./stock-line-match";
import { buildSkuIndex, skuFor } from "./item-sku";

const stock = [
  { id: "12", name: "NIHONBOND #16 (1.2mm)", sku: "CON000472", location: "Plant Warehouse", available: 0 },
  { id: "13", name: "NIHONBOND #16 (1.3mm)", sku: "CON000473", location: "Plant Warehouse", available: 30 },
  { id: "a1", name: "ANGLE BAR 2.0 X 25 X 25", sku: "CON000900", location: "Plant Warehouse", available: 5 },
  { id: "a2", name: "ANGLE BAR 2.0 X 25 X 25", sku: "CON000900", location: "Office", available: 2 },
  { id: "n1", name: "WELDING ROD 6013", sku: null, location: "Plant Warehouse", available: 9 },
];
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("issue from stock — by SKU only", () => {
  it("the owner's line: CON000473 is the 1.3mm, 30 in stock — never the 1.2mm", () => {
    expect(ids(stockRowsForLine("CON000473", stock))).toEqual(["13"]);
    expect(ids(stockRowsForLine(" con000473 ", stock))).toEqual(["13"]);
  });
  it("every location of that SKU, for the location policy to choose", () => {
    expect(ids(stockRowsForLine("CON000900", stock))).toEqual(["a1", "a2"]);
  });
  it("no SKU, or a SKU no stock item carries — no match, never a guess by name", () => {
    expect(stockRowsForLine(null, stock)).toEqual([]);
    expect(stockRowsForLine("", stock)).toEqual([]);
    expect(stockRowsForLine("CON999999", stock)).toEqual([]);
  });
});

describe("itemNameOfLabel — the item a release / receive line names", () => {
  it("drops the quantity and unit in front", () => {
    expect(itemNameOfLabel("3 pc · CONTROL BOX 300 X 250 X 150")).toBe("CONTROL BOX 300 X 250 X 150");
    expect(itemNameOfLabel("3 pcs · IDEC PUSH BUTTON 22MM YW SERIES,FLUSH, 1 NC, RED")).toBe("IDEC PUSH BUTTON 22MM YW SERIES,FLUSH, 1 NC, RED");
    expect(itemNameOfLabel("1.5 m · WIRE · THHN 3.5mm")).toBe("WIRE · THHN 3.5mm");
    expect(itemNameOfLabel("2 · Bolt")).toBe("Bolt");
  });
  it("leaves a label with no quantity in front alone", () => {
    expect(itemNameOfLabel("CONTROL BOX · 300 X 250")).toBe("CONTROL BOX · 300 X 250");
    expect(itemNameOfLabel("Bolt M10 (4 pc)")).toBe("Bolt M10 (4 pc)");
  });
  it("finds the SKU through the item's name — the panel could not with the quantity still on", () => {
    const index = buildSkuIndex({ stock: [{ name: "CONTROL BOX 300 X 250 X 150", sku: "ELE000123" }] });
    expect(skuFor("3 pc · CONTROL BOX 300 X 250 X 150", index)).toBeNull();
    expect(skuFor(itemNameOfLabel("3 pc · CONTROL BOX 300 X 250 X 150"), index)).toBe("ELE000123");
  });
});
