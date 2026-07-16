/**
 * Orders currently waiting on a given user's approval. Used to ring the approver
 * alarm: whenever an order reaches a stage whose pending step needs a workflow
 * role the viewer holds (or a Sales step they own), it shows up here.
 */
import { prisma } from "@/lib/db";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { readOrderWorkflow, pendingStep } from "@/lib/order-workflow";
import { saleFromClassification, isSaleConfirmed } from "@/lib/sale";

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
  const [quotes, assignments] = await Promise.all([
    prisma.quotation.findMany({
      where: { inquiry: { status: "WON" } },
      include: { inquiry: { include: { customer: true } } },
      orderBy: { createdAt: "desc" },
    }),
    getWorkflowRoles(),
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

    out.push({
      id: q.id,
      code: q.quoteNumber,
      company: q.inquiry.customer.company,
      action: pend.action,
    });
  }
  return out;
}
