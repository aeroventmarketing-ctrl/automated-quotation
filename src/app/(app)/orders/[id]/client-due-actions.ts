"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { purchaserPlanAccess } from "@/lib/purchaser-plan-access";
import { isYMD } from "@/lib/order-client-due";

/**
 * Set (or clear, with "") the order's Client Due Date.
 *
 * Written with `jsonb_set` on the one key, in one statement, rather than
 * read-modify-write of the whole classification: an order page has many hands
 * on that blob at once, and a date picker must never be the thing that undoes
 * somebody's workflow step saved a moment earlier.
 */
export async function setOrderClientDue(quotationId: string, date: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!purchaserPlanAccess(user, await getWorkflowRoles()).canEditClientDue) {
    throw new Error("Only Sales, an Engineer, the Payment Approver or an admin can set the client due date.");
  }
  const value = date.trim();
  if (value && !isYMD(value)) throw new Error("That isn't a valid date.");
  const n = value
    ? await prisma.$executeRaw`
        update "Quotation"
        set "classification" = jsonb_set(coalesce("classification", '{}'::jsonb), '{clientDue}',
          ${JSON.stringify({ date: value, byName: user.name, at: new Date().toISOString() })}::jsonb, true)
        where "id" = ${quotationId}`
    : await prisma.$executeRaw`
        update "Quotation" set "classification" = coalesce("classification", '{}'::jsonb) - 'clientDue'
        where "id" = ${quotationId}`;
  if (n === 0) throw new Error("Order not found.");
  revalidatePath(`/orders/${quotationId}`);
}
