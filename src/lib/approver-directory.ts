/**
 * Resolves, for each workflow role, the names of the people currently assigned
 * to it — so "awaiting approval" affordances can name who must act, not just the
 * role. One `getApproverDirectory()` call per page; look up names by role key.
 */
import { prisma } from "@/lib/db";
import {
  getWorkflowRoles,
  usersWithWorkflowRole,
  workflowRoleLabel,
  type WorkflowRoleKey,
} from "@/lib/workflow-roles";

export interface ApproverDirectory {
  /** Assigned people's names for a workflow role key (empty if none/unassigned). */
  namesFor: (role: string) => string[];
  /** The human label for a workflow role key. */
  labelFor: (role: string) => string;
}

export async function getApproverDirectory(): Promise<ApproverDirectory> {
  const [assignments, users] = await Promise.all([
    getWorkflowRoles(),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const nameById = new Map(users.map((u) => [u.id, u.name] as const));
  return {
    namesFor: (role: string) =>
      usersWithWorkflowRole(assignments, role as WorkflowRoleKey)
        .map((id) => nameById.get(id))
        .filter((n): n is string => !!n),
    labelFor: (role: string) => workflowRoleLabel(role),
  };
}
