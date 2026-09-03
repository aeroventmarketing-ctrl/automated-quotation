import { describe, it, expect } from "vitest";
import type { PRStatus } from "./purchasing";
import { PR_MAIN_ORDER } from "./purchasing";
import { canAttachCheck, checkExpected, checkMissing, coerceCheckDocs } from "./voucher-check";

const doc = { path: "purchases/pr1/1.jpg", name: "check.jpg", uploadedAt: "", uploadedByName: "A" };

describe("who may attach a check photo", () => {
  // The owner's answer, whole: *"Accounting, Payment Approver and Admin."*
  const CAN: Array<[string, { admin: boolean; workflowRoles: string[] }, boolean]> = [
    ["Admin", { admin: true, workflowRoles: [] }, true],
    ["Accounting", { admin: false, workflowRoles: ["accounting"] }, true],
    ["Payment Approver", { admin: false, workflowRoles: ["payment_approver"] }, true],
    // …and everyone else, including the people closest to the money.
    ["Purchaser", { admin: false, workflowRoles: ["purchaser"] }, false],
    ["Plant Manager", { admin: false, workflowRoles: ["plant_manager"] }, false],
    ["Warehouse", { admin: false, workflowRoles: ["warehouse"] }, false],
    ["Logistics Head", { admin: false, workflowRoles: ["logistics_head"] }, false],
    ["nobody in particular", { admin: false, workflowRoles: [] }, false],
  ];
  for (const [who, opts, expected] of CAN) {
    it(who, () => expect(canAttachCheck(opts)).toBe(expected));
  }
});

describe("when a check is expected", () => {
  it("never for a cash supplier, at any stage", () => {
    for (const status of PR_MAIN_ORDER) {
      expect(checkExpected({ supplierGivesTerms: false, status }), status).toBe(false);
    }
  });

  it("for a terms supplier, from Voucher & Check Signed onwards", () => {
    const before: PRStatus[] = ["PENDING_APPROVAL", "APPROVED", "VOUCHER_READY"];
    const after: PRStatus[] = ["VOUCHER_SIGNED", "CASH_RELEASED", "PURCHASED", "RECEIVED", "COMPLETED"];
    for (const status of before) expect(checkExpected({ supplierGivesTerms: true, status }), status).toBe(false);
    for (const status of after) expect(checkExpected({ supplierGivesTerms: true, status }), status).toBe(true);
  });

  it("never chases a cancelled or rejected PO", () => {
    for (const status of ["CANCELLED", "REJECTED"] as PRStatus[]) {
      expect(checkExpected({ supplierGivesTerms: true, status })).toBe(false);
    }
  });
});

describe("checkMissing", () => {
  it("flags a terms PO past signing with no photo", () => {
    expect(checkMissing({ supplierGivesTerms: true, status: "CASH_RELEASED", docs: [] })).toBe(true);
  });
  it("stops flagging once a photo is attached", () => {
    expect(checkMissing({ supplierGivesTerms: true, status: "CASH_RELEASED", docs: [doc] })).toBe(false);
  });
  it("does not flag a cash supplier that will never have a check", () => {
    expect(checkMissing({ supplierGivesTerms: false, status: "COMPLETED", docs: [] })).toBe(false);
  });
});

describe("coerceCheckDocs", () => {
  it("survives whatever is in the column", () => {
    expect(coerceCheckDocs(null)).toEqual([]);
    expect(coerceCheckDocs({})).toEqual([]);
    expect(coerceCheckDocs(["nope", 1, null, { name: "no path" }])).toEqual([]);
  });
  it("fills in the fields an older row may not have", () => {
    expect(coerceCheckDocs([{ path: "purchases/p/1.jpg" }])).toEqual([
      { path: "purchases/p/1.jpg", name: "check", uploadedAt: "", uploadedByName: "" },
    ]);
  });
});
