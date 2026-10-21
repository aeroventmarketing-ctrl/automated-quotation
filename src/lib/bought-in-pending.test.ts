/**
 * Who a bought-in order at "For PO creation" is waiting on — the owner's order
 * 3512, flashing for the Purchaser with nothing for the Purchaser to do.
 */
import { describe, it, expect } from "vitest";
import { boughtInPurchasePending, PREPARE_PO_STEP } from "./bought-in-pending";
import { pendingStep, readOrderWorkflow } from "./order-workflow";

const row = (status: string, o: { hasPo?: boolean; poApproved?: boolean } = {}) => ({ status, hasPo: !!o.hasPo, poApproved: !!o.poApproved });

describe("a bought-in order follows its purchase request", () => {
  it("raised Approved, purchase not yet approved → the Payment Approver (order 3512)", () => {
    expect(boughtInPurchasePending([row("APPROVED")])).toEqual({ action: "Approve purchase", roles: ["payment_approver"] });
  });
  it("purchase approved, no PO yet → the Purchaser prepares it", () => {
    expect(boughtInPurchasePending([row("APPROVED", { poApproved: true })]).roles).toEqual(["purchaser"]);
  });
  it("PO prepared → Accounting's voucher; then the chain's own roles", () => {
    expect(boughtInPurchasePending([row("APPROVED", { poApproved: true, hasPo: true })]).roles).toEqual(["accounting"]);
    expect(boughtInPurchasePending([row("VOUCHER_READY", { poApproved: true, hasPo: true })]).roles).toEqual(["payment_approver"]);
    expect(boughtInPurchasePending([row("TASKED", { poApproved: true, hasPo: true })]).roles).toEqual(["logistics"]);
    expect(boughtInPurchasePending([row("LOGISTICS_CONFIRMED", { poApproved: true, hasPo: true })]).roles).toEqual(["purchaser"]);
  });
  it("still pending the Plant Manager → the Plant Manager", () => {
    expect(boughtInPurchasePending([row("PENDING_APPROVAL")]).roles).toEqual(["plant_manager"]);
  });
  it("bought → Sales notifies the client (the same test the server makes)", () => {
    for (const s of ["PURCHASED", "CHECKED", "DELIVERED", "RECEIVED", "PLANT_APPROVED", "COMPLETED"]) {
      expect(boughtInPurchasePending([row(s, { hasPo: true, poApproved: true }), row("APPROVED")])).toEqual({ action: "Notify Client — Order Ready", roles: [], sales: true });
    }
  });
  it("two requests at different steps → both roles", () => {
    expect(boughtInPurchasePending([row("APPROVED"), row("VOUCHER_READY", { hasPo: true, poApproved: true })]).roles).toEqual(["payment_approver"]);
    expect(boughtInPurchasePending([row("APPROVED"), row("APPROVED", { poApproved: true, hasPo: true })]).roles).toEqual(["payment_approver", "accounting"]);
  });
  it("no live request (none, rejected, cancelled) → the Purchaser, as before", () => {
    expect(boughtInPurchasePending([])).toEqual(PREPARE_PO_STEP);
    expect(boughtInPurchasePending([row("REJECTED"), row("CANCELLED")])).toEqual(PREPARE_PO_STEP);
  });
});

describe("pendingStep takes it only where it applies", () => {
  const at = (stage: string) => readOrderWorkflow({ workflow: { stage } });
  const pa = { action: "Approve purchase", roles: ["payment_approver" as const] };
  it("bought-in at released → the request's step; without one → the Purchaser", () => {
    expect(pendingStep(at("released"), false, false, false, false, pa)).toEqual(pa);
    expect(pendingStep(at("released"))?.roles).toEqual(["purchaser"]);
  });
  it("a from-stock order at released ignores it", () => {
    expect(pendingStep(at("released"), true, false, false, false, pa)?.roles).toEqual(["warehouse"]);
  });
  it("any other stage ignores it", () => {
    expect(pendingStep(at("docs_checked"), false, false, false, false, pa)?.roles).toEqual(["payment_approver"]);
    expect(pendingStep(at("payment_review"), false, false, false, false, pa)?.roles).toEqual(["accounting"]);
  });
});

describe("no request yet — nothing is raised automatically any more", () => {
  it("waits on the Purchaser to request the items", () => {
    expect(PREPARE_PO_STEP).toEqual({ action: "Request the bought-in items", roles: ["purchaser"] });
  });
});
