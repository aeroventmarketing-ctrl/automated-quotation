import { describe, it, expect } from "vitest";
import { buildPurchaseChainRow, type PurchaseRequestLike } from "./purchase-chain-row";
import type { PRStatus } from "./purchasing";

/**
 * The row is where a rule becomes a button. `checkReadableAt` is asserted for
 * every status in `voucher-check.test.ts`; this asserts that the row actually
 * *carries* that answer to the screen — the gap the role harness exists to
 * catch, and the one a green rule test cannot.
 */
const pr = (status: PRStatus): PurchaseRequestLike => ({
  id: "pr1",
  dept: null,
  items: [],
  note: null,
  status,
  po: { supplier: { company: "TKL STEEL CORPORATION" }, lines: [], ewtPct: 1 },
  voucherCheckDocs: [{ path: "purchases/pr1/c.jpg", name: "c.jpg", uploadedAt: "", uploadedByName: "M" }],
  createdByName: "M",
  createdAt: new Date("2026-09-01"),
  decidedByName: null, decidedAt: null,
  voucherByName: null, voucherAt: null,
  purchasedByName: null, purchasedAt: null,
  checkedByName: null, checkedAt: null,
  receivedByName: null, receivedAt: null,
  plantApprovedByName: null, plantApprovedAt: null,
});

const row = (status: PRStatus, opts: { admin: boolean; canAttachCheck: boolean }) =>
  buildPurchaseChainRow(pr(status), {
    canManagePO: false,
    namesForRole: () => [],
    canAct: () => false,
    admin: opts.admin,
    canAttachCheck: opts.canAttachCheck,
    givesTerms: () => true,
  });

describe("the check flags the row hands to the screen", () => {
  /**
   * The owner: *"AI check reading not functioning please check."* Two checks on
   * COMPLETED POs, unread, with no Re-read button — because reading shared the
   * attach window. Their answer: *"Admin may re-read anytime."*
   */
  it("gives an admin Re-read and Delete on a completed PO, and nobody else", () => {
    const admin = row("COMPLETED", { admin: true, canAttachCheck: true });
    expect(admin.canReadCheck).toBe(true);
    // *"add an option to delete the uploaded file"* — a wrong photo on a
    // finished PO was otherwise permanent.
    expect(admin.canRemoveCheck).toBe(true);
    // …without giving them ATTACHING back: replacing a photo on a completed PO
    // is a different power, and the owner's Budgeted-only rule still holds.
    expect(admin.canAttachCheck).toBe(false);

    const accounting = row("COMPLETED", { admin: false, canAttachCheck: true });
    expect(accounting.canReadCheck).toBe(false);
    expect(accounting.canRemoveCheck).toBe(false);
    expect(accounting.canAttachCheck).toBe(false);
  });

  it("still gives both to the people who could always attach, while the PO is live", () => {
    for (const status of ["VOUCHER_SIGNED", "CASH_RELEASED", "PURCHASED", "RECEIVED"] as PRStatus[]) {
      const r = row(status, { admin: false, canAttachCheck: true });
      expect(r.canAttachCheck, status).toBe(true);
      expect(r.canReadCheck, status).toBe(true);
      expect(r.canRemoveCheck, status).toBe(true);
    }
  });

  it("gives neither to someone whose ROLE cannot touch a check, admin flag or not", () => {
    // The role gate comes first: being an admin of the workflow chain is not the
    // same as being one of Accounting / Payment Approver / admin.
    const r = row("COMPLETED", { admin: true, canAttachCheck: false });
    expect(r.canReadCheck).toBe(false);
    expect(r.canRemoveCheck).toBe(false);
    expect(r.canAttachCheck).toBe(false);
  });
});
