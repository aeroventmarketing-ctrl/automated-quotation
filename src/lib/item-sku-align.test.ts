import { describe, it, expect } from "vitest";
import { buildSkuIndex } from "./item-sku";
import { lineArticle, realignSkus, checkLineSku, correctSkus } from "./item-sku-align";

const index = buildSkuIndex({
  stock: [
    { name: "WD 40", sku: "CON000041" },
    { name: "DRILL BIT 8.5mm - COBALT", sku: "CON000300" },
    { name: "DRILL BIT 8.5mm", sku: "CON000223" },
    { name: "CUTTING DISC 4\"Ø", sku: "CON000715" },
    { name: "CUTTING OFF BLADE 14\"Ø", sku: "CON000254" },
    { name: "HACKSAW BLADE", sku: "CON000253" },
  ],
});

describe("the article a line names", () => {
  it("plain, To-purchase and Issued-from-stock lines", () => {
    expect(lineArticle("4 pcs · WD 40")).toBe("WD 40");
    expect(lineArticle("[To purchase] 4 pcs · WD 40")).toBe(lineArticle("4 pcs · WD 40"));
    expect(lineArticle("✓ issued from stock · 4 pcs · BELT B-50")).toBe("BELT B-50");
  });
});

// PO-AFBM20260001051: the admin edited two lines' text; their old codes stayed.
describe("after an edit, codes follow the lines — never the positions", () => {
  const oldItems = ["4 pcs · WD 40", "1 pc · DRILL BIT 8.5mm", "30 pcs · CUTTING DISC 4\"Ø", "5 pcs · HACKSAW BLADE"];
  const oldSkus = ["CON000041", "CON000223", "CON000715", "CON000253"];
  it("a changed line is looked up by its new name; unchanged lines keep their code", () => {
    const next = ["4 pcs · WD 40", "1 pc · DRILL BIT 8.5mm - COBALT", "30 pcs · CUTTING DISC 4\"Ø", "5 pcs · CUTTING OFF BLADE 14\"Ø"];
    expect(realignSkus(oldItems, oldSkus, next, index)).toEqual(["CON000041", "CON000300", "CON000715", "CON000254"]);
  });
  it("a deleted line doesn't shift the rest", () => {
    const next = ["4 pcs · WD 40", "30 pcs · CUTTING DISC 4\"Ø", "5 pcs · HACKSAW BLADE"];
    expect(realignSkus(oldItems, oldSkus, next, index)).toEqual(["CON000041", "CON000715", "CON000253"]);
  });
  it("a line the catalogue doesn't know gets no code, not a neighbour's", () => {
    expect(realignSkus(oldItems, oldSkus, ["2 pc · SOMETHING NEW"], index)).toEqual([""]);
  });
  it("duplicates pair up in order", () => {
    expect(realignSkus(["1 pc · X", "1 pc · X"], ["A", "B"], ["1 pc · X", "1 pc · X"], index)).toEqual(["A", "B"]);
  });
});

describe("spotting a wrong code", () => {
  it("a mismatch only when the line's own name gives a different code", () => {
    expect(checkLineSku("1 pc · DRILL BIT 8.5mm - COBALT", "CON000223", index)).toEqual({ status: "mismatch", stored: "CON000223", expected: "CON000300" });
    expect(checkLineSku("1 pc · DRILL BIT 8.5mm - COBALT", "CON000300", index)).toEqual({ status: "ok" });
    expect(checkLineSku("1 pc · NOT IN CATALOGUE", "CON000223", index)).toEqual({ status: "ok" }); // can't tell
    expect(checkLineSku("1 pc · WD 40", "", index)).toEqual({ status: "ok" });
  });
  it("correcting a request fixes only the clear ones", () => {
    const items = ["4 pcs · WD 40", "1 pc · DRILL BIT 8.5mm - COBALT", "5 pcs · CUTTING OFF BLADE 14\"Ø", "1 pc · FREE TEXT"];
    const r = correctSkus(items, ["CON000041", "CON000223", "CON000253", "CON000999"], index);
    expect(r.skus).toEqual(["CON000041", "CON000300", "CON000254", "CON000999"]);
    expect(r.fixed.map((f) => [f.line, f.from, f.to])).toEqual([[1, "CON000223", "CON000300"], [2, "CON000253", "CON000254"]]);
  });
});

describe("the code a line uses", async () => {
  const { effectiveLineSku } = await import("./item-sku-align");
  it("the stored code, the name's code over a contradicting one, the name's when none is stored", () => {
    expect(effectiveLineSku("4 pcs · WD 40", "CON000041", index)).toEqual({ code: "CON000041", mismatch: null });
    expect(effectiveLineSku("1 pc · DRILL BIT 8.5mm - COBALT", "CON000223", index)).toEqual({ code: "CON000300", mismatch: { stored: "CON000223", expected: "CON000300" } });
    expect(effectiveLineSku("4 pcs · WD 40", "", index)).toEqual({ code: "CON000041", mismatch: null });
    expect(effectiveLineSku("1 pc · FREE TEXT", "", index)).toEqual({ code: null, mismatch: null });
  });
});
