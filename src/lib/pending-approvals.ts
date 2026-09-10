/**
 * Orders currently waiting on a given user's approval. Used to ring the approver
 * alarm: whenever an order reaches a stage whose pending step needs a workflow
 * role the viewer holds (or a Sales step they own), it shows up here.
 */
import { Prisma } from "@prisma/client";
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
    //
    // ## Why this query is shaped so carefully
    //
    // The approver alarm is mounted in the app-wide layout and polls this every
    // 30 seconds, for every signed-in user, on every page. It used to be an
    // unfiltered `findMany` with `items: true` — EVERY quotation ever written,
    // every inquiry, every customer and every quotation item, fetched in full
    // and then thrown away by the loop below. Postgres recorded it as the single
    // biggest consumer in the database: 531 million rows and nine hours of
    // execution across 585,000 calls, and it was a large share of a 7 TB egress
    // bill.
    //
    // Two changes, neither of which moves the gate:
    //
    //  1. **`where` — a necessary condition, asked in SQL.** `isSaleConfirmed`
    //     returns false immediately unless the sale carries a PO, so a row whose
    //     `sale.po` is absent can never survive the loop. Filtering on it here
    //     cannot drop an order the loop would have kept; it is deliberately
    //     NECESSARY rather than sufficient, and the real gate below is unchanged
    //     and still runs on everything this returns. (A JSON `null` po and a sale
    //     with no arrangement both still come back, and are still rejected below.)
    //  2. **`select` — only what the loop reads.** Notably `items` narrows to the
    //     three fields `isStockOnlyOrder` / `isDuctHardwareStockOnly` actually
    //     take, and the customer to its `company`.
    //
    // If you add a field to the loop, add it here too — a missing one is a type
    // error, not a silent wrong answer, which is why this is `select` and not
    // `omit`.
    prisma.quotation.findMany({
      where: { classification: { path: ["sale", "po"], not: Prisma.DbNull } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        quoteNumber: true,
        classification: true,
        preparedById: true,
        createdAt: true,
        inquiry: { select: { customer: { select: { company: true } } } },
        items: { select: { qty: true, descriptionSnapshot: true, specsSnapshot: true } },
      },
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
    const pend = pendingStep(wf, stockOnly, stockOnly && isDuctHardwareStockOnly(q.items), wf.officePickup === true, wf.fulfillmentMode === "plant_pickup");
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
