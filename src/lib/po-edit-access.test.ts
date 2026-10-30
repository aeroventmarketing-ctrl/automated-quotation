import { describe, it, expect } from "vitest";
import { inPendingOrApprovedTab, canEditSinglePo, canEditCombinedPo } from "./po-edit-access";

// The owner: "allow purchaser to edit purchase order, delete and modify rows in
// purchase order in Purchasing Pending and Purchasing Approved Tab".
describe("the Pending and Approved tabs", () => {
  it.each([
    ["PENDING_APPROVAL", true],
    ["APPROVED", true],
    ["VOUCHER_READY", true], // "Voucher ready — awaiting signing"
    ["VOUCHER_SIGNED", false], // Budgeted from here
    ["PURCHASED", false],
    ["COMPLETED", false],
    ["REJECTED", false],
    ["CANCELLED", false],
  ])("%s → %s", (status, want) => expect(inPendingOrApprovedTab(status)).toBe(want));
});

describe("a single PO", () => {
  const pu = { admin: false, purchaser: true };
  it("the Purchaser edits an APPROVED PO in the Approved tab — no longer admin only", () => {
    expect(canEditSinglePo({ ...pu, status: "APPROVED", poApproved: true })).toBe(true);
    expect(canEditSinglePo({ ...pu, status: "VOUCHER_READY", poApproved: true })).toBe(true);
  });
  it("…but not once the voucher is signed (Budgeted)", () => {
    expect(canEditSinglePo({ ...pu, status: "VOUCHER_SIGNED", poApproved: true })).toBe(false);
    expect(canEditSinglePo({ ...pu, status: "PURCHASED", poApproved: true })).toBe(false);
  });
  it("a PO never put to the Approver keeps the reach it had", () => {
    expect(canEditSinglePo({ ...pu, status: "PURCHASED", poApproved: false })).toBe(true);
  });
  it("an admin always; anyone else never", () => {
    expect(canEditSinglePo({ admin: true, purchaser: false, status: "PURCHASED", poApproved: true })).toBe(true);
    expect(canEditSinglePo({ admin: false, purchaser: false, status: "APPROVED", poApproved: false })).toBe(false);
  });
});

describe("a combined PO", () => {
  it("the Purchaser edits it through Pending and Approved, approved or not", () => {
    expect(canEditCombinedPo({ admin: false, purchaser: true, status: "VOUCHER_READY" })).toBe(true);
    expect(canEditCombinedPo({ admin: false, purchaser: true, status: "APPROVED" })).toBe(true);
  });
  it("nobody once the voucher is signed — the rule it always had", () => {
    expect(canEditCombinedPo({ admin: true, purchaser: false, status: "VOUCHER_SIGNED" })).toBe(false);
    expect(canEditCombinedPo({ admin: false, purchaser: true, status: "PURCHASED" })).toBe(false);
  });
  it("not for anyone else", () => {
    expect(canEditCombinedPo({ admin: false, purchaser: false, status: "APPROVED" })).toBe(false);
  });
});
