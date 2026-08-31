/**
 * The approval record a pending request prints: designation, name, date, time.
 *
 * Owner's instruction: *"Put the details of approval such as date, time,
 * designation and name of approver."* The timestamps were already stored on
 * every sign-off — this is about which of them a card is entitled to show, which
 * depends on the chain the request is running.
 *
 * No database — pure function.
 */
import { describe, it, expect } from "vitest";
import { stockActionSignatures } from "./stock-action";

const AT = "2026-08-31T02:12:00.000Z";
const base = {
  warehouseByName: null as string | null, warehouseAt: null as string | null,
  purchaserByName: null as string | null, purchaserAt: null as string | null,
  approverByName: null as string | null, approverAt: null as string | null,
};

describe("the approval record on a pending request", () => {
  it("shows the Purchaser then the price owner on a Warehouse request", () => {
    const rows = stockActionSignatures({
      ...base, proposedRole: "warehouse",
      warehouseByName: "Joemel Jamero", warehouseAt: AT,
      purchaserByName: "Allan Ramos", purchaserAt: AT,
    });
    expect(rows.map((r) => [r.designation, r.name, r.signed])).toEqual([
      ["Purchaser", "Allan Ramos", true],
      ["Admin / Payment Approver", null, false],
    ]);
    expect(rows[0].at).toBe(AT);
  });

  // The proposer's own signature is the "Raised by" line above the trail;
  // printing it again read as though one person both raised and approved it.
  it("leaves the proposer's own step out of the trail", () => {
    const rows = stockActionSignatures({
      ...base, proposedRole: "purchaser", purchaserByName: "Allan Ramos", purchaserAt: AT,
    });
    expect(rows.map((r) => r.designation)).toEqual(["Admin / Payment Approver"]);
  });

  // Same rule as `nextStockActionSlot`: a Purchaser's request has no Warehouse
  // step, so the card must not show an empty one waiting for a signature that
  // will never be taken.
  it("never shows a Warehouse step the chain does not use", () => {
    for (const proposedRole of ["warehouse", "purchaser", "admin"]) {
      const rows = stockActionSignatures({ ...base, proposedRole });
      expect(rows.some((r) => r.slot === "warehouse")).toBe(false);
    }
  });

  it("marks an unsigned step as outstanding, with no name and no time", () => {
    const [next] = stockActionSignatures({ ...base, proposedRole: "purchaser", purchaserAt: AT });
    expect(next).toMatchObject({ signed: false, name: null, at: null });
  });
});
