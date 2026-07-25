/**
 * Price-visibility policy for the Inventory and Products lists. Costs and selling
 * prices are commercial data: only the Purchaser, Engineers, Accounting and
 * admins may see them. Everyone else who can open those pages (Warehouse, Plant
 * Manager, Logistics, …) sees the items and quantities but not the money columns.
 */
import type { User } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { userHasWorkflowRole, type WorkflowRoleAssignments, type WorkflowRoleKey } from "@/lib/workflow-roles";

/** Workflow roles (beyond admin / Engineer) allowed to see prices. */
const PRICE_ROLES: WorkflowRoleKey[] = ["purchaser", "accounting"];

/** Whether the viewer may see unit costs, selling prices and stock value. */
export function canViewPrices(user: User | null | undefined, assignments: WorkflowRoleAssignments): boolean {
  if (!user) return false;
  if (isAdmin(user) || user.role === "ENGINEER") return true;
  return PRICE_ROLES.some((r) => userHasWorkflowRole(assignments, user.id, r));
}
