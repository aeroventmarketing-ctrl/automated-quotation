/**
 * Role access gate. An admin can disable one or more base roles from using
 * AeroERP; a signed-in user whose role is disabled is blocked from every app
 * feature and setting (they see an "access disabled" screen). Admins can never
 * be disabled — so you can't lock yourself out. Stored in AppSetting (no
 * migration); the default is everyone enabled.
 */
import { Prisma } from "@prisma/client";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";

export const ROLE_ACCESS_KEY = "role_access";

/** The base roles that can be toggled (ADMIN is always enabled). */
export const GATEABLE_ROLES: { key: Role; label: string; description: string }[] = [
  { key: "SALES", label: "Sales", description: "Sales staff — inquiries, quotations, follow-ups, orders." },
  { key: "ENGINEER", label: "Engineer", description: "Engineers — quotations, job-order issuance, technical review." },
  { key: "OTHER", label: "Other (shop-floor & office staff)", description: "Everyone who is neither Sales nor Engineer — Accounting, Approver, Purchaser, Warehouse, Production heads, QI, Plant Manager, Logistics, etc. Their abilities come from their workflow roles." },
];

const GATEABLE_KEYS = new Set<string>(GATEABLE_ROLES.map((r) => r.key));

/** The base roles an admin has disabled. ADMIN is never included. */
export async function getDisabledRoles(): Promise<Role[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: ROLE_ACCESS_KEY } });
  const v = (row?.value as { disabled?: unknown } | null)?.disabled;
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Role => typeof x === "string" && GATEABLE_KEYS.has(x) && x !== "ADMIN");
}

/** Replace the disabled-roles list (ADMIN is always dropped). */
export async function setDisabledRoles(roles: string[]): Promise<Role[]> {
  const clean = [...new Set(roles.filter((r) => GATEABLE_KEYS.has(r) && r !== "ADMIN"))] as Role[];
  await prisma.appSetting.upsert({
    where: { key: ROLE_ACCESS_KEY },
    create: { key: ROLE_ACCESS_KEY, value: { disabled: clean } as Prisma.InputJsonValue },
    update: { value: { disabled: clean } as Prisma.InputJsonValue },
  });
  return clean;
}

/** Whether a role may currently use the app. ADMIN is always enabled. */
export function isRoleEnabled(role: Role, disabled: Role[]): boolean {
  if (role === "ADMIN") return true;
  return !disabled.includes(role);
}
