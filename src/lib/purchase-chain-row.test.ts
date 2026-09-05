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

const row = (status: PRStatus, opts: { admin: boolean; canAttachCheck: boolean; paymentApprover?: boolean; accounting?: boolean }) =>
  buildPurchaseChainRow(pr(status), {
    canManagePO: false,
    namesForRole: () => [],
    canAct: () => false,
    admin: opts.admin,
    canAttachCheck: opts.canAttachCheck,
    paymentApprover: opts.paymentApprover,
    accounting: opts.accounting,
    givesTerms: () => true,
  });

describe("the check flags the row hands to the screen", () => {
  /**
   * The owner: *"AI check reading not functioning please check."* Two checks on
   * COMPLETED POs, unread, with no Re-read button — because reading shared the
   * attach window. Their answer: *"Admin may re-read anytime."*
   */
  it("hands an admin and the Payment Approver all three controls on a completed PO", () => {
    // *"allow admin and payment approver to attach copy of check"* — asked after
    // a wrongly-read photo was deleted off a completed PO with no way to put
    // the right one back.
    for (const opts of [{ admin: true, canAttachCheck: true }, { admin: false, paymentApprover: true, canAttachCheck: true }]) {
      const r = row("COMPLETED", opts);
      expect(r.canAttachCheck, JSON.stringify(opts)).toBe(true);
      expect(r.canReadCheck, JSON.stringify(opts)).toBe(true);
      expect(r.canRemoveCheck, JSON.stringify(opts)).toBe(true);
    }
  });

  it("gives Accounting attach and re-read on a completed PO, but not delete", () => {
    // *"Attach only, not delete."* Putting the right photo on is a correction;
    // taking the only copy off a finished PO is the destructive half.
    const acct = row("COMPLETED", { admin: false, accounting: true, canAttachCheck: true });
    expect(acct.canAttachCheck).toBe(true);
    expect(acct.canReadCheck).toBe(true);
    expect(acct.canRemoveCheck).toBe(false);
  });

  it("gives a role the check rules do not name nothing at all on a completed PO", () => {
    const other = row("COMPLETED", { admin: false, canAttachCheck: true });
    expect(other.canAttachCheck).toBe(false);
    expect(other.canReadCheck).toBe(false);
    expect(other.canRemoveCheck).toBe(false);
  });

  it("still gives both to the people who could always attach, while the PO is live", () => {
    for (const status of ["VOUCHER_SIGNED", "CASH_RELEASED", "PURCHASED", "RECEIVED"] as PRStatus[]) {
      const r = row(status, { admin: false, canAttachCheck: true });
      expect(r.canAttachCheck, status).toBe(true);
      expect(r.canReadCheck, status).toBe(true);
      expect(r.canRemoveCheck, status).toBe(true);
    }
  });

  /**
   * The owner: *"In AI reading allow 3 tries in every row or every attachment.
   * Update and check all roles that is allowed to 3 tries AI reading.
   * Admin/payment approved still allowed unlimited number of tries."*
   *
   * Every role at once, so a change to one cell is a change to a table someone
   * has to read.
   */
  it("counts everyone's AI reads except the two who sign for the money", () => {
    const WHO: Array<[string, Parameters<typeof row>[1], boolean]> = [
      ["Admin", { admin: true, canAttachCheck: true }, true],
      ["Payment Approver", { admin: false, paymentApprover: true, canAttachCheck: true }, true],
      // The role the limit is actually for — they attach and read checks daily.
      ["Accounting", { admin: false, accounting: true, canAttachCheck: true }, false],
      ["anyone else", { admin: false, canAttachCheck: true }, false],
      // …and someone who cannot read a check at all is not "unlimited", whatever
      // else is true of them.
      ["a role the check rules don't name", { admin: false, canAttachCheck: false }, false],
    ];
    for (const [label, opts, unlimited] of WHO) {
      expect(row("CASH_RELEASED", opts).unlimitedCheckReads, label).toBe(unlimited);
      // It is a property of the PERSON, not of where the PO has got to.
      expect(row("COMPLETED", opts).unlimitedCheckReads, label).toBe(unlimited);
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
