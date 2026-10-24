import { describe, it, expect } from "vitest";
import { stockRowsForLine } from "./stock-line-match";

const stock = [
  { id: "12", name: "NIHONBOND #16 (1.2mm)", sku: "CON000472", location: "Plant Warehouse", available: 0 },
  { id: "13", name: "NIHONBOND #16 (1.3mm)", sku: "CON000473", location: "Plant Warehouse", available: 30 },
  { id: "g1", name: "COTTON GLOVES W/ RUBBER", sku: "CON000223", location: "Plant Warehouse", available: 0 },
  { id: "a1", name: "ANGLE BAR 2.0 X 25 X 25", sku: null, location: "Plant Warehouse", available: 5 },
  { id: "a2", name: "ANGLE BAR 2.0 X 25 X 25", sku: null, location: "Office", available: 2 },
];
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("the owner's line — NIHONBOND #16 (1.3mm), 30 in stock", () => {
  it("by its code", () => {
    expect(ids(stockRowsForLine("NIHONBOND #16 (1.3mm) (For angle corner)", "CON000473", stock))).toEqual(["13"]);
  });
  it("by its exact name when no code was carried — never the 1.2mm", () => {
    expect(ids(stockRowsForLine("NIHONBOND #16 (1.3mm) (For angle corner)", null, stock))).toEqual(["13"]);
    expect(ids(stockRowsForLine("NIHONBOND #16 (1.2mm)", null, stock))).toEqual(["12"]);
  });
  it("two items that differ only inside brackets are never guessed between", () => {
    expect(stockRowsForLine("NIHONBOND #16", null, stock)).toEqual([]);
    expect(stockRowsForLine("NIHONBOND #16 (1.5mm)", null, stock)).toEqual([]);
  });
});

describe("what still matches", () => {
  it("a counted zero is still that item", () => {
    expect(ids(stockRowsForLine("COTTON GLOVES W/ RUBBER", "CON000223", stock))).toEqual(["g1"]);
  });
  it("one item kept at several locations — every row, for the location policy to choose", () => {
    expect(ids(stockRowsForLine("ANGLE BAR 2.0 X 25 X 25", null, stock))).toEqual(["a1", "a2"]);
    expect(ids(stockRowsForLine("ANGLE BAR 2.0 X 25 X 25 (black)", null, stock))).toEqual(["a1", "a2"]);
  });
  it("a code nobody has falls back to the name", () => {
    expect(ids(stockRowsForLine("NIHONBOND #16 (1.3mm)", "ZZZ999", stock))).toEqual(["13"]);
  });
});
