/**
 * Client-visibility policy. Certain shop-floor roles must not see client
 * identity (name / company / contact person / numbers) or any client purchase
 * amounts (order value, line prices, collected/outstanding, commissions).
 *
 * A viewer is restricted only when they hold a restricted role and NOTHING that
 * grants visibility — Admins, Sales and Engineers always see, and any
 * non-restricted workflow role (Purchaser, Accounting, Payment Approver,
 * Technical Head, 2nd QI, Head — Motor Controller, Logistics) grants visibility.
 */
import type { User } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { userHasWorkflowRole, WORKFLOW_ROLE_KEYS, type WorkflowRoleAssignments, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { getRolePermissions, roleHasCapability } from "@/lib/role-permissions";

/**
 * Whether the viewer must have client identity and purchase amounts hidden.
 * Driven by the `restrict_client_data` capability per role (Admin → Role
 * permissions). A viewer is restricted when they hold a role with it ON and no
 * role with it OFF — any visibility-granting role wins.
 */
export async function isClientRestricted(user: User | null, assignments: WorkflowRoleAssignments): Promise<boolean> {
  if (!user) return false;
  if (isAdmin(user) || user.role === "SALES" || user.role === "ENGINEER") return false;
  const roles = WORKFLOW_ROLE_KEYS.filter((k) => userHasWorkflowRole(assignments, user.id, k as WorkflowRoleKey));
  if (roles.length === 0) return false;
  const perms = await getRolePermissions();
  const hasRestricted = roles.some((r) => roleHasCapability(perms, r, "restrict_client_data"));
  const hasVisible = roles.some((r) => !roleHasCapability(perms, r, "restrict_client_data"));
  return hasRestricted && !hasVisible;
}

export const CLIENT_HIDDEN = "Client hidden";
export const AMOUNT_HIDDEN = "₱ —";

/** Mask a client identity string for a restricted viewer. */
export function maskClient(value: string | null | undefined, restricted: boolean, fallback = CLIENT_HIDDEN): string {
  return restricted ? fallback : value ?? "";
}
