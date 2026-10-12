/**
 * THE BIR 2303 GRID — who opens a client's certificate, and who uploads, reads
 * and edits it.
 *
 * The owner: *"Allow sales account holder, accounting, admin and payment approver
 * change the 2303 section."* So Sales edits only the clients they hold. Every
 * other seat is asserted too, so a widening shows up here as a moved cell, not in
 * production.
 */
import { describe, it, expect } from "vitest";
import type { WorkflowRoleAssignments } from "@/lib/workflow-roles";
import { bir2303Access } from "./bir2303-access";

const HOLDER = "the-holder";

const WHO = {
  admin: { base: "ADMIN", roles: [] },
  accounting: { base: "OTHER", roles: ["accounting"] },
  paymentApprover: { base: "OTHER", roles: ["payment_approver"] },
  accountHolder: { base: "SALES", roles: [] },
  otherSales: { base: "SALES", roles: [] },
  engineer: { base: "ENGINEER", roles: [] },
  purchaser: { base: "OTHER", roles: ["purchaser"] },
  warehouse: { base: "OTHER", roles: ["warehouse"] },
  plantManager: { base: "OTHER", roles: ["plant_manager"] },
  logistics: { base: "OTHER", roles: ["logistics"] },
  prodHead: { base: "OTHER", roles: ["prod_head_fans"] },
  nobody: { base: "OTHER", roles: [] },
} as const;
type Who = keyof typeof WHO;

const idOf = (w: Who) => (w === "accountHolder" ? HOLDER : w);
const access = (w: Who, base: string = WHO[w].base, roles: readonly string[] = WHO[w].roles, holder: string | null = HOLDER) =>
  bir2303Access({ id: idOf(w), role: base } as never, { [idOf(w)]: [...roles] } as WorkflowRoleAssignments, holder);

/** [open the file, upload · read · edit] */
const GRID: Record<Who, [boolean, boolean]> = {
  admin: [true, true],
  accounting: [true, true],
  paymentApprover: [true, true],
  accountHolder: [true, true],
  otherSales: [true, false],
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

describe("the account holder is about THIS client", () => {
  it("a Sales user holding a different client can't edit this one", () => {
    expect(access("accountHolder", "SALES", [], "someone-else").canEdit).toBe(false);
  });
  it("a client with no holder: only the three finance/admin seats edit", () => {
    expect(access("accountHolder", "SALES", [], null).canEdit).toBe(false);
    expect(access("paymentApprover", "OTHER", ["payment_approver"], null).canEdit).toBe(true);
  });
  it("nobody signed in → nothing, even with a holder id", () => {
    expect(bir2303Access(null, {}, HOLDER)).toEqual({ canView: false, canEdit: false });
  });
});
