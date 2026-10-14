"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { purchaserPlanAccess } from "@/lib/purchaser-plan-access";
import { isYMD } from "@/lib/order-client-due";

/**
 * Set (or clear, with "") the order's Client Due Date — the only place it is
 * edited; the Purchase Plan shows it read-only.
 *
 * ONE statement does all of it: the new date, who and when, and a line at the
 * head of the history (from → to). So there is no state in which the date moved
 * and the history doesn't say who moved it, and — being `jsonb_set` on the one
 * key rather than a rewrite of the classification blob — a date pick can never
 * undo somebody's workflow step saved a moment earlier. Setting the date it
 * already has writes nothing.
 */
export async function setOrderClientDue(quotationId: string, date: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!purchaserPlanAccess(user, await getWorkflowRoles()).canEditClientDue) {
    throw new Error("Only Sales, an Engineer, the Payment Approver or an admin can set the client due date.");
  }
  const value = date.trim();
  if (value && !isYMD(value)) throw new Error("That isn't a valid date.");
  const at = new Date().toISOString();
  const n = await prisma.$executeRaw`
    update "Quotation"
    set "classification" = jsonb_set(
      coalesce("classification", '{}'::jsonb),
      '{clientDue}',
      jsonb_build_object(
        'date', ${value}::text,
        'byName', ${user.name}::text,
        'at', ${at}::text,
        'history',
          jsonb_build_array(jsonb_build_object(
            'from', coalesce("classification" -> 'clientDue' ->> 'date', ''),
            'to', ${value}::text,
            'byName', ${user.name}::text,
            'at', ${at}::text
          )) || coalesce("classification" -> 'clientDue' -> 'history', '[]'::jsonb)
      ),
      true)
    where "id" = ${quotationId}
      and coalesce("classification" -> 'clientDue' ->> 'date', '') <> ${value}::text`;
  if (n === 0) {
    const exists = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { id: true } });
    if (!exists) throw new Error("Order not found.");
    return; // already that date — nothing to record
  }
  revalidatePath(`/orders/${quotationId}`);
  revalidatePath("/purchase-plan");
}
