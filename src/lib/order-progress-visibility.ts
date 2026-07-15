/**
 * Admin toggle to hide order workflow progress from Sales & Engineer.
 *
 * When ON, users whose base role is SALES or ENGINEER — and who do not hold any
 * ERP workflow role (and are not admins) — cannot see the order's workflow
 * progress (stages, approvals, job orders, materials, purchasing, delivery).
 * People assigned a workflow role keep access so they can still act on the order.
 * Stored in the AppSetting key/value table (no migration). Default OFF.
 */
import { Prisma } from "@prisma/client";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { userHasWorkflowRole, WORKFLOW_ROLES, type WorkflowRoleAssignments } from "@/lib/workflow-roles";

export const HIDE_ORDER_PROGRESS_KEY = "hide_order_progress";

/** Whether order progress is hidden from Sales & Engineer (default false). */
export async function getHideOrderProgress(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key: HIDE_ORDER_PROGRESS_KEY } });
  const v = (row?.value as { enabled?: unknown } | null) ?? null;
  return v?.enabled === true;
}

/** Enable/disable hiding order progress from Sales & Engineer. */
export async function setHideOrderProgress(enabled: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: HIDE_ORDER_PROGRESS_KEY },
    create: { key: HIDE_ORDER_PROGRESS_KEY, value: { enabled } as Prisma.InputJsonValue },
    update: { value: { enabled } as Prisma.InputJsonValue },
  });
}

/**
 * Whether this viewer's order progress should be hidden, given the toggle state.
 * Hidden for SALES/ENGINEER who are not admins and hold no workflow role.
 */
export function progressHiddenFor(
  hideEnabled: boolean,
  viewer: { id: string; role: Role } | null,
  isAdminViewer: boolean,
  assignments: WorkflowRoleAssignments,
): boolean {
  if (!hideEnabled || !viewer || isAdminViewer) return false;
  const isSalesOrEngineer = viewer.role === "SALES" || viewer.role === "ENGINEER";
  if (!isSalesOrEngineer) return false;
  const holdsWorkflowRole = WORKFLOW_ROLES.some((r) => userHasWorkflowRole(assignments, viewer.id, r.key));
  return !holdsWorkflowRole;
}
