/**
 * Client-visibility policy. Certain shop-floor roles must not see client
 * identity (name / company / contact person / numbers) or any client purchase
 * amounts (order value, line prices, collected/outstanding, commissions).
 *
 * A viewer is restricted only when they hold a restricted role and NOTHING that
 * grants visibility — Admins, Sales and Engineers always see, and any
 * non-restricted workflow role (Purchaser, Accounting, Payment Approver,
 * Technical Head, 1st QI, Head — Motor Controller, Logistics) grants visibility.
 */
import type { User } from "@prisma/client";
import { isAdmin } from "@/lib/auth";
import { userHasWorkflowRole, WORKFLOW_ROLE_KEYS, type WorkflowRoleAssignments, type WorkflowRoleKey } from "@/lib/workflow-roles";

export const CLIENT_RESTRICTED_ROLES = [
  "quality_inspector_2",
  "prod_head_fans",
  "prod_head_duct",
  "prod_head_accessories",
  "warehouse",
  "plant_manager",
] as const;

const RESTRICTED = new Set<string>(CLIENT_RESTRICTED_ROLES);

/** Whether the viewer must have client identity and purchase amounts hidden. */
export function isClientRestricted(user: User | null, assignments: WorkflowRoleAssignments): boolean {
  if (!user) return false;
  if (isAdmin(user) || user.role === "SALES" || user.role === "ENGINEER") return false;
  const roles = WORKFLOW_ROLE_KEYS.filter((k) => userHasWorkflowRole(assignments, user.id, k as WorkflowRoleKey));
  if (roles.length === 0) return false;
  const hasRestricted = roles.some((r) => RESTRICTED.has(r));
  const hasTrusted = roles.some((r) => !RESTRICTED.has(r));
  return hasRestricted && !hasTrusted;
}

export const CLIENT_HIDDEN = "Client hidden";
export const AMOUNT_HIDDEN = "₱ —";

/** Mask a client identity string for a restricted viewer. */
export function maskClient(value: string | null | undefined, restricted: boolean, fallback = CLIENT_HIDDEN): string {
  return restricted ? fallback : value ?? "";
}
