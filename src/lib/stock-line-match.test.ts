import { describe, it, expect } from "vitest";
import { stockRowsForLine } from "./stock-line-match";

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
