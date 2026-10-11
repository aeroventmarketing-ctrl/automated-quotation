/**
 * THE PURCHASER PLAN'S GRID — who sees the tile and the table, who fills it in.
 *
 * The owner named exactly four: *"purchaser role, engineer role, admin role,
 * payment approver role"*, and gave all four the edit. Every other seat is
 * asserted false so a widening shows up here as a moved cell, not in production.
 */
import { describe, it, expect } from "vitest";
import type { WorkflowRoleAssignments } from "@/lib/workflow-roles";
import { purchaserPlanAccess } from "./purchaser-plan-access";

const WHO = {
  admin: { base: "ADMIN", roles: [] },
  engineer: { base: "ENGINEER", roles: [] },
  purchaser: { base: "OTHER", roles: ["purchaser"] },
  paymentApprover: { base: "OTHER", roles: ["payment_approver"] },
  sales: { base: "SALES", roles: [] },
  warehouse: { base: "OTHER", roles: ["warehouse"] },
  accounting: { base: "OTHER", roles: ["accounting"] },
  plantManager: { base: "OTHER", roles: ["plant_manager"] },
  logistics: { base: "OTHER", roles: ["logistics"] },
  prodHead: { base: "OTHER", roles: ["prod_head_fans"] },
  nobody: { base: "OTHER", roles: [] },
} as const;
type Who = keyof typeof WHO;

const access = (w: Who) =>
  purchaserPlanAccess({ id: w, role: WHO[w].base } as never, { [w]: [...WHO[w].roles] } as WorkflowRoleAssignments);

const ALLOWED: Who[] = ["admin", "engineer", "purchaser", "paymentApprover"];

describe("the Purchaser Plan grid", () => {
  for (const w of Object.keys(WHO) as Who[]) {
    const yes = ALLOWED.includes(w);
    it(`${w} → ${yes ? "sees and edits" : "nothing"}`, () => {
      expect(access(w)).toEqual({ canView: yes, canEdit: yes });
    });
  }

  it("an Engineer needs no workflow role — it is their account role", () => {
    expect(purchaserPlanAccess({ id: "e", role: "ENGINEER" } as never, {})).toEqual({ canView: true, canEdit: true });
  });

  it("nobody signed in → nothing", () => {
    expect(purchaserPlanAccess(null, {})).toEqual({ canView: false, canEdit: false });
  });
});
