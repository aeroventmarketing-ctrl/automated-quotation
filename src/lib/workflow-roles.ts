/**
 * Workflow (ERP) roles — the departmental roles that drive the order-to-delivery
 * approval routing (Accounting, Payment Approver, Technical Head, Production heads,
 * Warehouse, Purchaser, Logistics, Plant Manager).
 *
 * These are separate from the app's base Role enum (SALES / ENGINEER / ADMIN) so
 * we don't need a database migration to add them: assignments (userId → role keys)
 * ride in the AppSetting key/value table, the same pattern as the account registry.
 * A user can hold several workflow roles.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const WORKFLOW_ROLES = [
  { key: "accounting", label: "Accounting", group: "Finance" },
  { key: "payment_approver", label: "Payment Approver", group: "Finance" },
  { key: "technical_head", label: "Technical Head", group: "Production" },
  { key: "prod_head_fans", label: "Head — Fans & Blower", group: "Production" },
  { key: "prod_head_duct", label: "Head — Duct", group: "Production" },
  { key: "prod_head_accessories", label: "Head — Accessories", group: "Production" },
  { key: "prod_head_motor", label: "Head — Motor Controller", group: "Production" },
  { key: "warehouse", label: "Warehouse", group: "Supply chain" },
  { key: "purchaser", label: "Purchaser", group: "Supply chain" },
  { key: "logistics", label: "Logistics", group: "Supply chain" },
  { key: "plant_manager", label: "Plant Manager", group: "Supply chain" },
] as const;

export type WorkflowRoleKey = (typeof WORKFLOW_ROLES)[number]["key"];

export const WORKFLOW_ROLE_KEYS: readonly string[] = WORKFLOW_ROLES.map((r) => r.key);
const VALID = new Set(WORKFLOW_ROLE_KEYS);

export const WORKFLOW_ROLES_KEY = "workflow_roles";

export type WorkflowRoleAssignments = Record<string, string[]>;

/** Read the whole registry (userId → role keys), dropping any unknown keys. */
export async function getWorkflowRoles(): Promise<WorkflowRoleAssignments> {
  const row = await prisma.appSetting.findUnique({ where: { key: WORKFLOW_ROLES_KEY } });
  const raw = (row?.value as { assignments?: unknown } | null)?.assignments;
  const out: WorkflowRoleAssignments = {};
  if (raw && typeof raw === "object") {
    for (const [uid, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        const clean = v.filter((x): x is string => typeof x === "string" && VALID.has(x));
        if (clean.length) out[uid] = clean;
      }
    }
  }
  return out;
}

/** Set one user's workflow roles (validated + deduped). Returns what was stored. */
export async function setUserWorkflowRoles(userId: string, roles: string[]): Promise<string[]> {
  const clean = Array.from(new Set(roles.filter((r) => VALID.has(r))));
  const all = await getWorkflowRoles();
  if (clean.length) all[userId] = clean;
  else delete all[userId];
  await prisma.appSetting.upsert({
    where: { key: WORKFLOW_ROLES_KEY },
    create: { key: WORKFLOW_ROLES_KEY, value: { assignments: all } as Prisma.InputJsonValue },
    update: { value: { assignments: all } as Prisma.InputJsonValue },
  });
  return clean;
}

/** Whether a user holds a given workflow role. */
export function userHasWorkflowRole(
  assignments: WorkflowRoleAssignments,
  userId: string,
  role: WorkflowRoleKey,
): boolean {
  return (assignments[userId] ?? []).includes(role);
}

/** Human label for a workflow role key. */
export function workflowRoleLabel(key: string): string {
  return WORKFLOW_ROLES.find((r) => r.key === key)?.label ?? key;
}

/** All user IDs holding a given workflow role. */
export function usersWithWorkflowRole(
  assignments: WorkflowRoleAssignments,
  role: WorkflowRoleKey,
): string[] {
  return Object.entries(assignments)
    .filter(([, roles]) => roles.includes(role))
    .map(([uid]) => uid);
}
