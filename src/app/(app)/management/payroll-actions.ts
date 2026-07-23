"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { PNL_DEPARTMENTS, zeroSplit, type DeptKey, type DeptSplit } from "@/lib/department-pnl";
import type { User } from "@prisma/client";

const DEPT_KEYS = new Set<DeptKey>(PNL_DEPARTMENTS.map((d) => d.key));

/** Who may view/edit departmental payroll: an Admin or a Payment Approver. */
export async function canManagePayroll(user: User): Promise<boolean> {
  if (isAdmin(user)) return true;
  const roles = await getWorkflowRoles();
  return userHasWorkflowRole(roles, user.id, "payment_approver" as WorkflowRoleKey);
}

/** Every YYYY-MM from `fromYm` to `toYm` inclusive. */
function monthsBetween(fromYm: string, toYm: string): string[] {
  const [lo, hi] = fromYm <= toYm ? [fromYm, toYm] : [toYm, fromYm];
  const out: string[] = [];
  let [y, m] = lo.split("-").map(Number);
  const [hy, hm] = hi.split("-").map(Number);
  while (y < hy || (y === hy && m <= hm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    if (out.length > 240) break; // safety
  }
  return out;
}

/** Saved payroll for one month, as a per-department amount map (0 where unset). */
export async function getPayrollMonth(month: string): Promise<DeptSplit> {
  const user = await getCurrentUser();
  if (!user || !(await canManagePayroll(user))) throw new Error("Unauthorized");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Invalid month.");
  const out = zeroSplit();
  const rows = await prisma.payroll.findMany({ where: { month } });
  for (const r of rows) if (DEPT_KEYS.has(r.dept as DeptKey)) out[r.dept as DeptKey] = Number(r.amount) || 0;
  return out;
}

/** Upsert a month's payroll amounts (one row per department). */
export async function savePayrollMonth(month: string, amounts: Partial<Record<DeptKey, number>>): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !(await canManagePayroll(user))) throw new Error("Unauthorized");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Invalid month.");
  for (const d of PNL_DEPARTMENTS) {
    const amount = Math.max(0, Number(amounts[d.key]) || 0);
    await prisma.payroll.upsert({
      where: { dept_month: { dept: d.key, month } },
      update: { amount, createdByName: user.name },
      create: { dept: d.key, month, amount, createdByName: user.name },
    });
  }
  revalidatePath("/management");
}

/**
 * Payroll expense per department for the months overlapping [fromYm, toYm].
 * Returns all-zero (never throws) if the table isn't migrated yet, so the P&L
 * degrades gracefully until 0026_payroll is applied.
 */
export async function payrollExpenseForRange(fromYm: string, toYm: string): Promise<DeptSplit> {
  const out = zeroSplit();
  try {
    const months = monthsBetween(fromYm, toYm);
    const rows = await prisma.payroll.findMany({ where: { month: { in: months } } });
    for (const r of rows) if (DEPT_KEYS.has(r.dept as DeptKey)) out[r.dept as DeptKey] += Number(r.amount) || 0;
  } catch {
    // table not migrated yet — treat as no payroll
  }
  return out;
}
