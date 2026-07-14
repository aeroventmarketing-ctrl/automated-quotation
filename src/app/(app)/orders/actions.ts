"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, workflowRoleLabel } from "@/lib/workflow-roles";
import { ORDER_STEPS, readOrderWorkflow, type OrderStepKey } from "@/lib/order-workflow";

/**
 * Advance an order through a Phase 1 approval step. The signed-in user must hold
 * the step's workflow role (or be an admin), and the order must be at the step's
 * "from" stage. Records the sign-off (who + when) and moves the stage forward.
 */
export async function advanceOrderStage(quotationId: string, step: OrderStepKey): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");

  const def = ORDER_STEPS[step];
  if (!def) throw new Error("Unknown step");

  const assignments = await getWorkflowRoles();
  const allowed = isAdmin(user) || userHasWorkflowRole(assignments, user.id, def.requiredRole);
  if (!allowed) {
    throw new Error(`Only ${workflowRoleLabel(def.requiredRole)} or an admin can do this.`);
  }

  const quote = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { id: true, classification: true },
  });
  if (!quote) throw new Error("Order not found");

  const wf = readOrderWorkflow(quote.classification);
  if (wf.stage !== def.from) {
    throw new Error("This step isn't available at the order's current stage.");
  }

  const cls = (quote.classification as Record<string, unknown>) ?? {};
  const workflow = {
    ...wf,
    stage: def.to,
    approvals: {
      ...wf.approvals,
      [step]: { by: user.id, byName: user.name, at: new Date().toISOString() },
    },
  };

  await prisma.quotation.update({
    where: { id: quotationId },
    data: { classification: { ...cls, workflow } as unknown as Prisma.InputJsonObject },
  });
  revalidatePath("/orders");
}
