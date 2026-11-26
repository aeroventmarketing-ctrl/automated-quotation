import { describe, expect, it } from "vitest";
import { remapToHeldRows } from "./awaiting-delivery";

describe("remapToHeldRows — Receive confirms the held row of the same SKU", () => {
  const rows = [{ id: "office", sku: "CON1" }, { id: "plant", sku: "con1" }, { id: "other", sku: "CON2" }, { id: "nosku", sku: null }];
  it("moves a match on the Plant row onto the held Office row", () => {
    expect(remapToHeldRows([{ stockItemId: "plant", qty: 3 }], ["office"], rows)).toEqual([{ stockItemId: "office", qty: 3 }]);
  });
  it("leaves held rows, other SKUs and rows with no SKU alone", () => {
    const m = [{ stockItemId: "office", qty: 1 }, { stockItemId: "other", qty: 1 }, { stockItemId: "nosku", qty: 1 }];
    expect(remapToHeldRows(m, ["office"], rows)).toEqual(m);
  });
});
