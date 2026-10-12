/**
 * THE BIR 2303 GRID — who opens a client's certificate, and who uploads, reads
 * and edits it.
 *
 * The owner: Sales or Accounting uploads it. Admin as always. Every other seat is
 * asserted too, so a widening shows up here as a moved cell, not in production.
 */
import { describe, it, expect } from "vitest";
import type { WorkflowRoleAssignments } from "@/lib/workflow-roles";
import { bir2303Access } from "./bir2303-access";

const WHO = {
  admin: { base: "ADMIN", roles: [] },
  sales: { base: "SALES", roles: [] },
  accounting: { base: "OTHER", roles: ["accounting"] },
  paymentApprover: { base: "OTHER", roles: ["payment_approver"] },
  engineer: { base: "ENGINEER", roles: [] },
  purchaser: { base: "OTHER", roles: ["purchaser"] },
  warehouse: { base: "OTHER", roles: ["warehouse"] },
  plantManager: { base: "OTHER", roles: ["plant_manager"] },
  logistics: { base: "OTHER", roles: ["logistics"] },
  prodHead: { base: "OTHER", roles: ["prod_head_fans"] },
  nobody: { base: "OTHER", roles: [] },
} as const;
type Who = keyof typeof WHO;

const access = (w: Who, base: string = WHO[w].base, roles: readonly string[] = WHO[w].roles) =>
  bir2303Access({ id: w, role: base } as never, { [w]: [...roles] } as WorkflowRoleAssignments);

/** [open the file, upload · read · edit] */
const GRID: Record<Who, [boolean, boolean]> = {
  admin: [true, true],
  sales: [true, true],
  accounting: [true, true],
  paymentApprover: [true, false],
  engineer: [true, false],
  purchaser: [false, false],
  warehouse: [false, false],
  plantManager: [false, false],
  logistics: [false, false],
  prodHead: [false, false],
  nobody: [false, false],
};

describe("the BIR 2303 grid", () => {
  for (const w of Object.keys(WHO) as Who[]) {
    const [view, edit] = GRID[w];
    it(`${w} → open ${view} · edit ${edit}`, () => {
      expect(access(w)).toEqual({ canView: view, canEdit: edit });
    });
  }
});

describe("two seats at once — the union", () => {
  it("an Engineer who also holds Accounting edits as Accounting", () => {
    expect(access("engineer", "ENGINEER", ["accounting"]).canEdit).toBe(true);
  });
  it("nobody signed in → nothing", () => {
    expect(bir2303Access(null, {})).toEqual({ canView: false, canEdit: false });
  });
});
