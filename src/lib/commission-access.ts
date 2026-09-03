/**
 * Who may see commissions, and whose. ONE definition, because the last time a
 * rule like this lived inline in each screen the answers drifted and a person was
 * offered a tab the page then refused (see `catalogue-access.ts` and the note in
 * CLAUDE.md).
 *
 * The trap this exists to close: **earning a commission is not the same as having
 * the SALES base role.** JayR Basal is an ENGINEER who holds *Sales Head* and is
 * ticked *Credit as salesperson*; he earns the 0.25% override, and every gate keyed
 * on `role === "SALES"` locked him out of his own money — the nav hid the tab (his
 * 2nd-QC role hides it), the page refused him, and the dashboard tile never
 * rendered. Three gates, one wrong assumption.
 */

/** Anyone who can EARN a commission, and so must be able to see their own. */
export function earnsCommission(opts: { baseRole: string; workflowRoles: string[]; salesPersonnel: boolean }): boolean {
  // A SALES user sells by definition.
  if (opts.baseRole === "SALES") return true;
  // "Credit as salesperson" — an Engineer who also sells (the same flag that
  // gives them Counter Sales). They are credited on quotations, so they earn.
  if (opts.salesPersonnel) return true;
  // The Sales Head earns the override on other people's months even when they
  // sell nothing themselves, so they must see it without being a salesperson.
  return opts.workflowRoles.includes("sales_head");
}

export interface CommissionAccess {
  /** May open the Commissions page at all. */
  canView: boolean;
  /** Sees EVERY salesperson's commissions, not only their own. */
  canSeeAll: boolean;
  /** May record payouts (mark paid / release a voucher) and open a cash voucher. */
  canManage: boolean;
}

export function commissionAccess(opts: {
  admin: boolean;
  baseRole: string;
  workflowRoles: string[];
  salesPersonnel: boolean;
}): CommissionAccess {
  const has = (r: string) => opts.workflowRoles.includes(r);
  // Accounting computes and pays them; an admin can do anything.
  const canManage = opts.admin || has("accounting");
  // The Payment Approver approves the money, so they see the whole picture —
  // but they do not record the payout.
  const canSeeAll = canManage || has("payment_approver");
  return { canView: canSeeAll || earnsCommission(opts), canSeeAll, canManage };
}
