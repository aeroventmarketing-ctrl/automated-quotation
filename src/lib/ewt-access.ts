/**
 * Who may use the EWT Summary — page, exports, uploads and saves alike. The
 * owner: *"In admin, payment approver and accounting My Dashboard"*.
 */
import type { User } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { userHasWorkflowRole, type WorkflowRoleAssignments } from "@/lib/workflow-roles";

export function canUseEwtSummary(user: User | null | undefined, roles: WorkflowRoleAssignments): boolean {
  if (!user) return false;
  return isAdmin(user) || userHasWorkflowRole(roles, user.id, "payment_approver") || userHasWorkflowRole(roles, user.id, "accounting");
}
