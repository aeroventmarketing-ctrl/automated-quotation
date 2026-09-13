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
// The alarm reads exactly two parts of `classification` — `sale`, to confirm the
// order, and `workflow`, to find the pending step. The keys it never opens are
// subtracted in Postgres so they never cross the wire; the list, and why it is a
// blacklist rather than a whitelist, lives in `lib/slim-classification`, which
// the other six confirmed-order readers share.
import { UNREAD_CLASSIFICATION_KEYS } from "@/lib/slim-classification";

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

interface AlarmOrder {
  id: string;
  quoteNumber: string;
  classification: unknown;
  preparedById: string;
  createdAt: Date;
  company: string;
  items: { qty: number; descriptionSnapshot: string; specsSnapshot: unknown }[];
}

/**
 * The alarm's read, and why it is shaped so carefully.
 *
 * This is mounted in the app-wide layout and polled by every signed-in user on
 * every page. It began as an unfiltered `findMany` with `items: true` — every
 * quotation ever written, every inquiry, every customer and every line item,
 * fetched whole and thrown away by the loop below. Postgres recorded it as the
 * single biggest consumer in the database: 531 million rows across 585,000
 * calls. Three rounds of work later it is still the top query by bytes, at
 * ~6,953 calls a day.
 *
 * Three things it does, none of which moves the gate:
 *
 *  1. **A necessary condition in SQL.** `isSaleConfirmed` returns false without
 *     a PO, so a row whose `sale.po` is absent can never survive the loop.
 *     Asking for it here cannot drop an order the loop would have kept — it is
 *     deliberately NECESSARY rather than sufficient, and the real gate still
 *     runs on everything returned. (A JSON `null` po and a sale with no
 *     arrangement both still come back, and are still rejected below.)
 *  2. **Dead weight subtracted** — see `UNREAD_CLASSIFICATION_KEYS`.
 *  3. **The customer joined rather than `include`d**, which saves the two extra
 *     round trips Prisma made to fetch inquiries and then customers. Both
 *     relations are required with foreign keys, so the inner joins cannot drop a
 *     row `include` would have kept.
 *
 * The line items are fetched SEPARATELY and grouped here, which is worth
 * explaining because the first version did not. Aggregating them into the same
 * query with a lateral `json_agg` looked tidier and cost three times the
 * Postgres IO — measured at 299 shared buffers against 223 for the split, on a
 * fixture of nineteen orders with six lines each. Fewer round trips is not worth
 * that: the goal here is bytes on the wire, and the wire does not care how many
 * statements produced them.
 *
 * Raw SQL because the key-stripping is not expressible in Prisma's `select`.
 * `items` still carries only the three fields `isStockOnlyOrder` /
 * `isDuctHardwareStockOnly` read; add a field to the loop and it must be added
 * here too.
 */
async function confirmedOrdersForAlarm(): Promise<AlarmOrder[]> {
  const rows = await prisma.$queryRaw<Omit<AlarmOrder, "items">[]>`
    select q."id",
           q."quoteNumber",
           q."preparedById",
           q."createdAt",
           q."classification" - ${UNREAD_CLASSIFICATION_KEYS}::text[] as "classification",
           cu."company"
    from "Quotation" q
    join "Inquiry" i on i."id" = q."inquiryId"
    join "Customer" cu on cu."id" = i."customerId"
    where q."classification" #> '{sale,po}' is not null
    -- id breaks the tie. Orders can share a createdAt, and with only that to
    -- sort by Postgres may return tied rows in any order, so the alarm list
    -- could reshuffle between polls. Prisma had the same instability; comparing
    -- the two implementations is what made it visible.
    order by q."createdAt" desc, q."id" desc
  `;
  if (rows.length === 0) return [];

  const lines = await prisma.quotationItem.findMany({
    where: { quotationId: { in: rows.map((r) => r.id) } },
    select: { quotationId: true, qty: true, descriptionSnapshot: true, specsSnapshot: true },
  });
  const byQuotation = new Map<string, AlarmOrder["items"]>();
  for (const l of lines) {
    const bucket = byQuotation.get(l.quotationId);
    const item = { qty: l.qty, descriptionSnapshot: l.descriptionSnapshot, specsSnapshot: l.specsSnapshot };
    if (bucket) bucket.push(item);
    else byQuotation.set(l.quotationId, [item]);
  }
  return rows.map((r) => ({ ...r, items: byQuotation.get(r.id) ?? [] }));
}

/** Confirmed orders awaiting `user`'s approval (empty for users who owe nothing). */
export async function pendingApprovalsForUser(user: Viewer): Promise<PendingApproval[]> {
  const [quotes, assignments, baseline, golive] = await Promise.all([
    // Source from confirmed sales — NOT inquiry.status === "WON". A quotation
    // revision reopens the inquiry (status leaves WON), so a WON filter would
    // drop confirmed orders that still owe this user an approval.
    // `isSaleConfirmed` below is the real gate, exactly as the departmental P&L
    // does it. See `confirmedOrdersForAlarm` for how the read is shaped and why.
    confirmedOrdersForAlarm(),
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
      company: q.company,
      action: pend.action,
      anchor: phaseAnchor(wf.stage),
    });
  }
  return out;
}
