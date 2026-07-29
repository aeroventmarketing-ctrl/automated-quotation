/**
 * Server-side access check for Counter Sales. Shared by the pages, the server
 * actions and the upload API routes so they all agree on who may use the module.
 */
import type { User } from "@prisma/client";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, WORKFLOW_ROLE_KEYS, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { counterSaleRoleAllowed } from "@/lib/counter-sale";

/** The signed-in user + whether they may use Counter Sales. */
export async function getCounterSaleViewer(): Promise<{ user: User | null; allowed: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { user: null, allowed: false };
  const assignments = await getWorkflowRoles();
  const workflowRoles = WORKFLOW_ROLE_KEYS.filter((k) => userHasWorkflowRole(assignments, user.id, k as WorkflowRoleKey));
  const allowed = counterSaleRoleAllowed({ admin: isAdmin(user), baseRole: user.role, workflowRoles: [...workflowRoles] });
  return { user, allowed };
}
