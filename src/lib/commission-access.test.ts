import { describe, it, expect } from "vitest";
import { commissionAccess, earnsCommission } from "./commission-access";

/**
 * The whole grid at once, the way `catalogue-access.test.ts` does it: change a
 * rule, update the expected row, and read every cell that moved.
 *
 * The row that exists because of a real bug is **JayR Basal** — an ENGINEER who
 * holds *Sales Head* and *2nd Quality Inspector* and is ticked *Credit as
 * salesperson*. He earns the 0.25% override, and three separate gates keyed on
 * `role === "SALES"` each locked him out of his own money.
 */
type Person = {
  who: string;
  admin?: boolean;
  baseRole: string;
  workflowRoles?: string[];
  salesPersonnel?: boolean;
  earns: boolean;
  canView: boolean;
  canSeeAll: boolean;
  canManage: boolean;
};

const PEOPLE: Person[] = [
  { who: "Admin", admin: true, baseRole: "ADMIN", earns: false, canView: true, canSeeAll: true, canManage: true },
  { who: "Accounting", baseRole: "OTHER", workflowRoles: ["accounting"], earns: false, canView: true, canSeeAll: true, canManage: true },
  { who: "Payment Approver", baseRole: "OTHER", workflowRoles: ["payment_approver"], earns: false, canView: true, canSeeAll: true, canManage: false },
  { who: "Sales rep", baseRole: "SALES", earns: true, canView: true, canSeeAll: false, canManage: false },
  // The bug, pinned:
  { who: "JayR — Engineer, Sales Head, 2nd QC, credited", baseRole: "ENGINEER", workflowRoles: ["sales_head", "quality_inspector_2"], salesPersonnel: true, earns: true, canView: true, canSeeAll: false, canManage: false },
  { who: "Sales Head who sells nothing and isn't credited", baseRole: "ENGINEER", workflowRoles: ["sales_head"], earns: true, canView: true, canSeeAll: false, canManage: false },
  { who: "Engineer credited as salesperson only", baseRole: "ENGINEER", salesPersonnel: true, earns: true, canView: true, canSeeAll: false, canManage: false },
  // …and the people who must still be kept out.
  { who: "Plain Engineer", baseRole: "ENGINEER", earns: false, canView: false, canSeeAll: false, canManage: false },
  { who: "Warehouse", baseRole: "OTHER", workflowRoles: ["warehouse"], earns: false, canView: false, canSeeAll: false, canManage: false },
  { who: "2nd Quality Inspector alone", baseRole: "OTHER", workflowRoles: ["quality_inspector_2"], earns: false, canView: false, canSeeAll: false, canManage: false },
  { who: "Purchaser", baseRole: "OTHER", workflowRoles: ["purchaser"], earns: false, canView: false, canSeeAll: false, canManage: false },
];

describe("who may see commissions", () => {
  for (const p of PEOPLE) {
    it(p.who, () => {
      const opts = {
        admin: p.admin ?? false,
        baseRole: p.baseRole,
        workflowRoles: p.workflowRoles ?? [],
        salesPersonnel: p.salesPersonnel ?? false,
      };
      expect(earnsCommission(opts)).toBe(p.earns);
      expect(commissionAccess(opts)).toEqual({
        canView: p.canView,
        canSeeAll: p.canSeeAll,
        canManage: p.canManage,
      });
    });
  }

  it("never lets someone who only earns see other people's commissions", () => {
    for (const p of PEOPLE.filter((x) => x.earns && !x.admin && !(x.workflowRoles ?? []).some((r) => r === "accounting" || r === "payment_approver"))) {
      const a = commissionAccess({
        admin: false, baseRole: p.baseRole,
        workflowRoles: p.workflowRoles ?? [], salesPersonnel: p.salesPersonnel ?? false,
      });
      expect(a.canView).toBe(true);
      expect(a.canSeeAll).toBe(false);
      expect(a.canManage).toBe(false);
    }
  });

  it("holding a hiding role does not remove access someone has earned", () => {
    // The 2nd-QC role hides the Commissions TAB for a plain QC. It must not take
    // the page away from a Sales Head who happens to also run 2nd QC.
    const qcOnly = commissionAccess({ admin: false, baseRole: "OTHER", workflowRoles: ["quality_inspector_2"], salesPersonnel: false });
    const headAndQc = commissionAccess({ admin: false, baseRole: "ENGINEER", workflowRoles: ["quality_inspector_2", "sales_head"], salesPersonnel: false });
    expect(qcOnly.canView).toBe(false);
    expect(headAndQc.canView).toBe(true);
  });
});
