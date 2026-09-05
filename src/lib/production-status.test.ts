import { describe, it, expect } from "vitest";
import { isLiveProduction, productionRowsForOrder, type ProductionOrderRef } from "./production-status";
import { ORDER_STAGES, type OrderStage, type OrderWorkflow } from "./order-workflow";

const REF: ProductionOrderRef = {
  orderId: "q1", company: "ACME BUILDERS", quoteNumber: "AFBM-2026-0101", projectName: "Tower 3",
};

const wf = (stage: OrderStage, jobOrders: Record<string, { status?: string; dueAt?: string }> = {}) =>
  ({ stage, jobOrders } as unknown as OrderWorkflow);

const TODAY = "2026-09-05";

/**
 * The owner, looking at the Production Status card: *"Once item is delivered
 * remove it from the list."*
 *
 * A department that never stamped its job order "finished" kept a row here for
 * good — so an order the client already had kept accruing "37d overdue" beside
 * orders still on the shop floor.
 */
describe("how long an order's production stays on the list", () => {
  it("starts when the job orders are released", () => {
    expect(isLiveProduction("released")).toBe(false); // JOs not out yet
    expect(isLiveProduction("in_production")).toBe(true);
  });

  it("ends the moment the order is delivered, whatever the job orders say", () => {
    expect(isLiveProduction("delivery_docs_ready")).toBe(true);
    expect(isLiveProduction("delivered")).toBe(false);
    // …and stays off for every stage after it, up to and including closed.
    for (const s of ORDER_STAGES.slice(ORDER_STAGES.findIndex((x) => x.key === "delivered"))) {
      expect(isLiveProduction(s.key), s.key).toBe(false);
    }
  });

  it("drops a delivered order's unfinished, overdue job order", () => {
    const jos = { duct: { status: "in_production", dueAt: "2026-07-30" } };
    // The very row the owner was looking at: 37 days overdue, never finished.
    expect(productionRowsForOrder(REF, wf("producing", jos), TODAY)).toHaveLength(1);
    expect(productionRowsForOrder(REF, wf("delivered", jos), TODAY)).toEqual([]);
    expect(productionRowsForOrder(REF, wf("closed", jos), TODAY)).toEqual([]);
  });
});

describe("the rows one live order contributes", () => {
  it("is one per department still owing work, with the days to its deadline", () => {
    const rows = productionRowsForOrder(REF, wf("producing", {
      fans: { status: "in_production", dueAt: "2026-09-09" },
      duct: { status: "issued", dueAt: "2026-08-30" },
    }), TODAY);
    expect(rows.map((r) => `${r.dept} ${r.days}`)).toEqual(["Fans & Blower 4", "Duct -6"]);
    // It carries the order's identity through, so the card can link and label it.
    expect(rows[0]).toMatchObject({ orderId: "q1", company: "ACME BUILDERS", quoteNumber: "AFBM-2026-0101" });
  });

  it("leaves out a finished job order, and one nobody has dated", () => {
    const rows = productionRowsForOrder(REF, wf("producing", {
      fans: { status: "finished", dueAt: "2026-09-09" },
      duct: { status: "in_production" },
      accessories: { status: "issued", dueAt: "2026-09-06" },
    }), TODAY);
    expect(rows.map((r) => r.dept)).toEqual(["Accessories"]);
  });

  it("counts a deadline as a calendar day, so today is 0 and not late", () => {
    const [row] = productionRowsForOrder(REF, wf("producing", { fans: { status: "issued", dueAt: TODAY } }), TODAY);
    expect(row.days).toBe(0);
  });
});
