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

/** Workflow roles (beyond admin) allowed to SET unit cost / selling price. */
const PRICE_EDIT_ROLES: WorkflowRoleKey[] = ["purchaser"];

/** Whether the viewer may see unit costs, selling prices and stock value. */
export function canViewPrices(user: User | null | undefined, assignments: WorkflowRoleAssignments): boolean {
  if (!user) return false;
  if (user.role === "SALES") return false; // Sales never see inventory/product prices.
  if (isAdmin(user) || user.role === "ENGINEER") return true;
  return PRICE_ROLES.some((r) => userHasWorkflowRole(assignments, user.id, r));
}

/** Whether the viewer may edit an item's unit cost and selling price. */
export function canEditPrices(user: User | null | undefined, assignments: WorkflowRoleAssignments): boolean {
  if (!user) return false;
  if (user.role === "SALES") return false; // Sales never set prices.
  if (isAdmin(user)) return true;
  return PRICE_EDIT_ROLES.some((r) => userHasWorkflowRole(assignments, user.id, r));
}
