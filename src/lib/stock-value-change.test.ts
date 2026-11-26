import { describe, expect, it } from "vitest";
import { stockValueChange, movementCause } from "./stock-value-change";
import { remapToHeldRows } from "./awaiting-delivery";

const since = new Date("2026-11-25T00:00:00+08:00");
const item = (id: string, qty: number, cost: number, created = "2026-01-01") => ({ id, name: id, sku: null, unit: "pc", location: null, quantity: qty, unitCost: cost, createdAt: created });

describe("stockValueChange", () => {
  it("rebuilds the earlier value and splits the change into causes and re-pricing", () => {
    const r = stockValueChange(
      [item("motor", 12, 30000), item("wire", 100, 50), item("belt", 5, 200)],
      [
        { stockItemId: "motor", kind: "RECEIPT", delta: 12, reason: "Bought — PO-1 (Cash & Check Released) · not usable until Receive & Add Stock", createdAt: "2026-11-25T03:00:00Z" },
        { stockItemId: "belt", kind: "ISSUE", delta: -2, reason: "MRF #0700", createdAt: "2026-11-25T04:00:00Z" },
        { stockItemId: "belt", kind: "RECEIPT", delta: 1, reason: "old", createdAt: "2026-11-20T04:00:00Z" }, // before: ignored
      ],
      [{ stockItemId: "wire", oldUnitCost: 5, newUnitCost: 50, source: "supplier", createdAt: "2026-11-25T05:00:00Z" }],
      since,
    );
    // then: motor 0, wire 100×5 = 500, belt 7×200 = 1400 → 1,900; now 360,000 + 5,000 + 1,000 = 366,000
    expect(r.valueThen).toBe(1900);
    expect(r.valueNow).toBe(366000);
    expect(r.change).toBe(364100);
    expect(r.costEffect).toBe(4500);
    expect(r.byCause).toEqual([
      { cause: "Bought — added at Cash & Check Released (not usable yet)", value: 360000, count: 1 },
      { cause: "Issued on MRF", value: -400, count: 1 },
    ]);
    expect(r.items[0]).toMatchObject({ id: "motor", qtyThen: 0, qtyNow: 12, change: 360000 });
    expect(r.items.find((i) => i.id === "wire")).toMatchObject({ costThen: 5, costNow: 50, costEffect: 4500, priceSources: ["supplier"] });
  });

  it("an item created since is new value in full; untouched items are left out", () => {
    const r = stockValueChange([item("new", 3, 100, "2026-11-25T06:00:00Z"), item("same", 10, 10)], [], [], since);
    expect(r.items.map((i) => i.id)).toEqual(["new"]);
    expect(r.newItemsValue).toBe(300);
    expect(r.valueThen).toBe(100);
  });

  it("names the causes in words", () => {
    expect(movementCause("RECEIPT", "Purchase received")).toBe("Purchase received");
    expect(movementCause("RECEIPT", "Purchase received early (goods arrived) — PO-1")).toBe("Received from purchases (early)");
    expect(movementCause("ISSUE", "PO-1 — not delivered; bought stock taken back out")).toBe("Bought stock taken back out (not delivered / rolled back)");
  });
});

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
