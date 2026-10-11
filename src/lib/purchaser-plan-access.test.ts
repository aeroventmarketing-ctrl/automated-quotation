/**
 * THE PURCHASER PLAN'S GRID — who sees the tile and the table, and who fills in
 * which column.
 *
 * The owner: Sales sees it and edits the Client due date; the Purchaser does NOT
 * edit the Client due date; Engineer, Admin and Payment Approver edit it. Type
 * stays with the four who had it — Sales was granted the Client due date only.
 * Every other seat is asserted to get nothing, so a widening shows up here as a
 * moved cell rather than in production.
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

const access = (w: Who, base: string = WHO[w].base, roles: readonly string[] = WHO[w].roles) =>
  purchaserPlanAccess({ id: w, role: base } as never, { [w]: [...roles] } as WorkflowRoleAssignments);

/** [see, Type, Client due date] */
const GRID: Record<Who, [boolean, boolean, boolean]> = {
  admin: [true, true, true],
  paymentApprover: [true, true, true],
  engineer: [true, true, true],
  purchaser: [true, true, false],
  sales: [true, false, true],
  warehouse: [false, false, false],
  accounting: [false, false, false],
  plantManager: [false, false, false],
  logistics: [false, false, false],
  prodHead: [false, false, false],
  nobody: [false, false, false],
};

describe("the Purchaser Plan grid", () => {
  for (const w of Object.keys(WHO) as Who[]) {
    const [see, type, due] = GRID[w];
    it(`${w} → see ${see} · Type ${type} · Client due ${due}`, () => {
      expect(access(w)).toEqual({ canView: see, canEditType: type, canEditClientDue: due });
    });
  }
});

describe("two seats at once — the union", () => {
  it("a Purchaser who is also an Engineer edits the Client due date as the Engineer", () => {
    expect(access("purchaser", "ENGINEER", ["purchaser"]).canEditClientDue).toBe(true);
  });
  it("a Sales user who also holds Purchaser edits both columns", () => {
    expect(access("sales", "SALES", ["purchaser"])).toEqual({ canView: true, canEditType: true, canEditClientDue: true });
  });
});

describe("the account roles need no workflow role", () => {
  it("a bare Engineer and a bare Sales user both qualify", () => {
    expect(purchaserPlanAccess({ id: "e", role: "ENGINEER" } as never, {}).canView).toBe(true);
    expect(purchaserPlanAccess({ id: "s", role: "SALES" } as never, {}).canView).toBe(true);
  });
  it("nobody signed in → nothing", () => {
    expect(purchaserPlanAccess(null, {})).toEqual({ canView: false, canEditType: false, canEditClientDue: false });
  });
});
