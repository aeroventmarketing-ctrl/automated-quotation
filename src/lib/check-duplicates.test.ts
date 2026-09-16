import { describe, it, expect } from "vitest";
import {
  otherPurchaseOrdersWithCheck, purchaseOrderKey, duplicateCheckIndex, duplicateCheckKey,
  duplicateCheckRefusal, type CheckHolder, type CheckOnRegister,
} from "./check-duplicates";

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

/**
 * The owner, sent here by a register showing two rows carrying check no.
 * 0000486718 — one flagged, one clean: *"disallow duplicate input. Put a message
 * in every role and every tab when possible."*
 *
 * The clean row is the whole bug. The warning was computed when a check was READ
 * and then stored on that check for good, so it lands on the PO recorded second
 * and the PO recorded first never learns anything happened. A fact about a PAIR
 * cannot live on one half of the pair, which is what this index is for.
 */
describe("the whole register at once", () => {
  const on = (poKey: string, checkNo: string | null, over: Partial<CheckOnRegister> = {}): CheckOnRegister =>
    ({ poKey, poLabel: poKey.replace(/^po:/, "").toUpperCase(), checkNo, ...over });

  const A = "po:po-afbm20260000609";
  const B = "po:po-afbm20260000632";

  it("names each half of the pair to the other — both, not just the second", () => {
    const ix = duplicateCheckIndex([on(A, CHECK), on(B, CHECK)]);
    expect(ix.get(duplicateCheckKey(A, CHECK)!)).toEqual(["PO-AFBM20260000632"]);
    expect(ix.get(duplicateCheckKey(B, CHECK)!)).toEqual(["PO-AFBM20260000609"]);
  });

  it("says nothing at all about a check only one PO carries", () => {
    const ix = duplicateCheckIndex([on(A, CHECK), on(B, "0000486719")]);
    expect(ix.size).toBe(0);
  });

  it("counts a combined PO's several rows as the one purchase order they are", () => {
    // Same poKey twice — the members of one combined PO, sharing its number.
    expect(duplicateCheckIndex([on(A, CHECK), on(A, CHECK)]).size).toBe(0);
  });

  it("ignores the padding, so the printed and register forms collide", () => {
    const ix = duplicateCheckIndex([on(A, "0000486718"), on(B, "486718")]);
    expect(ix.get(duplicateCheckKey(A, "486718")!)).toEqual(["PO-AFBM20260000632"]);
  });

  it("skips a cancelled or rejected request, which is not a second record", () => {
    for (const status of ["CANCELLED", "REJECTED"]) {
      expect(duplicateCheckIndex([on(A, CHECK), on(B, CHECK, { status })]).size, status).toBe(0);
    }
  });

  it("has nothing to say about a PO whose check is not written or not read", () => {
    expect(duplicateCheckIndex([on(A, null), on(B, null), on(A, "")]).size).toBe(0);
    expect(duplicateCheckKey(A, null)).toBeNull();
    expect(duplicateCheckKey(A, "  ")).toBeNull();
  });

  /** Three POs on one number: each is told about the other two, named and sorted. */
  it("copes with more than two, in a stable order", () => {
    const ix = duplicateCheckIndex([on("po:z", CHECK), on("po:a", CHECK), on("po:m", CHECK)]);
    expect(ix.get(duplicateCheckKey("po:m", CHECK)!)).toEqual(["A", "Z"]);
  });
});

describe("the sentence it is refused with", () => {
  it("names the other PO, because 'somewhere else' is a claim nobody can check", () => {
    const msg = duplicateCheckRefusal("0000486718", ["PO-AFBM20260000609"])!;
    expect(msg).toContain("0000486718");
    expect(msg).toContain("PO-AFBM20260000609");
    expect(msg).toMatch(/wasn't saved/);
  });

  it("says both when there are two", () => {
    expect(duplicateCheckRefusal("486718", ["PO-A", "PO-B"])).toContain("PO-A and PO-B");
  });

  it("is null when there is nothing to refuse — the caller's cue to carry on", () => {
    expect(duplicateCheckRefusal("0000486718", [])).toBeNull();
  });
});
