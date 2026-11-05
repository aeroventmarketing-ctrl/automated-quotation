"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { logActivity } from "@/lib/activity-log";
import { readOrderWorkflow } from "@/lib/order-workflow";
import { readClientDue } from "@/lib/order-client-due";
import { readRush, applyRushStep, canRequestRush, canDecideRush, type RushStep } from "@/lib/rush-order";

export type RushResult = { ok: true } | { ok: false; error: string };

const SUMMARY: Record<RushStep["kind"], string> = {
  request: "RUSH requested",
  approve: "RUSH approved",
  decline: "RUSH request declined",
  mark: "Marked RUSH",
  remove: "RUSH removed",
};

/**
 * One rush step on an order — request (the Sales in-charge), approve / decline /
 * mark / remove (the Payment Approver or an admin). See lib/rush-order.
 *
 * Written with `jsonb_set` on the one `rush` key, guarded by the state it was
 * read in, so it can neither undo a workflow step saved a moment earlier nor
 * race another rush decision: if the state moved meanwhile, nothing is written
 * and the person is told to look again.
 */
export async function rushStep(quotationId: string, step: RushStep): Promise<RushResult> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: "Please sign in again." };
    const q = await prisma.quotation.findUnique({
      where: { id: quotationId },
      select: { id: true, quoteNumber: true, preparedById: true, classification: true },
    });
    if (!q) return { ok: false, error: "Order not found." };

    const roles = await getWorkflowRoles();
    const decider = canDecideRush({ admin: isAdmin(user), paymentApprover: userHasWorkflowRole(roles, user.id, "payment_approver" as WorkflowRoleKey) });
    if (step.kind === "request") {
      if (!canRequestRush({ userId: user.id, preparedById: q.preparedById })) {
        return { ok: false, error: "Only the order's Sales in-charge can request RUSH." };
      }
    } else if (!decider) {
      return { ok: false, error: "Only the Payment Approver or an admin can do this." };
    }

    const current = readRush(q.classification);
    const next = applyRushStep(current, step, {
      byName: user.name,
      at: new Date().toISOString(),
      hasClientDue: !!readClientDue(q.classification)?.date,
      closed: readOrderWorkflow(q.classification).stage === "closed",
    });
    if (typeof next === "string") return { ok: false, error: next };

    const prev = current?.state ?? "";
    const n = await prisma.$executeRaw`
      update "Quotation"
      set "classification" = jsonb_set(coalesce("classification", '{}'::jsonb), '{rush}', ${JSON.stringify(next)}::jsonb, true)
      where "id" = ${quotationId}
        and coalesce("classification" -> 'rush' ->> 'state', '') = ${prev}::text`;
    if (n === 0) return { ok: false, error: "Someone changed this order's RUSH just now — refresh and look again." };

    await logActivity(user, {
      action: `order.rush.${step.kind}`,
      category: "order",
      summary: `${SUMMARY[step.kind]} — ${q.quoteNumber}${next.history[0]?.note ? ` — ${next.history[0].note}` : ""}`,
      entity: "order",
      entityId: quotationId,
      href: `/orders/${quotationId}#phase-1`,
    });
    // Every screen the order shows on carries the flag.
    for (const p of ["/orders", `/orders/${quotationId}`, "/my-dashboard", "/purchasing", "/purchase-plan", "/management"]) revalidatePath(p);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save the RUSH change." };
  }
}
