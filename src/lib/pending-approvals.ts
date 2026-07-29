/**
 * Orders currently waiting on a given user's approval. Used to ring the approver
 * alarm: whenever an order reaches a stage whose pending step needs a workflow
 * role the viewer holds (or a Sales step they own), it shows up here.
 */
import { prisma } from "@/lib/db";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { readOrderWorkflow, pendingStep } from "@/lib/order-workflow";
import { saleFromClassification, isSaleConfirmed } from "@/lib/sale";
import { getNotificationBaseline, passesNotificationBaseline } from "@/lib/notification-baseline";

export interface PendingApproval {
  id: string;
  code: string; // quote/order number
  company: string;
  action: string; // what the approver must do
}

interface Viewer {
  id: string;
  role: string;
}

/** Confirmed orders awaiting `user`'s approval (empty for users who owe nothing). */
export async function pendingApprovalsForUser(user: Viewer): Promise<PendingApproval[]> {
  const [quotes, assignments, baseline] = await Promise.all([
    prisma.quotation.findMany({
      where: { inquiry: { status: "WON" } },
      include: { inquiry: { include: { customer: true } } },
      orderBy: { createdAt: "desc" },
    }),
    getWorkflowRoles(),
    getNotificationBaseline(),
  ]);

  const out: PendingApproval[] = [];
  for (const q of quotes) {
    const sale = saleFromClassification(q.classification);
    if (!sale || !isSaleConfirmed(sale)) continue;

    const wf = readOrderWorkflow(q.classification);
    const pend = pendingStep(wf);
    if (!pend) continue;

    const owesByRole = pend.roles.some((r) => userHasWorkflowRole(assignments, user.id, r as WorkflowRoleKey));
    const owesBySales = !!pend.sales && (user.role === "SALES" || user.role === "ENGINEER" || q.preparedById === user.id);
    if (!owesByRole && !owesBySales) continue;

    // Notification backlog reset: hide orders that were already awaiting this
    // step before the reset (practice slate). "Pending since" = the most recent
    // approval stamp (when it entered this step), or the order's creation time.
    const stampTimes = Object.values(wf.approvals ?? {})
      .map((s) => (s as { at?: string } | null)?.at)
      .filter((t): t is string => !!t);
    const pendingSince = stampTimes.length ? [...stampTimes].sort().at(-1)! : q.createdAt.toISOString();
    if (!passesNotificationBaseline(pendingSince, baseline)) continue;

    out.push({
      id: q.id,
      code: q.quoteNumber,
      company: q.inquiry.customer.company,
      action: pend.action,
    });
  }
  return out;
}
