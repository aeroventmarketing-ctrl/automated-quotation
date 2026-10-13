/**
 * THE RECEIPT GENERATION GRID — Accounting, the Payment Approver and Admin;
 * every other seat asserted shut, so a widening shows up here as a moved cell.
 */
import { describe, it, expect } from "vitest";
import type { WorkflowRoleAssignments } from "@/lib/workflow-roles";
import { canGenerateReceipts } from "./receipts-access";
import { visibleNav } from "@/components/app-nav";
import { receiptsApplyTo } from "@/lib/bir-receipts";

const WHO = {
  admin: { base: "ADMIN", roles: [] },
  accounting: { base: "OTHER", roles: ["accounting"] },
  paymentApprover: { base: "OTHER", roles: ["payment_approver"] },
  sales: { base: "SALES", roles: [] },
  engineer: { base: "ENGINEER", roles: [] },
  purchaser: { base: "OTHER", roles: ["purchaser"] },
  warehouse: { base: "OTHER", roles: ["warehouse"] },
  plantManager: { base: "OTHER", roles: ["plant_manager"] },
  logistics: { base: "OTHER", roles: ["logistics"] },
  salesHead: { base: "SALES", roles: ["sales_head"] },
  nobody: { base: "OTHER", roles: [] },
} as const;
type Who = keyof typeof WHO;

const GRID: Record<Who, boolean> = {
  admin: true,
  accounting: true,
  paymentApprover: true,
  sales: false,
  engineer: false,
  purchaser: false,
  warehouse: false,
  plantManager: false,
  logistics: false,
  salesHead: false,
  nobody: false,
};

describe("the Receipt Generation grid", () => {
  for (const w of Object.keys(WHO) as Who[]) {
    it(`${w} → ${GRID[w]}`, () => {
      const { base, roles } = WHO[w];
      expect(canGenerateReceipts({ id: w, role: base } as never, { [w]: [...roles] } as WorkflowRoleAssignments)).toBe(GRID[w]);
    });
  }
  it("it lives on the order page now — no sidebar tab for anyone", () => {
    for (const w of Object.keys(WHO) as Who[]) {
      expect(visibleNav(WHO[w].base as never, [...WHO[w].roles]).map((n) => n.href)).not.toContain("/receipts");
    }
  });
});

describe("which orders get the box", () => {
  it("VAT Inclusive, Zero Rated and VAT Exclusive +12% — not VAT Exclusive (÷1.12)", () => {
    expect(["INCLUSIVE", "ZERO_RATED", "EXCLUSIVE_PLUS", "EXCLUSIVE"].map(receiptsApplyTo)).toEqual([true, true, true, false]);
  });
});
