import { describe, it, expect } from "vitest";
import {
  canCancelPurchase,
  isDeptRequisition,
  statusBucket,
  DEPT_REQUISITION_WHERE,
  DEPT_REQUISITION_KIND,
  type PRStatus,
  type PurchaseCancelActor,
} from "./purchasing";

/**
 * One rule, two spellings — a predicate for rows already in memory and a Prisma
 * filter for rows still in the database. They drifted once, and the drift was
 * invisible until a user pressed a button:
 *
 *   the order page ticked "Purchaser bought the goods" with `isDeptRequisition`
 *   (kind "department" OR mrfId set), while `notifyClientBoughtInOrder` counted
 *   only `kind: "department"`. An MRF-escalated request — which carries `mrfId`
 *   and the schema DEFAULT kind "order" — satisfied the tick and was invisible
 *   to the server. Button enabled, server refused, reason masked by Next.js.
 *
 * So both spellings are asserted over the same truth table.
 */
describe("a department / material requisition", () => {
  const CASES: { label: string; kind: string | null; mrfId: string | null; isDept: boolean }[] = [
    { label: "raised by a department", kind: "department", mrfId: null, isDept: true },
    { label: "escalated from an MRF — kind stays at the schema default", kind: "order", mrfId: "mrf1", isDept: true },
    { label: "an MRF escalation that is also marked department", kind: "department", mrfId: "mrf1", isDept: true },
    { label: "a plain order-linked request", kind: "order", mrfId: null, isDept: false },
    { label: "a replenishment", kind: "replenishment", mrfId: null, isDept: false },
  ];

  /** Evaluate the Prisma fragment the way Postgres would, for these two fields. */
  const matchesWhere = (pr: { kind: string | null; mrfId: string | null }) =>
    DEPT_REQUISITION_WHERE.OR.some((c) =>
      "kind" in c ? pr.kind === c.kind : pr.mrfId !== null,
    );

  for (const { label, kind, mrfId, isDept } of CASES) {
    it(`${label} → ${isDept ? "counts" : "does not count"}`, () => {
      expect(isDeptRequisition({ kind, mrfId })).toBe(isDept);
      // …and the database filter agrees. This is the assertion that would have
      // failed while the two were out of step.
      expect(matchesWhere({ kind, mrfId })).toBe(isDept);
    });
  }

  it("keeps the two spellings structurally identical", () => {
    // A third condition added to one side and not the other is the failure mode;
    // pin the shape, not just the outcomes.
    expect(DEPT_REQUISITION_WHERE.OR).toHaveLength(2);
    expect(DEPT_REQUISITION_WHERE.OR).toContainEqual({ kind: DEPT_REQUISITION_KIND });
    expect(DEPT_REQUISITION_WHERE.OR).toContainEqual({ mrfId: { not: null } });
  });

  it("treats a missing kind as not a department requisition", () => {
    expect(isDeptRequisition({})).toBe(false);
    expect(isDeptRequisition({ kind: null, mrfId: null })).toBe(false);
  });
});

/**
 * Who may cancel a purchase.
 *
 * The owner, 15 September: *"Add an option to cancel PO in approved Purchasing
 * tab for purchaser role"* — and, asked how far that should reach, chose the
 * narrowest reading of it twice over: **only before a PO is prepared**, and
 * **single-request POs only**.
 *
 * So the table below is mostly about what the Purchaser still may NOT do. Those
 * rows are the feature: a permission is defined by its edge, and this one was
 * drawn deliberately tight.
 */
describe("who may cancel a purchase", () => {
  const ADMIN: PurchaseCancelActor = { admin: true, purchaser: false, requestor: false };
  const PURCHASER: PurchaseCancelActor = { admin: false, purchaser: true, requestor: false };
  const REQUESTOR: PurchaseCancelActor = { admin: false, purchaser: false, requestor: true };
  const BYSTANDER: PurchaseCancelActor = { admin: false, purchaser: false, requestor: false };

  /** An order-linked request, so the bucket follows the status alone. */
  const at = (status: PRStatus, over: { poPrepared?: boolean; combined?: boolean } = {}) => ({
    status,
    bucket: statusBucket(status),
    poPrepared: over.poPrepared ?? false,
    combined: over.combined ?? false,
  });

  describe("before it is approved", () => {
    it("the requestor, the Purchaser and an admin may all call it off", () => {
      for (const who of [ADMIN, PURCHASER, REQUESTOR]) {
        expect(canCancelPurchase(at("PENDING_APPROVAL"), who)).toBe(true);
      }
    });
    it("a bystander may not", () => {
      expect(canCancelPurchase(at("PENDING_APPROVAL"), BYSTANDER)).toBe(false);
    });
  });

  describe("approved, with no purchase order written yet — the new window", () => {
    it("the Purchaser may cancel it", () => {
      expect(canCancelPurchase(at("APPROVED"), PURCHASER)).toBe(true);
    });
    it("the requestor still may not — it left their hands at approval", () => {
      expect(canCancelPurchase(at("APPROVED"), REQUESTOR)).toBe(false);
    });
    it("nor may a bystander", () => {
      expect(canCancelPurchase(at("APPROVED"), BYSTANDER)).toBe(false);
    });
  });

  describe("the two edges the owner drew", () => {
    it("a PO has been prepared → admin only, even at APPROVED", () => {
      expect(canCancelPurchase(at("APPROVED", { poPrepared: true }), PURCHASER)).toBe(false);
      expect(canCancelPurchase(at("APPROVED", { poPrepared: true }), ADMIN)).toBe(true);
    });

    /** Cancelling a combined PO cancels every department's request on it. */
    it("a combined PO → admin only", () => {
      expect(canCancelPurchase(at("APPROVED", { combined: true }), PURCHASER)).toBe(false);
      expect(canCancelPurchase(at("APPROVED", { combined: true }), ADMIN)).toBe(true);
    });

    it("and everything further down the chain stays admin only", () => {
      const later: PRStatus[] = [
        "VOUCHER_READY", "VOUCHER_SIGNED", "CASH_RELEASED", "WITH_PURCHASER",
        "CASH_CONFIRMED", "TASKED", "LOGISTICS_CONFIRMED", "PURCHASED",
        "CHECKED", "DELIVERED", "RECEIVED", "PLANT_APPROVED",
      ];
      for (const s of later) {
        expect(canCancelPurchase(at(s), PURCHASER), s).toBe(false);
        expect(canCancelPurchase(at(s), ADMIN), s).toBe(true);
      }
    });
  });

  /**
   * A department MRF at APPROVED is only Plant-Manager-approved; it sits in the
   * PENDING tab awaiting the Approver. The owner asked for the APPROVED tab, so
   * this one is untouched — and it is the case a status-only rule would have got
   * wrong, because the status says APPROVED while the tab says pending.
   */
  it("a department MRF still awaiting purchase approval is unchanged", () => {
    const ctx = {
      status: "APPROVED" as PRStatus,
      bucket: statusBucket("APPROVED", { isDept: true, poApproved: false }),
      poPrepared: false,
      combined: false,
    };
    expect(ctx.bucket).toBe("pending");
    expect(canCancelPurchase(ctx, PURCHASER)).toBe(false);
    expect(canCancelPurchase(ctx, REQUESTOR)).toBe(false);
    expect(canCancelPurchase(ctx, ADMIN)).toBe(true);
  });

  it("once it is received into stock nobody cancels it, not even an admin", () => {
    for (const s of ["COMPLETED", "REJECTED", "CANCELLED"] as PRStatus[]) {
      expect(canCancelPurchase(at(s), ADMIN), s).toBe(false);
      expect(canCancelPurchase(at(s), PURCHASER), s).toBe(false);
    }
  });
});
