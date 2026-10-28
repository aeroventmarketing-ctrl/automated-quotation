/**
 * Who may change a PO's date (see lib/po-date). The owner: *"build for admin,
 * payment approver role and purchaser role."*
 */
import type { User } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { userHasWorkflowRole, type WorkflowRoleAssignments } from "@/lib/workflow-roles";

export function canChangePoDate(user: User | null | undefined, roles: WorkflowRoleAssignments): boolean {
  if (!user) return false;
  return isAdmin(user) || userHasWorkflowRole(roles, user.id, "purchaser") || userHasWorkflowRole(roles, user.id, "payment_approver");
}
