/**
 * Orders currently waiting on a given user's approval. Used to ring the approver
 * alarm: whenever an order reaches a stage whose pending step needs a workflow
 * role the viewer holds (or a Sales step they own), it shows up here.
 */
import { boughtInPendingLookup } from "@/lib/bought-in-pending-data";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { readOrderWorkflow, pendingStep, phaseAnchor } from "@/lib/order-workflow";
import { isStockOnlyOrder, isDuctHardwareStockOnly } from "@/lib/department-pnl";
import { saleFromClassification, isSaleConfirmed } from "@/lib/sale";
import { getNotificationBaseline, passesNotificationBaseline } from "@/lib/notification-baseline";
import { getAlertGoLive, alertPasses, type AlertGoLive } from "@/lib/alert-golive";
// The alarm reads exactly two parts of `classification` — `sale`, to confirm the
// order, and `workflow`, to find the pending step. The keys it never opens are
// subtracted in Postgres so they never cross the wire; the list, and why it is a
// blacklist rather than a whitelist, lives in `lib/slim-classification`, which
// the other six confirmed-order readers share.
import { UNREAD_CLASSIFICATION_KEYS } from "@/lib/slim-classification";
import { jobOrderTasks, issuedJobOrderNotices, JOB_ORDER_STAGES } from "@/lib/job-order-tasks";
import { quotationJobOrderDepts } from "@/lib/job-order-autogen";

export interface PendingApproval {
  id: string;
  code: string; // quote/order number
  company: string;
  action: string; // what the approver must do
  anchor: string; // phase-card id to deep-link to (e.g. "phase-2"), "" if none
  /** What is owed on the order — the alarm rings once per key, so a new step rings anew. */
  key: string;
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
 *
 * ## The fourth thing: orders that cannot ring
 *
 * The loop below ends with `if (!alertPasses(q.createdAt, golive)) continue` —
 * the owner's *"Transactions before August 1, 2026 should not give any alarm or
 * notifications. Date before the said day is a testing stage."*
 *
 * That test was being applied AFTER fetching the order and all of its line
 * items. Every order from the practice weeks — and they are the oldest and most
 * numerous, since the system was being exercised then — was read out of Postgres
 * in full, on every poll, by every user, to be discarded on the last line of the
 * loop. So the gate comes into the SQL, where it can stop the read instead of
 * the loop.
 *
 * It is the SAME comparison, not a narrower one: `alertPasses` passes everything
 * when the gate is off (hence the empty fragment), and is `>` rather than `>=`.
 * The loop still runs it on everything returned, so the two cannot drift apart
 * without a test failing.
 */
async function confirmedOrdersForAlarm(golive: AlertGoLive): Promise<AlarmOrder[]> {
  // `alertPasses` lets everything through with the gate off, so an off gate must
  // add no condition at all.
  const goLiveGate = golive.on
    ? Prisma.sql`and q."createdAt" > ${new Date(golive.at)}`
    : Prisma.empty;
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
    ${goLiveGate}
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
  // The go-live moment is read FIRST rather than alongside the rest, because the
  // big read is now bounded by it — see `confirmedOrdersForAlarm`. It is one row
  // of a key/value table fetched by primary key, so the round trip it costs is
  // worth many times its weight in orders not fetched.
  const golive = await getAlertGoLive();
  const [quotes, assignments, baseline] = await Promise.all([
    // Source from confirmed sales — NOT inquiry.status === "WON". A quotation
    // revision reopens the inquiry (status leaves WON), so a WON filter would
    // drop confirmed orders that still owe this user an approval.
    // `isSaleConfirmed` below is the real gate, exactly as the departmental P&L
    // does it. See `confirmedOrdersForAlarm` for how the read is shaped and why.
    confirmedOrdersForAlarm(golive),
    getWorkflowRoles(),
    getNotificationBaseline(),
  ]);

  // A bought-in order at "For PO creation" rings for whoever its purchase
  // request needs next — not always the Purchaser (`boughtInPurchasePending`).
  const boughtInPurchaseFor = await boughtInPendingLookup(quotes.map((q) => ({ id: q.id, stage: readOrderWorkflow(q.classification).stage })));

  const out: PendingApproval[] = [];
  for (const q of quotes) {
    const sale = saleFromClassification(q.classification);
    if (!sale || !isSaleConfirmed(sale)) continue;

    const wf = readOrderWorkflow(q.classification);
    const stockOnly = isStockOnlyOrder(q.items);

    // Phase 2 job orders — each department's create / approve / issue, by the
    // same rule My Dashboard lists them (lib/job-order-tasks). The owner asked to
    // NOTIFY the Engineer and the admin; #624 put the tasks on the dashboard but
    // never here, so nobody was rung. Engineers and admins get every step, the
    // Technical Head (who may also issue) the issue step. Each step is judged by
    // the same gates as the rest of the alarm, against when IT became due.
    const joOwner = user.role === "ADMIN" || user.role === "ENGINEER";
    const joIssuer = joOwner || userHasWorkflowRole(assignments, user.id, "technical_head" as WorkflowRoleKey);
    const joActions =
      joIssuer && JOB_ORDER_STAGES.has(wf.stage) && alertPasses(q.createdAt, golive)
        ? jobOrderTasks(wf, quotationJobOrderDepts(q.items))
            .filter((t) => t.step === "issue" || joOwner)
            .filter((t) => passesNotificationBaseline(t.since, baseline) && alertPasses(t.since, golive))
            .map((t) => t.action)
        : [];
    // …and the department head, that their job order is issued — every issue,
    // the first release and later top-ups, until they start production.
    const issuedNotices = alertPasses(q.createdAt, golive)
      ? issuedJobOrderNotices(wf)
          .filter((n) => userHasWorkflowRole(assignments, user.id, n.role as WorkflowRoleKey))
          .filter((n) => passesNotificationBaseline(n.since, baseline) && alertPasses(n.since, golive))
          .map((n) => n.action)
      : [];

    const orderAction = ((): string | null => {
      const pend = pendingStep(wf, stockOnly, stockOnly && isDuctHardwareStockOnly(q.items), wf.officePickup === true, wf.fulfillmentMode === "plant_pickup", boughtInPurchaseFor(q.id));
      if (!pend) return null;
      // The department steps above say what "Issue job orders" says, per department.
      if (joActions.length > 0 && pend.action === "Issue job orders") return null;
      // The head's "… job order issued — start production" already says it.
      if (issuedNotices.length > 0 && pend.action === "Start production") return null;
      // Production underway ("Complete production") is ongoing work, not an approval
      // awaiting a decision — don't ring the alarm for it once production has
      // started. It still appears as a task on My Dashboard; this only silences the
      // siren so the production heads aren't alarmed on every page load while they
      // build.
      if (wf.stage === "producing") return null;

      const owesByRole = pend.roles.some((r) => userHasWorkflowRole(assignments, user.id, r as WorkflowRoleKey));
      const owesBySales = !!pend.sales && (user.role === "SALES" || user.role === "ENGINEER" || q.preparedById === user.id);
      const owesByEngineer = !!pend.engineer && user.role === "ENGINEER";
      if (!owesByRole && !owesBySales && !owesByEngineer) return null;

      // Notification backlog reset: hide orders that were already awaiting this
      // step before the reset (practice slate). "Pending since" = the most recent
      // approval stamp (when it entered this step), or the order's creation time.
      const stampTimes = Object.values(wf.approvals ?? {})
        .map((x) => (x as { at?: string } | null)?.at)
        .filter((t): t is string => !!t);
      const pendingSince = stampTimes.length ? [...stampTimes].sort().at(-1)! : q.createdAt.toISOString();
      if (!passesNotificationBaseline(pendingSince, baseline)) return null;
      // Alerts go-live gate: silent before launch; afterwards only approvals that
      // entered their step after the go-live moment ring (pre-launch backlog stays quiet).
      if (!alertPasses(pendingSince, golive)) return null;
      // …and the ORDER's own date, not just the step's. The owner, 15 September
      // 2026: *"Transactions before August 1, 2026 should not give any alarm or
      // notifications. Date before the said day is a testing stage."*
      //
      // `pendingSince` is the most recent approval stamp, so a test order from the
      // practice weeks starts ringing the moment anyone touches it — press one
      // button on a July order in September and it is "pending since September".
      // An order raised during the testing stage is test data whatever happens to
      // it later, so the gate asks when the ORDER was raised as well.
      if (!alertPasses(q.createdAt, golive)) return null;
      return pend.action;
    })();

    // One entry per order (the alarm opens the order from it): its own step and
    // its job-order steps together. `key` names WHAT is owed, so a new step on an
    // order that already rang — Approve → Issue — rings again.
    const actions = [...(orderAction ? [orderAction] : []), ...joActions, ...issuedNotices];
    if (actions.length === 0) continue;
    out.push({
      id: q.id,
      key: `${q.id}:${actions.join("|")}`,
      code: q.quoteNumber,
      company: q.company,
      action: actions.join(" · "),
      anchor: orderAction ? phaseAnchor(wf.stage) : "phase-2",
    });
  }
  return out;
}
