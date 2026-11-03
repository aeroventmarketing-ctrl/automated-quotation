import { describe, it, expect } from "vitest";
import { inPendingOrApprovedTab, canEditSinglePo, canEditCombinedPo, sendsBackForApproval, poAmountChanged, sentBackFields, readSentBack, awaitingPurchaseApproval, approveMemberFields, rejectMemberFields } from "./po-edit-access";

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

describe("an amount change at Voucher ready goes back to the Payment Approver", () => {
  const a = { total: 88300, net: 87511.61 };
  it("only at Voucher ready, and only when the amount moves", () => {
    expect(sendsBackForApproval("VOUCHER_READY", a, { total: 88300, net: 87511.61 })).toBe(false); // a remark edit
    expect(sendsBackForApproval("VOUCHER_READY", a, { total: 85420, net: 84657.32 })).toBe(true); // a row deleted
    expect(sendsBackForApproval("VOUCHER_READY", a, { total: 88300, net: 88300 })).toBe(true); // EWT removed
    expect(sendsBackForApproval("APPROVED", a, { total: 1, net: 1 })).toBe(false); // no voucher yet
    expect(sendsBackForApproval("VOUCHER_SIGNED", a, { total: 1, net: 1 })).toBe(false); // can't be edited there anyway
    expect(poAmountChanged(a, { total: 88300.004, net: 87511.61 })).toBe(false);
  });
  const stamp = { byName: "Allan Ramos", role: "Purchaser", at: "2026-10-30T02:00:00.000Z", from: 87511.61, to: 84657.32 };
  it("a department requisition: back to APPROVED, its PO approval and voucher cleared", () => {
    const f = sentBackFields({ isDept: true, chainLog: { approve_po: { byName: "Rey Gil" }, other: { byName: "x" } } }, stamp);
    expect(f.status).toBe("APPROVED");
    expect(f.chainLog.approve_po).toBeUndefined();
    expect(f.chainLog.other).toEqual({ byName: "x" });
    expect(f.voucherByName).toBeNull();
    expect("decidedByName" in f).toBe(false); // the Plant Manager's MRF approval stands
    expect(readSentBack(f.chainLog)).toEqual(stamp);
  });
  it("any other request: back to PENDING_APPROVAL, the Approver's decision cleared", () => {
    const f = sentBackFields({ isDept: false, chainLog: {} }, stamp);
    expect(f.status).toBe("PENDING_APPROVAL");
    expect(f.decidedByName).toBeNull();
  });
  it("no stamp, nothing to read", () => {
    expect(readSentBack({})).toBeNull();
    expect(readSentBack(null)).toBeNull();
  });
});

// The owner, 3 November: "I cannot approve some PO". A combined PO sent back
// after an amount change showed AWAITING APPROVAL and did nothing when the
// Payment Approver pressed Approve purchase — `approve_po` was never recorded.
describe("approving a combined PO that came back from a send-back", () => {
  const stamp = { userId: "u1", byName: "Rey Gil", role: "Payment Approver", at: "2026-11-03T02:00:00.000Z" };
  const sentBackDept = { status: "APPROVED", chainLog: { sent_back: { byName: "Allan Ramos" } } };
  const sentBackOrder = { status: "PENDING_APPROVAL", chainLog: { sent_back: { byName: "Allan Ramos" } } };

  it("knows which members are still waiting for the Approver", () => {
    expect(awaitingPurchaseApproval(sentBackDept)).toBe(true);
    expect(awaitingPurchaseApproval(sentBackOrder)).toBe(true);
    // Already approved, or further down the chain: not waiting.
    expect(awaitingPurchaseApproval({ status: "APPROVED", chainLog: { approve_po: { byName: "Rey Gil" } } })).toBe(false);
    expect(awaitingPurchaseApproval({ status: "VOUCHER_READY", chainLog: {} })).toBe(false);
  });

  it("stamps approve_po on every member, whichever status it waits at", () => {
    const dept = approveMemberFields(sentBackDept, stamp);
    expect(dept.status).toBe("APPROVED");
    expect((dept.chainLog as Record<string, unknown>).approve_po).toEqual({ byName: "Rey Gil", at: stamp.at, role: "Payment Approver" });
    // Each member keeps its own log — the send-back stamp stays on the trail.
    expect((dept.chainLog as Record<string, unknown>).sent_back).toEqual({ byName: "Allan Ramos" });
    expect("decidedByName" in dept).toBe(false); // it never left APPROVED

    const order = approveMemberFields(sentBackOrder, stamp);
    expect(order.status).toBe("APPROVED");
    expect((order.chainLog as Record<string, unknown>).approve_po).toBeTruthy();
    expect(order.decidedByName).toBe("Rey Gil"); // came from PENDING_APPROVAL
  });

  it("rejects under the key its own status calls for", () => {
    expect(rejectMemberFields(sentBackDept, stamp).status).toBe("REJECTED");
    expect((rejectMemberFields(sentBackDept, stamp).chainLog as Record<string, unknown>).reject_po).toBeTruthy();
    expect((rejectMemberFields(sentBackOrder, stamp).chainLog as Record<string, unknown>).reject).toBeTruthy();
    expect(rejectMemberFields(sentBackOrder, stamp).decidedByName).toBe("Rey Gil");
  });
});
