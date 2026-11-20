import { describe, it, expect } from "vitest";
import { awaitingMessage, awaitingRef, isAwaitingRef, isShortDeliveryLeftover, planCashReleaseAdds, planConfirm, poRefOfAwaiting, SHORT_DELIVERY_MARK } from "./awaiting-delivery";
import { TO_PURCHASE_PREFIX, ISSUED_FROM_STOCK_PREFIX } from "./purchase-order";

const stock = [
  { id: "plate", sku: "CON000755", unit: "pc", location: "Plant Warehouse" },
  { id: "bolt-plant", sku: "B1", unit: "pcs", location: "Plant Warehouse" },
  { id: "bolt-office", sku: "B1", unit: "pcs", location: "Office" },
  { id: "wire", sku: "W1", unit: "kg", location: "Plant Warehouse" },
];
const member = (items: string[], skus: string[], extra: Partial<{ dept: string | null; skip: boolean }> = {}) => ({ items, skus, dept: "fans", skip: false, ...extra });

describe("the hold's tag", () => {
  it("names the PO, and reads back", () => {
    const ref = awaitingRef("PO-AFBM20260001114");
    expect(isAwaitingRef(ref)).toBe(true);
    expect(isAwaitingRef("AFBM-JO2600054")).toBe(false);
    expect(poRefOfAwaiting(ref)).toBe("PO-AFBM20260001114");
  });
  it("tells everyone what it is waiting on", () => {
    expect(awaitingMessage(10, "pc", ["PO-1", "PO-1"])).toBe("10 pc not usable yet — awaiting the Warehouseman's Receive & Add Stock (PO-1)");
    expect(isShortDeliveryLeftover(`x · ${SHORT_DELIVERY_MARK} 8 received`)).toBe(true);
  });
});

describe("Cash & Check Released: what goes into stock", () => {
  it("adds a line by its own SKU, or the SKU of the request line it was drafted from", () => {
    const adds = planCashReleaseAdds(
      [
        { description: 'MS PLATE 3/16" (4.0mm)', qty: "10", unit: "pc", sku: "CON000755" },
        { description: "HEX BOLT M10", qty: "20", unit: "pc" },
      ],
      [member(['10 pc · MS PLATE 3/16" (4.0mm)', `${TO_PURCHASE_PREFIX}20 pc · HEX BOLT M10`], ["", "B1"])],
      stock,
    );
    expect(adds).toEqual([
      { stockItemId: "plate", qty: 10, lines: ['MS PLATE 3/16" (4.0mm)'] },
      { stockItemId: "bolt-plant", qty: 20, lines: ["HEX BOLT M10"] },
    ]);
  });
  it("routes a SKU stocked in two places by the requesting department, as Receive does", () => {
    const adds = planCashReleaseAdds([{ description: "HEX BOLT M10", qty: 5, unit: "pcs", sku: "B1" }], [member(["5 pcs · HEX BOLT M10"], ["B1"], { dept: "office" })], stock);
    expect(adds[0].stockItemId).toBe("bolt-office");
  });
  it("leaves to Receive anything uncertain: no SKU, unknown SKU, other units, unreadable quantity", () => {
    expect(
      planCashReleaseAdds(
        [
          { description: "NO CODE ITEM", qty: 1, unit: "pc" },
          { description: "UNKNOWN", qty: 1, unit: "pc", sku: "ZZZ" },
          { description: "WIRE", qty: 2, unit: "roll", sku: "W1" },
          { description: "PLATE", qty: "", unit: "pc", sku: "CON000755" },
        ],
        [member([], [])],
        stock,
      ),
    ).toEqual([]);
  });
  it("never adds an Office bought-in requisition — it goes to the client, not the shelf", () => {
    expect(planCashReleaseAdds([{ description: "PLATE", qty: 1, unit: "pc", sku: "CON000755" }], [member(["1 pc · PLATE"], ["CON000755"], { skip: true })], stock)).toEqual([]);
  });
  it("sums two lines for the same item, and ignores issued-from-stock records", () => {
    const adds = planCashReleaseAdds(
      [
        { description: "PLATE A", qty: 2, unit: "pc", sku: "CON000755" },
        { description: "PLATE B", qty: 3, unit: "pc", sku: "CON000755" },
      ],
      [member([`${ISSUED_FROM_STOCK_PREFIX}4 pc · PLATE A`], ["CON000755"])],
      stock,
    );
    expect(adds).toEqual([{ stockItemId: "plate", qty: 5, lines: ["PLATE A", "PLATE B"] }]);
  });
});

describe("Receive & Add Stock: confirming", () => {
  const holds = [
    { id: "h1", stockItemId: "plate", qty: 10, createdAt: "2026-11-20T01:00:00Z" },
    { id: "h2", stockItemId: "bolt-plant", qty: 20, createdAt: "2026-11-20T01:00:00Z" },
  ];
  it("a full delivery releases the holds and adds nothing a second time", () => {
    expect(planConfirm([{ stockItemId: "plate", qty: 10 }, { stockItemId: "bolt-plant", qty: 20 }], holds)).toEqual({
      adds: [],
      release: ["h1", "h2"],
      reduce: [],
      confirmed: [{ stockItemId: "plate", qty: 10 }, { stockItemId: "bolt-plant", qty: 20 }],
    });
  });
  it("a short delivery keeps the missing quantity held (8 of 10 → 2 still not usable)", () => {
    const p = planConfirm([{ stockItemId: "plate", qty: 8 }, { stockItemId: "bolt-plant", qty: 20 }], holds);
    expect(p.reduce).toEqual([{ id: "h1", to: 2 }]);
    expect(p.release).toEqual(["h2"]);
    expect(p.adds).toEqual([]);
  });
  it("adds only what was never added — extra quantity, or an item with no hold", () => {
    const p = planConfirm([{ stockItemId: "plate", qty: 12 }, { stockItemId: "wire", qty: 5 }], holds);
    expect(p.adds).toEqual([{ stockItemId: "plate", qty: 2 }, { stockItemId: "wire", qty: 5 }]);
    expect(p.release).toEqual(["h1"]);
    expect(p.reduce).toEqual([]); // h2 untouched: nothing of it arrived
  });
  it("with no holds (a PO from before, or nothing matched) Receive works exactly as before", () => {
    expect(planConfirm([{ stockItemId: "plate", qty: 3 }], []).adds).toEqual([{ stockItemId: "plate", qty: 3 }]);
  });
});
