import { describe, it, expect } from "vitest";
import { approvalSigners, maskPriceEntry, pctChange, priceHistoryFromApprovals, pricesDiffer, type AppliedEdit, type PriceHistoryEntry } from "./price-history";

const edit = (id: string, at: string, unitCost: number, sellPrice: number, extra: Partial<AppliedEdit> = {}): AppliedEdit => ({
  id,
  stockItemId: "item1",
  itemName: "Nihonbond #16",
  payload: { category: null, location: "Plant Warehouse", reorderLevel: 0, unitCost, sellPrice },
  proposedByName: "Wena (Warehouse)",
  warehouseByName: "Wena (Warehouse)",
  purchaserByName: "Rey (Purchaser)",
  approverByName: "Ana (Payment Approver)",
  appliedAt: at,
  ...extra,
});

describe("price change detection", () => {
  it("compares to the centavo", () => {
    expect(pricesDiffer({ unitCost: 100, sellPrice: 150 }, { unitCost: 100.001, sellPrice: 150 })).toBe(false);
    expect(pricesDiffer({ unitCost: 100, sellPrice: 150 }, { unitCost: 100, sellPrice: 155 })).toBe(true);
  });
  it("percent change", () => {
    expect(pctChange(100, 112)).toBe(12);
    expect(pctChange(200, 150)).toBe(-25);
    expect(pctChange(null, 150)).toBeNull();
    expect(pctChange(0, 150)).toBeNull();
  });
});

describe("approved by", () => {
  it("the signers in order, without the proposer, once each", () => {
    expect(approvalSigners("Wena", ["Wena", "Rey", "Ana", "Ana"])).toBe("Rey, Ana");
  });
  it("nobody else signed — the price owner applied their own", () => {
    expect(approvalSigners("Ana", [null, null, "Ana", "Ana"])).toBeNull();
  });
});

describe("history rebuilt from approved Edit requests", () => {
  it("keeps only the edits that moved a price, each with the price before it", () => {
    const rows = priceHistoryFromApprovals(
      [
        edit("e3", "2026-09-10T02:00:00Z", 120, 180),
        edit("e1", "2026-08-01T02:00:00Z", 100, 150),
        // A location-only edit — prices unchanged — is not a price movement.
        edit("e2", "2026-08-20T02:00:00Z", 100, 150),
      ],
      new Set(),
      () => "10234",
    );
    expect(rows.map((r) => r.id)).toEqual(["approval:e1", "approval:e3"]);
    expect(rows[0]).toMatchObject({ oldUnitCost: null, newUnitCost: 100, oldSellPrice: null, newSellPrice: 150, sku: "10234", fromApprovals: true });
    expect(rows[1]).toMatchObject({
      oldUnitCost: 100, newUnitCost: 120, oldSellPrice: 150, newSellPrice: 180,
      source: "approval", byName: "Wena (Warehouse)", approvedByName: "Rey (Purchaser), Ana (Payment Approver)",
      at: "2026-09-10T02:00:00.000Z",
    });
  });
  it("an edit already in the log isn't shown twice, but still counts as the price before the next", () => {
    const rows = priceHistoryFromApprovals([edit("e1", "2026-08-01T00:00:00Z", 100, 150), edit("e2", "2026-09-01T00:00:00Z", 110, 150)], new Set(["e1"]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "approval:e2", oldUnitCost: 100, newUnitCost: 110 });
  });
  it("separate items keep separate chains; unreadable edits are skipped", () => {
    const rows = priceHistoryFromApprovals(
      [edit("a", "2026-08-01T00:00:00Z", 10, 20), edit("b", "2026-08-02T00:00:00Z", 30, 40, { stockItemId: "item2" }), edit("c", "2026-08-03T00:00:00Z", 0, 0, { payload: null }), edit("d", "", 1, 1, { appliedAt: null })],
      new Set(),
    );
    expect(rows.map((r) => [r.stockItemId, r.oldUnitCost])).toEqual([["item1", null], ["item2", null]]);
  });
});

describe("what a viewer may see", () => {
  const e: PriceHistoryEntry = {
    id: "x", stockItemId: "i", itemName: "n", sku: null, at: "", source: "direct", byName: "A", approvedByName: null, note: null, fromApprovals: false,
    oldUnitCost: 100, newUnitCost: 100, oldSellPrice: 150, newSellPrice: 160,
  };
  it("everything to those who see both prices", () => {
    expect(maskPriceEntry(e, { cost: true, sell: true })).toEqual(e);
  });
  it("a sell-price-only change is hidden from those who see the cost alone (Purchaser, Warehouse, Accounting)", () => {
    expect(maskPriceEntry(e, { cost: true, sell: false })).toBeNull();
    const costMoved = { ...e, newUnitCost: 110 };
    expect(maskPriceEntry(costMoved, { cost: true, sell: false })).toMatchObject({ newUnitCost: 110, oldSellPrice: null, newSellPrice: 0 });
  });
  it("nothing to those who see no prices", () => {
    expect(maskPriceEntry(e, { cost: false, sell: false })).toBeNull();
  });
});
