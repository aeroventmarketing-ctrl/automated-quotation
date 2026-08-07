/**
 * Orders currently waiting on a given user's approval. Used to ring the approver
 * alarm: whenever an order reaches a stage whose pending step needs a workflow
 * role the viewer holds (or a Sales step they own), it shows up here.
 */
import { prisma } from "@/lib/db";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { readOrderWorkflow, pendingStep, phaseAnchor } from "@/lib/order-workflow";
import { isStockOnlyOrder, isDuctHardwareStockOnly } from "@/lib/department-pnl";
import { saleFromClassification, isSaleConfirmed } from "@/lib/sale";
import { getNotificationBaseline, passesNotificationBaseline } from "@/lib/notification-baseline";
import { getAlertGoLive, alertPasses } from "@/lib/alert-golive";

export interface PendingApproval {
  id: string;
  code: string; // quote/order number
  company: string;
  action: string; // what the approver must do
  anchor: string; // phase-card id to deep-link to (e.g. "phase-2"), "" if none
}

interface Viewer {
  id: string;
  role: string;
}

/** Confirmed orders awaiting `user`'s approval (empty for users who owe nothing). */
export async function pendingApprovalsForUser(user: Viewer): Promise<PendingApproval[]> {
  const [quotes, assignments, baseline, golive] = await Promise.all([
    // Source from confirmed sales — NOT inquiry.status === "WON". A quotation
    // revision reopens the inquiry (status leaves WON), so a WON filter would
    // drop confirmed orders that still owe this user an approval. isSaleConfirmed
    // below is the real gate, exactly as the departmental P&L does it.
    prisma.quotation.findMany({
      include: { inquiry: { include: { customer: true } }, items: true },
      orderBy: { createdAt: "desc" },
    }),
    getWorkflowRoles(),
    getNotificationBaseline(),
    getAlertGoLive(),
  ]);

  const out: PendingApproval[] = [];
  for (const q of quotes) {
    const sale = saleFromClassification(q.classification);
    if (!sale || !isSaleConfirmed(sale)) continue;

    const wf = readOrderWorkflow(q.classification);
    const stockOnly = isStockOnlyOrder(q.items);
    const pend = pendingStep(wf, stockOnly, stockOnly && isDuctHardwareStockOnly(q.items));
    if (!pend) continue;
    // Production underway ("Complete production") is ongoing work, not an approval
    // awaiting a decision — don't ring the alarm for it once production has
    // started. It still appears as a task on My Dashboard; this only silences the
    // siren so the production heads aren't alarmed on every page load while they
    // build.
    if (wf.stage === "producing") continue;

    const owesByRole = pend.roles.some((r) => userHasWorkflowRole(assignments, user.id, r as WorkflowRoleKey));
    const owesBySales = !!pend.sales && (user.role === "SALES" || user.role === "ENGINEER" || q.preparedById === user.id);
    const owesByEngineer = !!pend.engineer && user.role === "ENGINEER";
    if (!owesByRole && !owesBySales && !owesByEngineer) continue;

    // Notification backlog reset: hide orders that were already awaiting this
    // step before the reset (practice slate). "Pending since" = the most recent
    // approval stamp (when it entered this step), or the order's creation time.
    const stampTimes = Object.values(wf.approvals ?? {})
      .map((s) => (s as { at?: string } | null)?.at)
      .filter((t): t is string => !!t);
    const pendingSince = stampTimes.length ? [...stampTimes].sort().at(-1)! : q.createdAt.toISOString();
    if (!passesNotificationBaseline(pendingSince, baseline)) continue;
    // Alerts go-live gate: silent before launch; afterwards only approvals that
    // entered their step after the go-live moment ring (pre-launch backlog stays quiet).
    if (!alertPasses(pendingSince, golive)) continue;

    out.push({
      id: q.id,
      code: q.quoteNumber,
      company: q.inquiry.customer.company,
      action: pend.action,
      anchor: phaseAnchor(wf.stage),
    });
  }
  return out;
}
