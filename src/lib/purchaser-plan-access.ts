/**
 * Who may open the Purchaser Plan, and who may fill it in.
 *
 * The owner: *"In purchaser role, engineer role, admin role, payment approver
 * role. Add a tile named 'Purchaser Plan'."* — and, asked who may set Type and
 * Client due date: all four, **showing who edited and when**.
 *
 * ONE definition, read by the dashboard that draws the tile, the page that
 * renders the table and the server actions that save it — the lesson of
 * `catalogue-access.ts`: a gate written in three places eventually means three
 * different things. Asserted for every role at once in the test beside it.
 *
 * Note the mix: Purchaser and Payment Approver are WORKFLOW roles (Admin →
 * Workflow roles), Engineer is an ACCOUNT role. An Engineer who has been given
 * no workflow role at all still gets the plan.
 */
import type { User } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { userHasWorkflowRole, type WorkflowRoleAssignments, type WorkflowRoleKey } from "@/lib/workflow-roles";

export interface PurchaserPlanAccess {
  /** The dashboard tile, and the page. */
  canView: boolean;
  /** Set Type and Client due date. Same four seats — the owner's choice. */
  canEdit: boolean;
}

export function purchaserPlanAccess(user: Pick<User, "id" | "role"> | null | undefined, roles: WorkflowRoleAssignments): PurchaserPlanAccess {
  if (!user) return { canView: false, canEdit: false };
  const has = (r: WorkflowRoleKey) => userHasWorkflowRole(roles, user.id, r);
  const ok = isAdmin(user as User) || user.role === "ENGINEER" || has("purchaser") || has("payment_approver");
  return { canView: ok, canEdit: ok };
}
