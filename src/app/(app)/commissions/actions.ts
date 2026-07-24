"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { logActivity } from "@/lib/activity-log";

/** Mark a commission paid / unpaid. Accounting or admin only. */
export async function markCommissionPaid(commissionId: string, paid: boolean): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "accounting" as WorkflowRoleKey))) {
    throw new Error("Only Accounting or an admin can update commission payments.");
  }
  const c = await prisma.commission.update({
    where: { id: commissionId },
    data: paid
      ? { paid: true, paidAt: new Date(), paidByName: user.name }
      : { paid: false, paidAt: null, paidByName: null },
  });
  await logActivity(user, {
    action: paid ? "commission.paid" : "commission.unpaid",
    category: "commission",
    summary: `Commission marked ${paid ? "paid" : "unpaid"} — ${c.salespersonName} (₱${Number(c.amount).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`,
    entity: "commission",
    entityId: commissionId,
    href: "/commissions",
  });
  revalidatePath("/commissions");
}
