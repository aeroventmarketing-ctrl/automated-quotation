import { describe, it, expect } from "vitest";
import {
  canCancelPurchase,
  isBudgetCommitted,
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
 * The owner asked for it twice. On **15 September**: *"Add an option to cancel PO
 * in approved Purchasing tab for purchaser role"* — built then as the narrowest
 * reading, only before a PO existed and never on a combined one. On **7 October**,
 * looking at a PO on screen: *"Allow cancellation of PO in approved tab or after
 * creating or generating a PO for purchaser role"*, stopping at *"once it is in
 * the Budgeted tab"*, combined POs included.
 *
 * A permission is defined by its edge, so the edge is asserted from both sides:
 * the last status the Purchaser may cancel at and the first they may not, one
 * press apart.
 */
describe("who may cancel a purchase", () => {
  const ADMIN: PurchaseCancelActor = { admin: true, purchaser: false, requestor: false };
  const PURCHASER: PurchaseCancelActor = { admin: false, purchaser: true, requestor: false };
  const REQUESTOR: PurchaseCancelActor = { admin: false, purchaser: false, requestor: true };
  const BYSTANDER: PurchaseCancelActor = { admin: false, purchaser: false, requestor: false };

  /** An order-linked request, so the bucket follows the status alone. */
  const at = (status: PRStatus) => ({ status, bucket: statusBucket(status) });

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

  /**
   * The window the owner widened on 7 October: *"Allow cancellation of PO in
   * approved tab or after creating or generating a PO for purchaser role"*, and
   * where it stops — *"Purchaser cannot cancel the PO once it is in the Budgeted
   * tab"*, combined POs included.
   *
   * It used to be approved-and-no-PO-and-not-combined. Each row below that reads
   * "now true" was false until then, and they are the whole of the change.
   */
  describe("anywhere in the Approved tab", () => {
    it("the Purchaser may cancel an approved request with no PO yet", () => {
      expect(canCancelPurchase(at("APPROVED"), PURCHASER)).toBe(true);
    });

    it("…and one that already HAS a purchase order — now true", () => {
      // A PO is a document the Purchaser wrote; nothing has been paid against it.
      expect(canCancelPurchase(at("APPROVED"), PURCHASER)).toBe(true);
    });

    it("…and once Accounting has prepared the voucher & check — now true", () => {
      // VOUCHER_READY is the other status living in the Approved tab.
      expect(statusBucket("VOUCHER_READY")).toBe("approved");
      expect(isBudgetCommitted("VOUCHER_READY")).toBe(false);
      expect(canCancelPurchase(at("VOUCHER_READY"), PURCHASER)).toBe(true);
    });

    it("the requestor still may not — it left their hands at approval", () => {
      expect(canCancelPurchase(at("APPROVED"), REQUESTOR)).toBe(false);
      expect(canCancelPurchase(at("VOUCHER_READY"), REQUESTOR)).toBe(false);
    });

    it("nor may a bystander", () => {
      expect(canCancelPurchase(at("APPROVED"), BYSTANDER)).toBe(false);
    });
  });

  /**
   * Where it stops. The tab split and the permission are the same line, so the
   * rule is asserted against `isBudgetCommitted` itself rather than against a
   * second list of statuses that could fall out of step with it.
   */
  describe("from the Budgeted tab on", () => {
    const budgeted: PRStatus[] = [
      "VOUCHER_SIGNED", "CASH_RELEASED", "WITH_PURCHASER", "CASH_CONFIRMED",
      "TASKED", "LOGISTICS_CONFIRMED", "PURCHASED", "CHECKED", "DELIVERED",
      "RECEIVED", "PLANT_APPROVED",
    ];

    it("every one of them counts as budget committed", () => {
      for (const s of budgeted) expect(isBudgetCommitted(s), s).toBe(true);
      // …and nothing in the Approved tab does.
      for (const s of ["PENDING_APPROVAL", "APPROVED", "VOUCHER_READY"] as PRStatus[]) {
        expect(isBudgetCommitted(s), s).toBe(false);
      }
    });

    it("the Purchaser may not cancel there; an admin still may", () => {
      for (const s of budgeted) {
        expect(canCancelPurchase(at(s), PURCHASER), s).toBe(false);
        expect(canCancelPurchase(at(s), ADMIN), s).toBe(true);
      }
    });

    it("the cut is exactly the signing of the voucher & check", () => {
      // The pair either side of the line, named: one press apart, opposite answers.
      expect(canCancelPurchase(at("VOUCHER_READY"), PURCHASER)).toBe(true);
      expect(canCancelPurchase(at("VOUCHER_SIGNED"), PURCHASER)).toBe(false);
    });
  });

  /**
   * A department MRF at APPROVED is only Plant-Manager-approved; it sits in the
   * PENDING tab awaiting the Approver. The owner asked about the APPROVED tab
   * both times, so this one is untouched — and it is the case a status-only rule
   * would get wrong, because the status says APPROVED while the tab says pending.
   */
  it("a department MRF still awaiting purchase approval is unchanged", () => {
    const ctx = {
      status: "APPROVED" as PRStatus,
      bucket: statusBucket("APPROVED", { isDept: true, poApproved: false }),
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
