/**
 * THE RECEIPT GENERATION GRID — Accounting, the Payment Approver and Admin;
 * every other seat asserted shut, so a widening shows up here as a moved cell.
 */
import { describe, it, expect } from "vitest";
import type { WorkflowRoleAssignments } from "@/lib/workflow-roles";
import { canGenerateReceipts } from "./receipts-access";
import { visibleNav } from "@/components/app-nav";

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

describe("the Receipt Generation grid — the rule and the tab agree", () => {
  for (const w of Object.keys(WHO) as Who[]) {
    it(`${w} → ${GRID[w]}`, () => {
      const { base, roles } = WHO[w];
      expect(canGenerateReceipts({ id: w, role: base } as never, { [w]: [...roles] } as WorkflowRoleAssignments)).toBe(GRID[w]);
      const hrefs = visibleNav(base as never, [...roles]).map((n) => n.href);
      expect(hrefs.includes("/receipts")).toBe(GRID[w]);
    });
  }
  it("sits below Cash Requests and above Commissions", () => {
    const hrefs = visibleNav("OTHER" as never, ["accounting"]).map((n) => n.href);
    const i = hrefs.indexOf("/receipts");
    expect(hrefs[i - 1]).toBe("/cash-requests");
    expect(hrefs[i + 1]).toBe("/commissions");
  });
});
