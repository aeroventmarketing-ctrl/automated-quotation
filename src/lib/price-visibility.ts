/**
 * Price-visibility policy for the Inventory and Products lists. Costs and selling
 * prices are commercial data: only the Purchaser, Engineers, Accounting and
 * admins may see them. Everyone else who can open those pages (Warehouse, Plant
 * Manager, Logistics, …) sees the items and quantities but not the money columns.
 *
 * Sales are hard-excluded here: a Sales user never sees inventory/product prices
 * even if they also hold a price-granting workflow role. (Sales still see the
 * SELLING price on the Check-availability tool, which is their pricing surface.)
 */
import type { User } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { userHasWorkflowRole, type WorkflowRoleAssignments, type WorkflowRoleKey } from "@/lib/workflow-roles";

/** Workflow roles (beyond admin / Engineer) allowed to see prices. */
const PRICE_ROLES: WorkflowRoleKey[] = ["purchaser", "accounting"];

/**
 * Workflow roles (beyond admin) allowed to SET unit cost / selling price.
 *
 * Owner's decision: the catalogue price is what a purchase order defaults to, so
 * it belongs to the **Payment Approver**, not to the Purchaser who spends
 * against it — a default set by the same person who spends against it is not a
 * control. See `src/lib/price-authority.ts`, which enforces the same rule on the
 * server; this list is the UI half, and the two must agree.
 *
 * VIEWING is untouched — `PRICE_ROLES` above is deliberately not widened. Whoever
 * could see a price before still sees it (Purchaser, Accounting, Engineer,
 * admin) and whoever could not still cannot (Warehouse, Plant Manager,
 * Logistics, Sales). This list only decides who may CHANGE one.
 */
const PRICE_EDIT_ROLES: WorkflowRoleKey[] = ["payment_approver"];

/** Whether the viewer may see unit costs, selling prices and stock value. */
export function canViewPrices(user: User | null | undefined, assignments: WorkflowRoleAssignments): boolean {
  if (!user) return false;
  if (user.role === "SALES") return false; // Sales never see inventory/product prices.
  if (isAdmin(user) || user.role === "ENGINEER") return true;
  return PRICE_ROLES.some((r) => userHasWorkflowRole(assignments, user.id, r));
}

/**
 * Whether the viewer may see purchase/PO money amounts (PO totals, net, line
 * prices, release totals) on the Orders and Purchasing surfaces. Only the people
 * who act on the money — the Purchaser, Accounting, the Payment Approver — plus
 * Engineers/management and admins. Everyone else who monitors the chain (Plant
 * Manager, production heads, Warehouseman, Logistics, QC, Technical Head, Sales)
 * sees the items and progress but not the peso amounts.
 */
const AMOUNT_ROLES: WorkflowRoleKey[] = ["purchaser", "accounting", "payment_approver"];
export function canViewOrderAmounts(user: User | null | undefined, assignments: WorkflowRoleAssignments): boolean {
  if (!user) return false;
  if (user.role === "SALES") return false;
  if (isAdmin(user) || user.role === "ENGINEER") return true;
  return AMOUNT_ROLES.some((r) => userHasWorkflowRole(assignments, user.id, r));
}

/**
 * Whether the viewer may see the supplier's name on the Orders and Purchasing
 * surfaces. Same allow-list as the money amounts — only the Purchaser,
 * Accounting, the Payment Approver, Engineers and admins. Everyone else who
 * monitors the chain sees the PO and progress but not who the supplier is.
 */
export function canViewSupplier(user: User | null | undefined, assignments: WorkflowRoleAssignments): boolean {
  return canViewOrderAmounts(user, assignments);
}

/** Whether the viewer may edit an item's unit cost and selling price. */
export function canEditPrices(user: User | null | undefined, assignments: WorkflowRoleAssignments): boolean {
  if (!user) return false;
  if (user.role === "SALES") return false; // Sales never set prices.
  if (isAdmin(user)) return true;
  return PRICE_EDIT_ROLES.some((r) => userHasWorkflowRole(assignments, user.id, r));
}
