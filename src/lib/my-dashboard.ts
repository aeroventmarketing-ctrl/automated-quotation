/**
 * Role-adaptive "My Dashboard" data. For a signed-in user it gathers the items
 * currently AWAITING their action across every workflow (orders, purchasing,
 * cash requests, schedules, commissions, quotations), plus their recent activity
 * (progress / things they've done). Each pending item links to the detail page
 * that shows the full record (and client details, where the viewer may see them).
 *
 * Client identity/amounts are masked for client-restricted (shop-floor) viewers,
 * matching the app-wide client-visibility policy. Every source is wrapped so a
 * missing table can't break the page.
 */
import { Prisma, type User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isAdmin, canApprove } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, workflowRoleLabel, WORKFLOW_ROLE_KEYS, type WorkflowRoleKey, type WorkflowRoleAssignments } from "@/lib/workflow-roles";
import { readOrderWorkflow, pendingStep, phaseAnchor, requisitionDeptLabel, deptRole, isMrfRequestorFor } from "@/lib/order-workflow";
import { isStockOnlyOrder, isBoughtInOnlyOrder, isDuctHardwareStockOnly } from "@/lib/department-pnl";
import { getNotificationBaseline, passesNotificationBaseline } from "@/lib/notification-baseline";
import { getAlertGoLive, alertPasses } from "@/lib/alert-golive";
import { saleFromClassification, isSaleConfirmed } from "@/lib/sale";
import { payableTotal, round2 } from "@/lib/quote";
import { slimClassificationByOrder, withSlimClassification } from "@/lib/slim-classification";
import { purchaseStepsFrom, effectiveStepRole, isDeptRequisition, isPoApproved, PR_STATUS_LABEL, type PRStatus } from "@/lib/purchasing";
import { coercePurchaseReturns, nextReturnStage, returnStageDef, isReturnComplete } from "@/lib/purchase-returns";
import { coercePurchaseOrder, poTotals } from "@/lib/purchase-order";
import { poBatchId } from "@/lib/purchase-batch";
import { coerceCheckDocs, checkMissing, checkAttachableAt, formatCheckNo } from "@/lib/voucher-check";
import { buildCheckWatch, notifiesAdmin } from "@/lib/check-monitor";
import { getSuppliers } from "@/lib/suppliers";
import { cashStepsFrom, CASH_STATUS_LABEL, type CashRequestStatus } from "@/lib/cash-request";
import { isClientRestricted, CLIENT_HIDDEN } from "@/lib/client-visibility";
import { mbProgress, isMbFiled } from "@/lib/delivery-multibatch";
import { STOCK_ACTION_LABEL, nextStockActionSlot } from "@/lib/stock-action";
import { listActivityForActor, type ActivityView } from "@/lib/activity-log";
import { buildCommissions, allDeals, isPayable, commissionToday } from "@/lib/sales-commission";
import { commissionAccess } from "@/lib/commission-access";
import { getSalesPersonnelIds } from "@/lib/sales-personnel";

export type TaskArea = "order" | "purchase" | "cash" | "schedule" | "commission" | "quotation" | "inventory";

export interface MyTask {
  key: string;
  area: TaskArea;
  areaLabel: string;
  title: string; // order/quote/DR number or event title
  action: string; // what the viewer must do
  client: string | null; // masked when the viewer can't see clients / not applicable
  amount: number | null; // masked when the viewer can't see client amounts / n/a
  currency: string;
  href: string;
  deliveryMode?: "single" | "multi"; // for order tasks: how the order ships
  ref?: string; // a reference code shown for quick lookup (e.g. a purchase order's PO number)
  since?: string; // ISO — when it became pending (for the notification backlog reset)
  createdAt?: string; // ISO — when the underlying order was created (go-live gate: a
  // pre-launch order stays quiet even after a post-launch stage stamp bumps `since`)
}

/** A cross-role MRF status note shown to the requestor and materials roles. */
export interface MaterialNote {
  key: string;
  orderRef: string;
  dept: string; // department label
  formNo: string;
  label: string; // current MRF status, in plain words
  variant: "success" | "warning" | "secondary" | "destructive";
  client: string | null; // masked for client-restricted viewers
  when: string; // ISO — the note's latest stamp
  /** ISO — when the ORDER was raised. The go-live gate reads this as well as
   *  `when`: a test order's MRF released after launch is still test data. */
  createdAt?: string;
  href: string;
}

/** A supplier-return lifecycle note — shown to the four handling roles + admin. */
export interface ReturnNote {
  key: string;
  orderRef: string; // order / requisition label
  items: string; // what was returned
  stageLabel: string; // current lifecycle stage
  awaiting: string | null; // next step + owning role, or null once complete
  yourStep: boolean; // the next step is one the viewer owns
  variant: "success" | "warning" | "secondary";
  when: string; // ISO — latest stamp
  /** ISO — when the purchase request was raised; see `MaterialNote.createdAt`. */
  createdAt?: string;
  href: string;
}

/** One line of the Purchase Order summary — every issued PO, by number. */
export interface PoSummaryRow {
  key: string;
  poNumber: string;
  supplier: string | null;
  orderRef: string; // the order (quote number) or department requisition it covers
  statusLabel: string;
  variant: "secondary" | "warning" | "success" | "destructive";
  net: number; // PO net amount
  currency: string;
  href: string;
  // When the item was received into stock (Warehouseman's "Receive & Add to Stock"),
  // and who — null until received. For a combined PO, the most recent member receipt.
  receivedAt: string | null; // ISO
  receivedByName: string | null;
}

export interface MyDashboard {
  hasRole: boolean; // holds ≥1 workflow role (or admin) — i.e. this page applies
  roleLabels: string[]; // the viewer's workflow-role labels (for the header)
  pending: MyTask[];
  activity: ActivityView[];
  byArea: { area: TaskArea; label: string; count: number }[];
  // MRF completed / partially-released notes — shown to Admin, Warehouse,
  // Purchaser and the requesting department.
  materialsFeed: MaterialNote[];
  // Supplier-return lifecycle — shown to Admin, Purchaser, Warehouse, Plant
  // Manager and Logistics.
  returnsFeed: ReturnNote[];
  // Purchase Order summary (all POs, by number) — Admin / Payment Approver /
  // Accounting / Purchaser only.
  poSummary: PoSummaryRow[];
  // The commissions tile. Null when the viewer has no commission access.
  commissions: CommissionSummary | null;
}

/**
 * What the My Dashboard commissions tile shows. `ownOnly` is the privacy fact,
 * not a display preference: a salesperson sees THEIR earnings and no one else's,
 * so the tile has to say whose figure it is.
 */
export interface CommissionSummary {
  /** Approved and not yet paid out — the same basis as the Management tile. */
  unpaid: number;
  count: number;
  /** The earliest release date among them (rule 4), or null. */
  nextPayoutYMD: string | null;
  ownOnly: boolean;
}

/** The workflow-role labels a user holds. */
export function viewerRoleLabels(user: User, assignments: WorkflowRoleAssignments): string[] {
  const labels = WORKFLOW_ROLE_KEYS
    .filter((k) => userHasWorkflowRole(assignments, user.id, k as WorkflowRoleKey))
    .map((k) => workflowRoleLabel(k));
  if (isAdmin(user)) labels.unshift("Admin");
  return labels;
}

const AREA_LABEL: Record<TaskArea, string> = {
  order: "Orders",
  purchase: "Purchasing",
  cash: "Cash requests",
  schedule: "Schedules",
  // "Commission payouts", not "Commissions": the My Dashboard money tile is
  // called Commissions, and two tiles with that label side by side (one a task
  // count, one a peso figure, and legitimately different numbers because the
  // task feed is go-live gated and the money is not) read as a bug.
  commission: "Commission payouts",
  quotation: "Quotations",
  inventory: "Inventory",
};

export async function buildMyDashboard(user: User): Promise<MyDashboard> {
  const assignments = await getWorkflowRoles();
  const has = (r: WorkflowRoleKey) => isAdmin(user) || userHasWorkflowRole(assignments, user.id, r);
  // "Am I this MRF's requestor?" — the production head for a line, the Office
  // roles for an Office request. Same definition the server gate uses.
  const isMrfRequestor = (dept: Parameters<typeof isMrfRequestorFor>[0]) =>
    isMrfRequestorFor(dept, user.role, isAdmin(user), (r) => userHasWorkflowRole(assignments, user.id, r as WorkflowRoleKey));
  const holdsAnyRole = WORKFLOW_ROLE_KEYS.some((k) => userHasWorkflowRole(assignments, user.id, k as WorkflowRoleKey));
  const restricted = await isClientRestricted(user, assignments);
  const maskClient = (name: string | null | undefined): string | null => (restricted ? CLIENT_HIDDEN : name ?? null);
  const maskAmount = (n: number | null | undefined): number | null => (restricted ? null : n ?? null);

  const tasks: MyTask[] = [];
  // MRF completed / partially-released notifications for Admin / Warehouse /
  // Purchaser / requesting department (collected while scanning orders below).
  const materialsFeed: MaterialNote[] = [];
  // Supplier-return lifecycle notes for the Purchaser, Warehouse, Plant Manager
  // and Logistics (and admins) — each owns one stage of the handshake.
  const returnsFeed: ReturnNote[] = [];
  const seesReturnsFeed = isAdmin(user) || has("purchaser") || has("warehouse") || has("plant_manager") || has("logistics");
  // Seen in full by the materials-handling roles and by every role that can
  // request an MRF for any department: Admin, Warehouse, Purchaser and the Plant
  // Manager. Individual department heads additionally see their own dept's MRFs.
  const seesMaterialsFeed = isAdmin(user) || has("warehouse") || has("purchaser") || has("plant_manager") || user.role === "SALES" || user.role === "ENGINEER";
  // Linked purchase-request status per MRF — so a "purchasing" MRF can say
  // whether its item has been received into stock yet.
  const mrfPrStatus = new Map<string, string>();
  try {
    const linkedPrs = await prisma.purchaseRequest.findMany({
      where: { mrfId: { not: null } },
      select: { mrfId: true, status: true },
      orderBy: { createdAt: "asc" },
    });
    for (const p of linkedPrs) if (p.mrfId) mrfPrStatus.set(p.mrfId, p.status);
  } catch { /* ignore */ }

  // Plain-words status for the requestor's Materials feed (null = don't show).
  const mrfNote = (m: { id: string; status: string; releasedByName?: string }): { label: string; variant: MaterialNote["variant"] } | null => {
    const prDone = mrfPrStatus.get(m.id) === "COMPLETED";
    switch (m.status) {
      case "completed": return { label: "MRF completed", variant: "success" };
      case "issued": return { label: m.releasedByName ? "Released — awaiting your confirmation" : "Issued — awaiting your confirmation", variant: "warning" };
      case "partial": return { label: "Partly released", variant: "warning" };
      case "purchasing": return prDone ? { label: "Purchased — received into stock, awaiting release", variant: "warning" } : { label: "For purchasing", variant: "secondary" };
      case "requested": return { label: "Requested — awaiting warehouse", variant: "secondary" };
      default: return null; // cancelled
    }
  };

  // 1) Order-workflow approvals — confirmed orders whose current step needs a
  //    role the viewer holds (or a Sales-owned step they own).
  try {
    // Source from confirmed sales — NOT inquiry.status === "WON". A quotation
    // revision reopens the inquiry (status leaves WON), so a WON filter would
    // drop confirmed orders' pending tasks and MRF feed. isSaleConfirmed below
    // is the real gate, exactly as the departmental P&L does it. (Owner-approved
    // edit that also affects the Phase 3 Materials feed built from this query.)
    //
    // ## Why this query is narrowed (owner-approved, 2026-09-10)
    //
    // This was the byte-identical twin of the approver alarm's old query, which
    // means the two shared a single `pg_stat_statements` fingerprint: 531 million
    // rows across 584,734 calls, the largest source of rows leaving the database.
    // Fixing the alarm alone left this half of it still running.
    //
    // The `where` is the **necessary condition** behind the gate on the next
    // line. `isSaleConfirmed` returns false immediately unless the sale carries a
    // PO, so a row whose `sale.po` is absent can never reach the body of this
    // loop — asking Postgres for it cannot drop a quotation that would have
    // produced a task or a Materials note. It is deliberately necessary rather
    // than sufficient: a JSON-null PO and a sale with no arrangement both still
    // come back, and are still rejected by the untouched gate below.
    //
    // The `select` is every field the loop reads and nothing else. `items`
    // narrows to the three that `isStockOnlyOrder`, `isBoughtInOnlyOrder` and
    // `isDuctHardwareStockOnly` take; `total` / `discountPct` / `vatMode` are
    // there for `payableTotal(q)` further down. Add a field to the loop and you
    // must add it here — which is a type error, not a silently empty column.
    //
    // The Phase 3 Materials feed is built from this query, so nothing about which
    // orders it yields may change. It does not: the gate is untouched, and the
    // filter was verified against real Postgres across all eight shapes a sale
    // can take before it was used anywhere.
    //
    // `classification` is the one field NOT selected here. It comes from
    // `slimClassificationByOrder`, which applies the same `sale.po` filter and
    // subtracts — in Postgres — the revision snapshots, document reads and
    // workflow resets that neither the task loop nor the Materials feed opens: 14
    // kB an order down to 429 bytes on the fixture it was measured on. It runs
    // alongside this query rather than after it, and is memoised for the request,
    // so the finance cards and the commissions tile further down this same page
    // read the column once between them.
    //
    // `withSlimClassification` puts it back on each row, so every line of the
    // loop below — including `payableTotal(q)`, which reaches into it for the
    // VAT-exempt total — reads exactly what it read before. Which orders this
    // yields is unchanged: same filter, same untouched `isSaleConfirmed` gate.
    const [quotes, slim] = await Promise.all([
      prisma.quotation.findMany({
        where: { classification: { path: ["sale", "po"], not: Prisma.DbNull } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          quoteNumber: true,
          createdAt: true,
          currency: true,
          preparedById: true,
          total: true,
          discountPct: true,
          vatMode: true,
          inquiry: { select: { customer: { select: { company: true } } } },
          items: { select: { qty: true, descriptionSnapshot: true, specsSnapshot: true } },
        },
      }),
      slimClassificationByOrder(),
    ]);
    for (const row of quotes) {
      const q = withSlimClassification(row, slim);
      const sale = saleFromClassification(q.classification);
      if (!sale || !isSaleConfirmed(sale)) continue;
      const wf = readOrderWorkflow(q.classification);
      // The order's creation instant — a go-live gate applied to every pending
      // action below, so an order created before launch never demands action even
      // if a later stage stamp (during testing) made its `since` post-launch.
      const orderCreatedAt = q.createdAt.toISOString();
      // Material Request Forms (MRF) awaiting the Warehouse to triage — status
      // "requested" (issue from stock / send to purchasing). Warehouse only.
      for (const m of wf.materialRequests) {
        // Warehouse triages a newly requested MRF (issue from stock / purchase).
        if (m.status === "requested" && has("warehouse")) {
          tasks.push({
            key: `mrf:${q.id}:${m.id}`, area: "order", areaLabel: AREA_LABEL.order,
            title: q.quoteNumber, action: `Handle MRF #${m.formNo} · ${requisitionDeptLabel(m.dept)}`,
            client: maskClient(q.inquiry.customer.company), amount: null, currency: q.currency,
            href: `/orders/${q.id}`,
            since: m.raisedAt || undefined,
            createdAt: orderCreatedAt,
          });
        }
        // The requesting department confirms receipt of the released materials.
        if ((m.status === "issued" || m.status === "partial") && !m.confirmedAt && isMrfRequestor(m.dept)) {
          tasks.push({
            key: `mrf-confirm:${q.id}:${m.id}`, area: "order", areaLabel: AREA_LABEL.order,
            title: q.quoteNumber, action: `Confirm materials received · MRF #${m.formNo}`,
            client: maskClient(q.inquiry.customer.company), amount: null, currency: q.currency,
            href: `/orders/${q.id}`,
            since: m.releasedAt || m.handledAt || m.raisedAt || undefined,
            createdAt: orderCreatedAt,
          });
        }
        // Materials feed: the current status of every active MRF, so the
        // requesting department (plus Admin / Warehouse / Purchaser) can track
        // their requested items — from "Requested" through purchasing to release
        // and completion.
        const note = mrfNote(m);
        if (note && (seesMaterialsFeed || isMrfRequestor(m.dept))) {
          materialsFeed.push({
            key: `mfeed:${q.id}:${m.id}`,
            orderRef: q.quoteNumber,
            dept: requisitionDeptLabel(m.dept),
            formNo: m.formNo,
            label: note.label,
            variant: note.variant,
            client: maskClient(q.inquiry.customer.company),
            when: m.confirmedAt || m.releasedAt || m.handledAt || m.raisedAt || "",
            createdAt: orderCreatedAt,
            href: `/orders/${q.id}`,
          });
        }
      }
      // Multi-batch delivery: each open batch runs its own approval sequence
      // (separate from the main workflow), so surface each batch's current step
      // to the role that must act — Accounting, Payment Approver, Technical Head,
      // Plant Manager, Logistics, or the order's Sales. Single-delivery approval
      // stages already come through pendingStep(wf) below.
      const stockOnly = isStockOnlyOrder(q.items);
      const boughtInOnly = isBoughtInOnlyOrder(q.items);
      if (wf.deliveryMode === "multi") {
        for (const b of wf.deliveryBatches) {
          if (b.cancelled || isMbFiled(b)) continue;
          const next = mbProgress(b, wf.fulfillmentMode, stockOnly, boughtInOnly).next;
          if (!next) continue;
          const owes = next.role === "sales"
            ? (user.role === "SALES" || user.role === "ENGINEER" || q.preparedById === user.id || isAdmin(user))
            : has(next.role as WorkflowRoleKey);
          if (!owes) continue;
          // "Pending since" = the batch's most recent step stamp (when it entered
          // this step), or the batch's creation time.
          const bStamps = Object.values(b.steps ?? {}).map((s) => (s as { at?: string } | null)?.at).filter((t): t is string => !!t);
          const batchSince = bStamps.length ? [...bStamps].sort().at(-1)! : b.createdAt || undefined;
          tasks.push({
            key: `batch:${q.id}:${b.id}`, area: "order", areaLabel: AREA_LABEL.order,
            title: q.quoteNumber, action: b.drNumber ? `${next.label} · ${b.drNumber}` : next.label,
            client: maskClient(q.inquiry.customer.company), amount: null, currency: q.currency,
            href: `/orders/${q.id}`, deliveryMode: "multi",
            since: batchSince,
            createdAt: orderCreatedAt,
          });
        }
      }
      const pend = pendingStep(wf, stockOnly, stockOnly && isDuctHardwareStockOnly(q.items), wf.officePickup === true, wf.fulfillmentMode === "plant_pickup");
      if (!pend) continue;
      const owesByRole = pend.roles.some((r) => has(r as WorkflowRoleKey));
      const owesBySales = !!pend.sales && (user.role === "SALES" || user.role === "ENGINEER" || q.preparedById === user.id);
      const owesByEngineer = !!pend.engineer && (user.role === "ENGINEER" || isAdmin(user));
      if (!owesByRole && !owesBySales && !owesByEngineer) continue;
      // "Pending since" = the most recent approval stamp (when it entered this
      // step), or the order's creation time.
      const oStamps = Object.values(wf.approvals ?? {}).map((s) => (s as { at?: string } | null)?.at).filter((t): t is string => !!t);
      const orderSince = oStamps.length ? [...oStamps].sort().at(-1)! : q.createdAt.toISOString();
      tasks.push({
        key: `order:${q.id}`, area: "order", areaLabel: AREA_LABEL.order,
        title: q.quoteNumber, action: pend.action,
        client: maskClient(q.inquiry.customer.company), amount: maskAmount(payableTotal(q)), currency: q.currency,
        href: `/orders/${q.id}${phaseAnchor(wf.stage) ? `#${phaseAnchor(wf.stage)}` : ""}`,
        deliveryMode: wf.deliveryMode === "multi" ? "multi" : "single",
        since: orderSince,
        createdAt: orderCreatedAt,
      });
    }
  } catch { /* ignore */ }

  // 2) Purchasing — purchase requests whose next step needs a role the viewer holds.
  try {
    const prs = await prisma.purchaseRequest.findMany({
      where: { status: { notIn: ["COMPLETED", "REJECTED", "CANCELLED"] } },
      // Three fields of the order, not the order. `include` on a relation loads
      // every column of it — so this was fetching each linked quotation whole,
      // `classification` and all (the same kilobytes three pull requests have
      // just been spent keeping off the wire), plus the entire Inquiry and the
      // entire Customer row, to print a quote number and a company name.
      include: {
        quotation: {
          select: { quoteNumber: true, createdAt: true, inquiry: { select: { customer: { select: { company: true } } } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    for (const pr of prs) {
      const isDept = isDeptRequisition(pr);
      const poApproved = isPoApproved(pr.chainLog);
      const company = pr.quotation?.inquiry.customer.company ?? null;
      const label = pr.quotationId ? (pr.quotation?.quoteNumber ?? "Order PR") : `Requisition · ${requisitionDeptLabel(pr.dept)}`;
      // Purchase-path availability: an escalated MRF whose purchased item is
      // delivered and Plant-Manager-approved — tell the requesting department the
      // materials are available (the Warehouse will release them).
      if (pr.mrfId && pr.dept && pr.status === "PLANT_APPROVED" && has(deptRole(pr.dept as Parameters<typeof deptRole>[0]) as WorkflowRoleKey)) {
        tasks.push({
          key: `mrf-avail:${pr.id}`, area: "order", areaLabel: AREA_LABEL.order,
          title: pr.quotation?.quoteNumber ?? label, action: "Purchased materials available",
          client: pr.quotationId ? maskClient(company) : null, amount: null, currency: "PHP",
          href: pr.quotationId ? `/orders/${pr.quotationId}` : "/purchasing",
          since: pr.createdAt.toISOString(),
          createdAt: pr.quotation?.createdAt.toISOString(),
        });
      }
      // The Purchaser raises the PO once the request is fully approved but has no
      // PO yet. Approval comes before the PO now, so for a material/department MRF
      // this waits until the Approver's approve_po (poApproved); an order-linked
      // request has no second gate, so any APPROVED request qualifies.
      if (has("purchaser") && pr.status === "APPROVED" && !pr.po && (poApproved || !isDept)) {
        tasks.push({
          key: `pr-po:${pr.id}`, area: "purchase", areaLabel: AREA_LABEL.purchase,
          title: label, action: "Prepare Purchase Order",
          client: pr.quotationId ? maskClient(company) : null, amount: null, currency: "PHP",
          // Purchaser acts in the Purchasing workspace — deep-link to this request.
          href: `/purchasing?req=${pr.id}`,
          since: pr.createdAt.toISOString(),
          createdAt: pr.createdAt.toISOString(),
        });
        continue;
      }
      const steps = purchaseStepsFrom(pr.status as PRStatus, isDept, poApproved);
      const roles = steps.map((s) => effectiveStepRole(s, isDept));
      if (!roles.some((r) => has(r))) continue;
      tasks.push({
        key: `pr:${pr.id}`, area: "purchase", areaLabel: AREA_LABEL.purchase,
        title: label, action: steps[0]?.label ?? "Process purchase",
        client: pr.quotationId ? maskClient(company) : null, amount: null, currency: "PHP",
        // Purchase-chain steps are worked in the Purchasing workspace — deep-link to it.
        href: `/purchasing?req=${pr.id}`,
        ref: coercePurchaseOrder(pr.po)?.poNumber || undefined, // PO number for easy reference
        since: pr.createdAt.toISOString(),
        createdAt: pr.createdAt.toISOString(),
      });
    }
  } catch { /* ignore */ }

  // 2b) Supplier returns — the return-to-supplier lifecycle. Every handling role
  //     sees the live status of each return; when the next step is theirs it also
  //     becomes an actionable task.
  if (seesReturnsFeed) {
    try {
      const retPrs = await prisma.purchaseRequest.findMany({
        select: {
          id: true, quotationId: true, dept: true, returns: true, createdAt: true,
          quotation: { select: { quoteNumber: true, inquiry: { select: { customer: { select: { company: true } } } } } },
        },
        orderBy: { createdAt: "desc" },
      });
      for (const pr of retPrs) {
        const rets = coercePurchaseReturns(pr.returns);
        if (rets.length === 0) continue;
        const company = pr.quotation?.inquiry.customer.company ?? null;
        const orderRef = pr.quotationId ? (pr.quotation?.quoteNumber ?? "Order") : `Requisition · ${requisitionDeptLabel(pr.dept)}`;
        // Supplier returns are worked in the Purchasing workspace — deep-link to the request.
        const href = `/purchasing?req=${pr.id}`;
        for (const r of rets) {
          const done = isReturnComplete(r.stage);
          const next = nextReturnStage(r.stage);
          const yourStep = !done && !!next && next.role != null && has(next.role);
          const stamps = Object.values(r.stamps).filter(Boolean) as { at: string }[];
          const when = stamps.map((s) => s.at).sort().at(-1) ?? r.raisedAt ?? new Date(0).toISOString();
          returnsFeed.push({
            key: `ret:${pr.id}:${r.id}`,
            createdAt: pr.createdAt.toISOString(),
            orderRef,
            items: r.items,
            stageLabel: returnStageDef(r.stage).label,
            awaiting: done || !next ? null : `${next.advanceLabel} (${workflowRoleLabel(next.role!)})`,
            yourStep,
            variant: done ? "success" : yourStep ? "warning" : "secondary",
            when,
            href,
          });
          if (yourStep && next) {
            tasks.push({
              key: `ret-task:${pr.id}:${r.id}`, area: "purchase", areaLabel: AREA_LABEL.purchase,
              title: orderRef, action: `Supplier return — ${next.advanceLabel}`,
              client: pr.quotationId ? maskClient(company) : null, amount: null, currency: "PHP",
              href, since: when, createdAt: pr.createdAt.toISOString(),
            });
          }
        }
      }
    } catch { /* ignore */ }
  }

  // 2c) A PO paid by CHECK whose check photo has never been attached.
  //
  //     The owner's ruling: *"It is required, but not a gate. Admin should be
  //     notified if not attached. Check is required for suppliers that give terms
  //     to us."* So nothing upstream is blocked — the PO simply keeps asking here
  //     until someone photographs the check.
  if (isAdmin(user) || has("accounting") || has("payment_approver")) {
    try {
      const suppliers = await getSuppliers();
      const termsCompanies = new Set(suppliers.filter((s) => s.terms).map((s) => s.company.trim().toLowerCase()));
      if (termsCompanies.size > 0) {
        const prs = await prisma.purchaseRequest.findMany({
          where: { status: { notIn: ["PENDING_APPROVAL", "APPROVED", "VOUCHER_READY", "REJECTED", "CANCELLED"] } },
          // The quote number and the company, as above — not the whole order.
          include: {
            quotation: {
              select: { quoteNumber: true, inquiry: { select: { customer: { select: { company: true } } } } },
            },
          },
          orderBy: { createdAt: "desc" },
        });
        // A combined PO's members all carry the same `po` JSON, and the check
        // rides on the ANCHOR — the first member in this createdAt-desc order,
        // exactly as the Purchasing workspace picks it. Without this the same
        // missing check would be reported once per member request.
        const seenBatch = new Set<string>();
        for (const pr of prs) {
          const bid = poBatchId(pr.po);
          if (bid) {
            if (seenBatch.has(bid)) continue;
            seenBatch.add(bid);
          }
          const po = coercePurchaseOrder(pr.po);
          if (!po) continue;
          if (!termsCompanies.has(po.supplier.company.trim().toLowerCase())) continue;
          if (!checkMissing({ supplierGivesTerms: true, status: pr.status as PRStatus, docs: coerceCheckDocs(pr.voucherCheckDocs) })) continue;
          // Only chase a PO the check can still be attached to. Once it is
          // COMPLETED the screen offers no way to add one, and a task nobody can
          // clear is how a "Pending Your Action" list stops being read. The PO
          // still shows its amber badge, so the gap is on record either way.
          if (!checkAttachableAt(pr.status as PRStatus, { isDept: isDeptRequisition(pr), poApproved: isPoApproved(pr.chainLog) })) continue;
          tasks.push({
            key: `pr-check:${pr.id}`, area: "purchase", areaLabel: AREA_LABEL.purchase,
            title: po.supplier.company || (pr.quotation?.quoteNumber ?? "Purchase order"),
            action: "Attach the check photo",
            client: pr.quotationId ? maskClient(pr.quotation?.inquiry.customer.company ?? null) : null,
            amount: null, currency: "PHP",
            href: `/purchasing?req=${pr.id}`,
            ref: po.poNumber || undefined,
            since: (pr.voucherAt ?? pr.createdAt).toISOString(),
            createdAt: pr.createdAt.toISOString(),
          });
        }
      }
    } catch { /* ignore */ }
  }

  // 2d) A check that should have cleared and did not.
  //
  //      NOT an advance warning: the owner withdrew that — *"do not notify the
  //      admin for checks that will soon clear."* A check that is merely
  //      approaching sits on the register and in First Priority, where they are
  //      already looking. Only the exception is pushed at anyone.
  //
  //      Admin only, matching who may act on it: clearing a check and moving its
  //      date are admin-only decisions, so telling anyone else would be an alert
  //      they cannot answer.
  //
  //      …and 2e) a check number recorded on two purchase orders, which goes to
  //      the WIDER audience below because the people who can put it right are
  //      not the people who clear checks — see the loop.
  if (isAdmin(user) || has("accounting") || has("payment_approver")) {
    try {
      const todayYMD = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      /**
       * Only the purchase orders that actually carry a check photo.
       *
       * Both tasks below need one: `notifiesAdmin` fires on `overdue`, which
       * needs a clearing date, and a duplicate needs a check NUMBER. And no
       * `expectsCheck` is passed to `buildCheckWatch` here, so a request with no
       * photo produces no row at all — it was being fetched and thrown away.
       *
       * That waste got three times worse when this feed was widened from the
       * admin to Accounting and the Payment Approver: an unfiltered read of
       * EVERY purchase request, carrying the two fattest columns in the table
       * (`po`, and `voucherCheckDocs` with every AI read stored on it), on a page
       * that is everyone's landing page and refreshes on almost any activity.
       *
       * Raw SQL because "this JSON array is not empty" is not expressible in
       * Prisma's `where`.
       *
       * Neither test can throw, and that is deliberate rather than tidy. The
       * obvious spelling — `jsonb_typeof(...) = 'array' and
       * jsonb_array_length(...) > 0` — LOOKS guarded and is not: SQL does not
       * promise to evaluate an `AND` left to right, and Postgres really does
       * reach `jsonb_array_length` on a row holding an object, where it raises
       * *"cannot get array length of a non-array"*. One malformed row would take
       * My Dashboard down for all three roles. `<> '[]'::jsonb` compares any two
       * jsonb values without caring what they are, so the order stops mattering.
       */
      const checkPrs = await prisma.$queryRaw<{
        id: string; quotationId: string | null; po: unknown; voucherCheckDocs: unknown; status: string; createdAt: Date;
      }[]>`
        select "id", "quotationId", "po", "voucherCheckDocs", "status", "createdAt"
        from "PurchaseRequest"
        where jsonb_typeof("voucherCheckDocs") = 'array'
          and "voucherCheckDocs" <> '[]'::jsonb
      `;
      const prCreatedAt = new Map(checkPrs.map((pr) => [pr.id, pr.createdAt.toISOString()] as const));
      const watch = buildCheckWatch(checkPrs, todayYMD, {
        coerceDocs: coerceCheckDocs,
        // One row per PURCHASE ORDER, so a combined PO does not push the same
        // overdue check at everybody once per member request.
        batchIdOf: poBatchId,
        poOf: (v) => {
          const po = coercePurchaseOrder(v);
          // `net` is unused here (this feed only pushes OVERDUE checks, which
          // always carry a read amount) but the shape is shared with the register.
          return po ? { poNumber: po.poNumber, supplierCompany: po.supplier.company, date: po.date || null, net: poTotals(po).net } : null;
        },
      });
      for (const row of watch) {
        /**
         * The same check number on two purchase orders — the owner's *"disallow
         * duplicate input. Put a message in every role and every tab when
         * possible."*
         *
         * Everyone who can open Check Monitoring gets this one, not just the
         * admin: Accounting attaches and removes the photos, and the Payment
         * Approver corrects a misread number, so between the three of them are
         * both ways out. They already see the whole register at `/checks`, so
         * nothing is disclosed here that they could not read there anyway.
         *
         * A task per ROW, deliberately. Both halves of a pair need answering,
         * and both halves need to be reachable — one of them is usually the
         * wrong one, and which is not knowable from here.
         *
         * No `since`: a duplicate has no date it fell due on, and dressing one
         * up as overdue would put it in the wrong queue.
         */
        if (row.duplicateOf.length) {
          tasks.push({
            key: `check-duplicate:${row.prId}:${row.path}`, area: "purchase", areaLabel: AREA_LABEL.purchase,
            title: `${row.supplier || "Supplier"}${row.checkNo ? ` · Check No. ${formatCheckNo(row.checkNo)}` : ""}`,
            action: `Duplicate check no. — also on ${row.duplicateOf.join(" and ")}`,
            client: null, amount: row.amount, currency: "PHP",
            href: "/checks",
            ref: row.poNumber || undefined,
            createdAt: prCreatedAt.get(row.prId),
          });
        }
        if (!notifiesAdmin(row.state) || !isAdmin(user)) continue;
        tasks.push({
          key: `check-clearing:${row.prId}:${row.path}`, area: "purchase", areaLabel: AREA_LABEL.purchase,
          title: `${row.supplier || "Supplier"}${row.checkNo ? ` · Check No. ${formatCheckNo(row.checkNo)}` : ""}`,
          action: "Check has not cleared — confirm it, or move the date",
          client: null, amount: row.amount, currency: "PHP",
          href: "/checks",
          ref: row.poNumber || undefined,
          since: row.clearingYMD ?? undefined,
          createdAt: prCreatedAt.get(row.prId),
        });
      }
    } catch { /* ignore */ }
  }

  // 3) Cash requests — whose next step needs a role the viewer holds (or they're
  //    the requestor confirming receipt).
  try {
    const cash = await prisma.cashRequest.findMany({
      where: { status: { notIn: ["RECEIVED", "LIQUIDATED", "SETTLED", "REJECTED", "CANCELLED"] } },
      orderBy: { createdAt: "desc" },
    });
    for (const cr of cash) {
      const steps = cashStepsFrom(cr.status as CashRequestStatus);
      const awaiting = steps.some((s) => (s.by === "requestor" ? cr.requestedById === user.id : has(s.by as WorkflowRoleKey)));
      if (!awaiting) continue;
      tasks.push({
        key: `cash:${cr.id}`, area: "cash", areaLabel: AREA_LABEL.cash,
        title: cr.number ? `Cash ${cr.number}` : "Cash request", action: steps[0]?.label ?? CASH_STATUS_LABEL[cr.status as CashRequestStatus] ?? "Process",
        client: cr.purpose ?? null, amount: Number(cr.amount), currency: "PHP",
        href: `/cash-requests?id=${cr.id}`,
        since: cr.createdAt.toISOString(),
        createdAt: cr.createdAt.toISOString(),
      });
    }
  } catch { /* ignore */ }

  // 4) Schedules pending approval — Engineer / Admin / Payment Approver.
  if (canApprove(user) || isAdmin(user) || has("payment_approver")) {
    try {
      const pend = await prisma.schedule.findMany({ where: { status: "PENDING" }, orderBy: { startAt: "asc" }, take: 50 });
      for (const s of pend) {
        tasks.push({
          key: `sched:${s.id}`, area: "schedule", areaLabel: AREA_LABEL.schedule,
          title: s.title, action: "Approve schedule", client: null, amount: null, currency: "PHP",
          href: `/calendar?event=${s.id}`,
          since: s.createdAt.toISOString(),
        });
      }
    } catch { /* ignore */ }
  }

  // 5) Commissions awaiting payout — Accounting / Admin mark them paid.
  if (isAdmin(user) || has("accounting")) {
    try {
      // Entitlement is computed (rules 1-6 in `lib/sales-commission`): a deal is
      // only a task once its month cleared ₱1M and the client has fully paid.
      // Reading unpaid `Commission` rows instead put deals here that nobody could
      // pay yet — the row exists from the moment the order closes.
      for (const c of allDeals(await buildCommissions()).filter((d) => isPayable(d, commissionToday())).slice(0, 100)) {
        tasks.push({
          key: `comm:${c.kind}:${c.refId}:${c.payeeKind}`, area: "commission", areaLabel: AREA_LABEL.commission,
          title: `Commission · ${c.refLabel}${c.payeeKind === "override" ? " (override)" : ""}`, action: "Mark commission paid",
          client: maskClient(c.company), amount: maskAmount(c.amount), currency: "PHP",
          // "Mark paid" is done on the Commissions page — deep-link (anchor) to the row.
          href: `/commissions#commission-${c.kind}-${c.refId}-${c.payeeKind}`,
          since: c.payoutYMD ?? c.recognisedYMD,
          createdAt: c.recognisedYMD,
        });
      }
    } catch { /* ignore */ }
  }

  // 6) Quotations awaiting approval — Engineer / Admin.
  if (canApprove(user)) {
    try {
      const q = await prisma.quotation.findMany({
        where: { status: "PENDING_APPROVAL" },
        // The six fields the task below reads. `classification` stays — these are
        // drafts awaiting approval, not confirmed orders, so the slimmed map does
        // not cover them, and `payableTotal` reads the mark-up / discount and the
        // VAT-exempt total out of it.
        select: {
          id: true,
          quoteNumber: true,
          currency: true,
          createdAt: true,
          total: true,
          discountPct: true,
          vatMode: true,
          classification: true,
          inquiry: { select: { customer: { select: { company: true } } } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      for (const quote of q) {
        tasks.push({
          key: `quote:${quote.id}`, area: "quotation", areaLabel: AREA_LABEL.quotation,
          title: quote.quoteNumber, action: "Approve quotation",
          client: maskClient(quote.inquiry.customer.company), amount: maskAmount(payableTotal(quote)), currency: quote.currency,
          href: `/quotations/${quote.id}`,
          since: quote.createdAt.toISOString(),
        });
      }
    } catch { /* ignore */ }
  }

  // 7) Inventory double-handshake stock actions. Both the Warehouseman and the
  //    Purchaser are parties to every action, so surface all pending ones to
  //    both — the action text reflects whose sign-off is next (or "Awaiting …"
  //    when the viewer has already signed and it's the other party's turn).
  //    An EDIT adds a third party — the Admin / Payment Approver who owns the
  //    catalogue price, since an edit carries the unit cost and selling price.
  if (has("warehouse") || has("purchaser") || has("payment_approver")) {
    try {
      const actions = await prisma.stockAction.findMany({
        where: { status: "PENDING" },
        orderBy: { proposedAt: "desc" },
        take: 100,
      });
      for (const a of actions) {
        // Whose sign-off is still outstanding. Read from the same function the
        // Inventory card and the server use, so this list can never invite the
        // wrong person — an Edit raised by the Purchaser skips the Warehouse step.
        const slot = nextStockActionSlot(a.proposedRole, a.warehouseAt, a.purchaserAt, a.approverAt);
        if (slot == null) continue; // every signature in — shouldn't still be PENDING
        const nextRole: WorkflowRoleKey = slot === "approver" ? "payment_approver" : slot;
        const myTurn = has(nextRole);
        const label = STOCK_ACTION_LABEL[a.kind];
        tasks.push({
          key: `stock:${a.id}`, area: "inventory", areaLabel: AREA_LABEL.inventory,
          title: a.itemName,
          action: myTurn ? `Approve ${label}` : `Awaiting ${workflowRoleLabel(nextRole)} — ${label}`,
          client: null, amount: null, currency: "PHP",
          href: "/inventory#inv-items",
          since: a.proposedAt.toISOString(),
          createdAt: a.proposedAt.toISOString(),
        });
      }
    } catch { /* StockAction table not migrated — ignore */ }
  }

  // Notification backlog reset (practice slate): drop tasks / feed notes that
  // were already pending before the reset. New items (during practice) stay.
  // Alerts go-live gate: additionally, before launch nothing shows, and after
  // launch only items newer than the go-live moment do.
  const [baseline, golive] = await Promise.all([getNotificationBaseline(), getAlertGoLive()]);
  const shows = (when: string | null | undefined) => passesNotificationBaseline(when, baseline) && alertPasses(when, golive);
  // A pending action is hidden when its own "became pending" time is pre-launch,
  // AND (for order-derived tasks) when the underlying order was created before the
  // launch moment — so a legacy order advanced during testing stays quiet.
  const visibleTasks = tasks.filter((t) => shows(t.since) && alertPasses(t.createdAt, golive));
  // The feeds are judged the same way as the tasks: the note's own stamp AND the
  // date of the thing it is about. The owner, 15 September 2026: *"Transactions
  // before August 1, 2026 should not give any alarm or notifications. Date before
  // the said day is a testing stage."* An MRF raised on a July order and released
  // in September is a September stamp on a July transaction.
  const visibleFeed = materialsFeed.filter((m) => shows(m.when || undefined) && alertPasses(m.createdAt, golive));

  const byArea = (Object.keys(AREA_LABEL) as TaskArea[])
    .map((area) => ({ area, label: AREA_LABEL[area], count: visibleTasks.filter((t) => t.area === area).length }))
    .filter((a) => a.count > 0);

  const activity = await listActivityForActor(user.id, 30);

  // Purchase Order summary — every issued PO, arranged by number. Finance /
  // purchasing roles only. Combined POs (shared number) are listed once.
  let poSummary: PoSummaryRow[] = [];
  if (isAdmin(user) || has("payment_approver") || has("accounting") || has("purchaser")) {
    try {
      const withPo = await prisma.purchaseRequest.findMany({
        where: { status: { notIn: ["PENDING_APPROVAL"] } },
        include: { quotation: { select: { quoteNumber: true } } },
        orderBy: { createdAt: "desc" },
        take: 500,
      });
      const byNumber = new Map<string, PoSummaryRow>();
      for (const pr of withPo) {
        const po = coercePurchaseOrder(pr.po);
        if (!po?.poNumber) continue;
        const receivedAt = pr.receivedAt ? pr.receivedAt.toISOString() : null;
        const existing = byNumber.get(po.poNumber);
        if (existing) {
          // Combined PO (shared number) — surface the most recent member receipt.
          if (receivedAt && (!existing.receivedAt || receivedAt > existing.receivedAt)) {
            existing.receivedAt = receivedAt;
            existing.receivedByName = pr.receivedByName ?? null;
          }
          continue;
        }
        const st = pr.status as PRStatus;
        byNumber.set(po.poNumber, {
          key: `po:${po.poNumber}`,
          poNumber: po.poNumber,
          supplier: po.supplier?.company || null,
          orderRef: pr.quotationId ? (pr.quotation?.quoteNumber ?? "Order") : `Requisition · ${requisitionDeptLabel(pr.dept)}`,
          statusLabel: PR_STATUS_LABEL[st] ?? st,
          variant: st === "COMPLETED" ? "success" : st === "REJECTED" || st === "CANCELLED" ? "destructive" : "warning",
          net: poTotals(po).net,
          currency: "PHP",
          // Land on this PO in the Purchasing workspace (scrolls to & highlights it).
          href: `/purchasing?req=${pr.id}`,
          receivedAt,
          receivedByName: pr.receivedByName ?? null,
        });
      }
      poSummary = [...byNumber.values()].sort((a, b) => a.poNumber.localeCompare(b.poNumber));
    } catch { /* ignore */ }
  }

  visibleFeed.sort((a, b) => b.when.localeCompare(a.when));
  const visibleReturns = returnsFeed.filter((r) => shows(r.when || undefined) && alertPasses(r.createdAt, golive));
  // Open returns first (your step, then other awaiting), completed last; newest within each.
  visibleReturns.sort((a, b) => {
    const rank = (n: ReturnNote) => (n.variant === "warning" ? 0 : n.variant === "secondary" ? 1 : 2);
    return rank(a) - rank(b) || b.when.localeCompare(a.when);
  });

  // --- Commissions tile ------------------------------------------------------
  // A salesperson sees ONLY their own commissions — one rep must never see
  // another's earnings, which is why this asks the engine for their id rather
  // than filtering a full list afterwards (nothing else is ever loaded).
  // Accounting / the Payment Approver / admins already manage payouts and see
  // the whole figure — the same number as the Management Dashboard's tile.
  // Same rule as the Commissions page (`lib/commission-access`) — NOT a second
  // copy keyed on `role === "SALES"`, which is what hid the tile from an Engineer
  // who holds Sales Head and earns the override.
  const { canView: seesCommissions, canSeeAll: seesAllCommissions } = commissionAccess({
    admin: isAdmin(user),
    baseRole: user.role,
    workflowRoles: WORKFLOW_ROLE_KEYS.filter((k) => userHasWorkflowRole(assignments, user.id, k as WorkflowRoleKey)),
    salesPersonnel: (await getSalesPersonnelIds().catch(() => [] as string[])).includes(user.id),
  });
  let commissions: CommissionSummary | null = null;
  if (seesCommissions) {
    try {
      const payable = allDeals(await buildCommissions(seesAllCommissions ? {} : { salespersonId: user.id })).filter((d) => isPayable(d, commissionToday()));
      commissions = {
        unpaid: round2(payable.reduce((a, d) => a + d.amount, 0)),
        count: payable.length,
        nextPayoutYMD: payable.map((d) => d.payoutYMD).filter((d): d is string => !!d).sort()[0] ?? null,
        ownOnly: !seesAllCommissions,
      };
    } catch {
      commissions = null; // commission table not set up — the rest of the page still renders
    }
  }

  return {
    // Sales base-role users get their own My Dashboard too — to monitor their
    // approvals (notify client, 2nd QC, POD) and the production-status card —
    // even when they hold no workflow role.
    hasRole: isAdmin(user) || holdsAnyRole || user.role === "SALES" || user.role === "ENGINEER",
    roleLabels: viewerRoleLabels(user, assignments),
    pending: visibleTasks,
    activity,
    byArea,
    materialsFeed: visibleFeed.slice(0, 15),
    returnsFeed: visibleReturns.slice(0, 15),
    poSummary,
    commissions,
  };
}
