import { describe, it, expect } from "vitest";
import {
  cashBucket, isCompletedCashRequest, canCancelCashRequest, canRejectCashRequest, isCashCancellable,
  CASH_MAIN_ORDER, type CashRequestStatus, type CashRequestActor,
} from "./cash-request";

/**
 * Who may call off a cash request, asserted as a WHOLE GRID rather than one
 * allowed case at a time — the convention `catalogue-access.test.ts` set, for the
 * reason it set it: a permission change is only safe to read if every cell that
 * moved is visible in the diff.
 *
 * The owner's two instructions:
 *
 *  - *"in Cash Requests Approved Tab, add an option to cancel for accounting
 *    role"*
 *  - *"In cash requests Budgeted Tab, add an option to cancel and reject for
 *    admin/payment approver role"*
 */

const ALL: CashRequestStatus[] = [...CASH_MAIN_ORDER, "REJECTED", "CANCELLED"];

const WHO: Record<string, CashRequestActor> = {
  admin: { admin: true },
  accounting: { accounting: true },
  approver: { paymentApprover: true },
  requestor: { requestor: true },
  nobody: {},
};

/** The statuses each tab holds, so the tests read like the owner's words. */
const inTab = (tab: string) => ALL.filter((s) => cashBucket(s) === tab);

describe("the tabs are the ones on screen", () => {
  it("Approved is the two before the cash moves; Budgeted is what is still in flight", () => {
    expect(inTab("approved")).toEqual(["SUBMITTED", "VOUCHER_READY"]);
    expect(inTab("budgeted")).toEqual(["CASH_RELEASED", "DISBURSED", "RECEIVED", "LIQUIDATED"]);
    expect(inTab("pending")).toEqual(["PENDING_APPROVAL"]);
  });

  it("a settled voucher is COMPLETED and leaves the tabs", () => {
    // *"Settled Cash Voucher should have a completed Cash Voucher Table same as
    // Purchasing Tab Completed Department POs."* It is not a Budgeted row any
    // more, so it stops padding that count for ever.
    expect(cashBucket("SETTLED")).toBe("completed");
    expect(isCompletedCashRequest("SETTLED")).toBe(true);
    expect(inTab("budgeted")).not.toContain("SETTLED");
    for (const s of ALL.filter((x) => x !== "SETTLED")) {
      expect(isCompletedCashRequest(s), s).toBe(false);
    }
  });
});

describe("who may cancel a cash request", () => {
  /** Every role × every status, as a grid. */
  const grid = () =>
    Object.fromEntries(
      Object.entries(WHO).map(([who, actor]) => [
        who,
        ALL.filter((s) => canCancelCashRequest(s, actor)),
      ]),
    );

  it("the whole grid", () => {
    expect(grid()).toEqual({
      // Unchanged: anywhere still cancellable.
      admin: ["PENDING_APPROVAL", "SUBMITTED", "VOUCHER_READY", "CASH_RELEASED", "DISBURSED", "RECEIVED", "LIQUIDATED"],
      // NEW — the Approved tab, exactly.
      accounting: ["SUBMITTED", "VOUCHER_READY"],
      // NEW — the Budgeted tab, which is exactly these four.
      approver: ["CASH_RELEASED", "DISBURSED", "RECEIVED", "LIQUIDATED"],
      // Unchanged: before the voucher exists.
      requestor: ["PENDING_APPROVAL", "SUBMITTED"],
      nobody: [],
    });
  });

  it("the Payment Approver's window is the Budgeted tab exactly", () => {
    expect(ALL.filter((s) => canCancelCashRequest(s, WHO.approver))).toEqual(inTab("budgeted"));
  });

  it("Accounting's window is the Approved tab and nothing else", () => {
    expect(ALL.filter((s) => canCancelCashRequest(s, WHO.accounting))).toEqual(inTab("approved"));
  });

  it("nobody can cancel a settled, rejected or already-cancelled request", () => {
    for (const s of ["SETTLED", "REJECTED", "CANCELLED"] as CashRequestStatus[]) {
      expect(isCashCancellable(s), s).toBe(false);
      for (const [who, actor] of Object.entries(WHO)) {
        expect(canCancelCashRequest(s, actor), `${who} @ ${s}`).toBe(false);
      }
    }
  });
});

describe("who may reject a cash request after the cash is out", () => {
  it("the whole grid", () => {
    const grid = Object.fromEntries(
      Object.entries(WHO).map(([who, actor]) => [who, ALL.filter((s) => canRejectCashRequest(s, actor))]),
    );
    expect(grid).toEqual({
      admin: ["CASH_RELEASED", "DISBURSED", "RECEIVED", "LIQUIDATED"],
      approver: ["CASH_RELEASED", "DISBURSED", "RECEIVED", "LIQUIDATED"],
      // Accounting cancels in Approved; rejecting released cash is not theirs.
      accounting: [],
      requestor: [],
      nobody: [],
    });
  });

  it("is never offered before the cash has been released", () => {
    // VOUCHER_READY already has the ordinary `reject` chain step; this is the
    // exception that follows it, and offering both at once would be two buttons
    // for one decision.
    for (const s of [...inTab("pending"), ...inTab("approved")]) {
      expect(canRejectCashRequest(s, WHO.admin), s).toBe(false);
      expect(canRejectCashRequest(s, WHO.approver), s).toBe(false);
    }
  });

  it("stops at SETTLED, like cancelling", () => {
    expect(canRejectCashRequest("SETTLED", WHO.admin)).toBe(false);
    expect(canRejectCashRequest("SETTLED", WHO.approver)).toBe(false);
  });
});
