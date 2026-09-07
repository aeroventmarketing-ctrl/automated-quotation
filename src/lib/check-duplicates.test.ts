import { describe, it, expect } from "vitest";
import { otherPurchaseOrdersWithCheck, purchaseOrderKey, type CheckHolder } from "./check-duplicates";

const row = (over: Partial<CheckHolder> = {}): CheckHolder => ({
  id: "pr1", poNumber: "PO-AFBM20260000609", batchId: null, status: "CASH_RELEASED", checkNos: [], ...over,
});

const CHECK = "0000486718";
const MINE = { id: "pr1", poNumber: "PO-AFBM20260000609", batchId: null };

/**
 * The owner, on a live PO: *"check the error Check No. 0000486718 is already
 * recorded on another purchase order."*
 */
describe("whether a check really is on ANOTHER purchase order", () => {
  it("says so when a different PO carries the same number", () => {
    const rows = [row({ checkNos: [CHECK] }), row({ id: "pr2", poNumber: "PO-AFBM20260000610", checkNos: [CHECK] })];
    expect(otherPurchaseOrdersWithCheck(CHECK, MINE, rows)).toEqual(["PO-AFBM20260000610"]);
  });

  /**
   * The bug. `purchase-batch.ts`: *"every member PurchaseRequest carries the SAME
   * `po` JSON (with the combined lines and one PO number)"* — so a combined PO is
   * several ROWS and one PURCHASE ORDER. Comparing row against row made one check
   * on two members report itself as a duplicate of itself.
   */
  it("does not report a combined PO's own members as another PO", () => {
    const mine = { id: "pr1", poNumber: "PO-AFBM20260000609", batchId: "batch-7" };
    const rows = [
      row({ id: "pr1", batchId: "batch-7", checkNos: [CHECK] }),
      row({ id: "pr2", batchId: "batch-7", checkNos: [CHECK] }), // the same PO, another row
      row({ id: "pr3", batchId: "batch-7", checkNos: [CHECK] }),
    ];
    expect(otherPurchaseOrdersWithCheck(CHECK, mine, rows)).toEqual([]);
  });

  /** Two rows with no batch but the SAME PO number are also one purchase order. */
  it("treats one PO number as one purchase order, batch id or not", () => {
    const rows = [row({ checkNos: [CHECK] }), row({ id: "pr2", checkNos: [CHECK] })];
    expect(otherPurchaseOrdersWithCheck(CHECK, MINE, rows)).toEqual([]);
    expect(purchaseOrderKey({ id: "a", poNumber: "PO-1", batchId: null }))
      .toBe(purchaseOrderKey({ id: "b", poNumber: " po-1 ", batchId: null }));
  });

  /**
   * No money moved on a cancelled or rejected request, so it is not a second
   * record of this payment — a PO cancelled and re-raised with the same check is
   * one payment, and saying otherwise sends someone hunting for another.
   */
  it("ignores a cancelled or rejected request", () => {
    for (const status of ["CANCELLED", "REJECTED"]) {
      const rows = [row({ checkNos: [CHECK] }), row({ id: "pr2", poNumber: "PO-DEAD", status, checkNos: [CHECK] })];
      expect(otherPurchaseOrdersWithCheck(CHECK, MINE, rows), status).toEqual([]);
    }
  });

  it("ignores the padding, since the printed and register forms differ", () => {
    const rows = [row({ id: "pr2", poNumber: "PO-OTHER", checkNos: ["486718"] })];
    expect(otherPurchaseOrdersWithCheck("0000486718", MINE, rows)).toEqual(["PO-OTHER"]);
    expect(otherPurchaseOrdersWithCheck("486718", MINE, rows)).toEqual(["PO-OTHER"]);
  });

  it("says nothing without a number to compare", () => {
    const rows = [row({ id: "pr2", poNumber: "PO-OTHER", checkNos: [CHECK] })];
    for (const no of ["", null, undefined, "   "]) {
      expect(otherPurchaseOrdersWithCheck(no, MINE, rows), String(no)).toEqual([]);
    }
  });

  it("names each other PO once, in a stable order", () => {
    const rows = [
      row({ id: "z", poNumber: "PO-Z", checkNos: [CHECK] }),
      row({ id: "a", poNumber: "PO-A", checkNos: [CHECK] }),
      row({ id: "a2", poNumber: "PO-A", checkNos: [CHECK] }), // same PO, second row
    ];
    expect(otherPurchaseOrdersWithCheck(CHECK, MINE, rows)).toEqual(["PO-A", "PO-Z"]);
  });

  /** A request with no PO yet is still a place a check can sit, and is named honestly. */
  it("copes with a row that has no PO number", () => {
    const rows = [row({ id: "pr2", poNumber: null, checkNos: [CHECK] })];
    expect(otherPurchaseOrdersWithCheck(CHECK, MINE, rows)).toEqual(["a purchase order with no PO number yet"]);
    // …and such a row is only ever itself, never lumped in with another.
    expect(purchaseOrderKey({ id: "x", poNumber: null, batchId: null }))
      .not.toBe(purchaseOrderKey({ id: "y", poNumber: null, batchId: null }));
  });
});
