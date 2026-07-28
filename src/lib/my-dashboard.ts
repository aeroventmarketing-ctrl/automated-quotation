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
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isAdmin, canApprove } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, workflowRoleLabel, WORKFLOW_ROLE_KEYS, type WorkflowRoleKey, type WorkflowRoleAssignments } from "@/lib/workflow-roles";
import { readOrderWorkflow, pendingStep, requisitionDeptLabel, deptRole } from "@/lib/order-workflow";
import { saleFromClassification, isSaleConfirmed } from "@/lib/sale";
import { purchaseStepsFrom, effectiveStepRole, isDeptRequisition, isPoApproved, type PRStatus } from "@/lib/purchasing";
import { cashStepsFrom, CASH_STATUS_LABEL, type CashRequestStatus } from "@/lib/cash-request";
import { isClientRestricted, CLIENT_HIDDEN } from "@/lib/client-visibility";
import { mbProgress, isMbFiled } from "@/lib/delivery-multibatch";
import { STOCK_ACTION_LABEL } from "@/lib/stock-action";
import { listActivityForActor, type ActivityView } from "@/lib/activity-log";

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
  when: string; // ISO
  href: string;
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
  commission: "Commissions",
  quotation: "Quotations",
  inventory: "Inventory",
};

export async function buildMyDashboard(user: User): Promise<MyDashboard> {
  const assignments = await getWorkflowRoles();
  const has = (r: WorkflowRoleKey) => isAdmin(user) || userHasWorkflowRole(assignments, user.id, r);
  const holdsAnyRole = WORKFLOW_ROLE_KEYS.some((k) => userHasWorkflowRole(assignments, user.id, k as WorkflowRoleKey));
  const restricted = await isClientRestricted(user, assignments);
  const maskClient = (name: string | null | undefined): string | null => (restricted ? CLIENT_HIDDEN : name ?? null);
  const maskAmount = (n: number | null | undefined): number | null => (restricted ? null : n ?? null);

  const tasks: MyTask[] = [];
  // MRF completed / partially-released notifications for Admin / Warehouse /
  // Purchaser / requesting department (collected while scanning orders below).
  const materialsFeed: MaterialNote[] = [];
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
    const quotes = await prisma.quotation.findMany({
      where: { inquiry: { status: "WON" } },
      include: { inquiry: { include: { customer: true } } },
      orderBy: { createdAt: "desc" },
    });
    for (const q of quotes) {
      const sale = saleFromClassification(q.classification);
      if (!sale || !isSaleConfirmed(sale)) continue;
      const wf = readOrderWorkflow(q.classification);
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
          });
        }
        // The requesting department confirms receipt of the released materials.
        if ((m.status === "issued" || m.status === "partial") && !m.confirmedAt && has(deptRole(m.dept) as WorkflowRoleKey)) {
          tasks.push({
            key: `mrf-confirm:${q.id}:${m.id}`, area: "order", areaLabel: AREA_LABEL.order,
            title: q.quoteNumber, action: `Confirm materials received · MRF #${m.formNo}`,
            client: maskClient(q.inquiry.customer.company), amount: null, currency: q.currency,
            href: `/orders/${q.id}`,
          });
        }
        // Materials feed: the current status of every active MRF, so the
        // requesting department (plus Admin / Warehouse / Purchaser) can track
        // their requested items — from "Requested" through purchasing to release
        // and completion.
        const note = mrfNote(m);
        if (note && (seesMaterialsFeed || has(deptRole(m.dept) as WorkflowRoleKey))) {
          materialsFeed.push({
            key: `mfeed:${q.id}:${m.id}`,
            orderRef: q.quoteNumber,
            dept: requisitionDeptLabel(m.dept),
            formNo: m.formNo,
            label: note.label,
            variant: note.variant,
            client: maskClient(q.inquiry.customer.company),
            when: m.confirmedAt || m.releasedAt || m.handledAt || m.raisedAt || "",
            href: `/orders/${q.id}`,
          });
        }
      }
      // Multi-batch delivery: each open batch runs its own approval sequence
      // (separate from the main workflow), so surface each batch's current step
      // to the role that must act — Accounting, Payment Approver, Technical Head,
      // Plant Manager, Logistics, or the order's Sales. Single-delivery approval
      // stages already come through pendingStep(wf) below.
      if (wf.deliveryMode === "multi") {
        for (const b of wf.deliveryBatches) {
          if (b.cancelled || isMbFiled(b)) continue;
          const next = mbProgress(b).next;
          if (!next) continue;
          const owes = next.role === "sales"
            ? (user.role === "SALES" || user.role === "ENGINEER" || q.preparedById === user.id || isAdmin(user))
            : has(next.role as WorkflowRoleKey);
          if (!owes) continue;
          tasks.push({
            key: `batch:${q.id}:${b.id}`, area: "order", areaLabel: AREA_LABEL.order,
            title: q.quoteNumber, action: b.drNumber ? `${next.label} · ${b.drNumber}` : next.label,
            client: maskClient(q.inquiry.customer.company), amount: null, currency: q.currency,
            href: `/orders/${q.id}`, deliveryMode: "multi",
          });
        }
      }
      const pend = pendingStep(wf);
      if (!pend) continue;
      const owesByRole = pend.roles.some((r) => has(r as WorkflowRoleKey));
      const owesBySales = !!pend.sales && (user.role === "SALES" || user.role === "ENGINEER" || q.preparedById === user.id);
      if (!owesByRole && !owesBySales) continue;
      tasks.push({
        key: `order:${q.id}`, area: "order", areaLabel: AREA_LABEL.order,
        title: q.quoteNumber, action: pend.action,
        client: maskClient(q.inquiry.customer.company), amount: maskAmount(Number(q.total)), currency: q.currency,
        href: `/orders/${q.id}`,
        deliveryMode: wf.deliveryMode === "multi" ? "multi" : "single",
      });
    }
  } catch { /* ignore */ }

  // 2) Purchasing — purchase requests whose next step needs a role the viewer holds.
  try {
    const prs = await prisma.purchaseRequest.findMany({
      where: { status: { notIn: ["COMPLETED", "REJECTED", "CANCELLED"] } },
      include: { quotation: { include: { inquiry: { include: { customer: true } } } } },
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
        });
      }
      // The Purchaser must raise the PO for an approved requisition that has none
      // yet (e.g. an escalated MRF the Plant Manager just approved). The chain's
      // "approve PO" step assumes a PO already exists, so surface this explicitly.
      if (has("purchaser") && pr.status === "APPROVED" && !pr.po) {
        tasks.push({
          key: `pr-po:${pr.id}`, area: "purchase", areaLabel: AREA_LABEL.purchase,
          title: label, action: "Prepare Purchase Order",
          client: pr.quotationId ? maskClient(company) : null, amount: null, currency: "PHP",
          href: pr.quotationId ? `/orders/${pr.quotationId}` : "/purchasing",
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
        href: pr.quotationId ? `/orders/${pr.quotationId}` : "/purchasing",
      });
    }
  } catch { /* ignore */ }

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
        href: "/cash-requests",
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
          href: "/calendar",
        });
      }
    } catch { /* ignore */ }
  }

  // 5) Commissions awaiting payout — Accounting / Admin mark them paid.
  if (isAdmin(user) || has("accounting")) {
    try {
      const comm = await prisma.commission.findMany({
        where: { paid: false },
        include: { quotation: { include: { inquiry: { include: { customer: true } } } } },
        orderBy: { salesMonth: "desc" },
        take: 100,
      });
      for (const c of comm) {
        tasks.push({
          key: `comm:${c.id}`, area: "commission", areaLabel: AREA_LABEL.commission,
          title: `Commission · ${c.quotation.quoteNumber}`, action: "Mark commission paid",
          client: maskClient(c.quotation.inquiry.customer.company), amount: maskAmount(Number(c.amount)), currency: "PHP",
          href: `/orders/${c.quotationId}`,
        });
      }
    } catch { /* ignore */ }
  }

  // 6) Quotations awaiting approval — Engineer / Admin.
  if (canApprove(user)) {
    try {
      const q = await prisma.quotation.findMany({
        where: { status: "PENDING_APPROVAL" },
        include: { inquiry: { include: { customer: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      for (const quote of q) {
        tasks.push({
          key: `quote:${quote.id}`, area: "quotation", areaLabel: AREA_LABEL.quotation,
          title: quote.quoteNumber, action: "Approve quotation",
          client: maskClient(quote.inquiry.customer.company), amount: maskAmount(Number(quote.total)), currency: quote.currency,
          href: `/quotations/${quote.id}`,
        });
      }
    } catch { /* ignore */ }
  }

  // 7) Inventory double-handshake stock actions. Both the Warehouseman and the
  //    Purchaser are parties to every action, so surface all pending ones to
  //    both — the action text reflects whose sign-off is next (or "Awaiting …"
  //    when the viewer has already signed and it's the other party's turn).
  if (has("warehouse") || has("purchaser")) {
    try {
      const actions = await prisma.stockAction.findMany({
        where: { status: "PENDING" },
        orderBy: { proposedAt: "desc" },
        take: 100,
      });
      for (const a of actions) {
        // Whose sign-off is still outstanding (Warehouse fills first, then Purchaser).
        const nextRole: "warehouse" | "purchaser" | null =
          a.warehouseAt == null ? "warehouse" : a.purchaserAt == null ? "purchaser" : null;
        if (nextRole == null) continue; // both in — shouldn't still be PENDING
        const myTurn = has(nextRole);
        const label = STOCK_ACTION_LABEL[a.kind];
        tasks.push({
          key: `stock:${a.id}`, area: "inventory", areaLabel: AREA_LABEL.inventory,
          title: a.itemName,
          action: myTurn ? `Approve ${label}` : `Awaiting ${workflowRoleLabel(nextRole)} — ${label}`,
          client: null, amount: null, currency: "PHP",
          href: "/inventory#inv-items",
        });
      }
    } catch { /* StockAction table not migrated — ignore */ }
  }

  const byArea = (Object.keys(AREA_LABEL) as TaskArea[])
    .map((area) => ({ area, label: AREA_LABEL[area], count: tasks.filter((t) => t.area === area).length }))
    .filter((a) => a.count > 0);

  const activity = await listActivityForActor(user.id, 30);

  materialsFeed.sort((a, b) => b.when.localeCompare(a.when));

  return {
    // Sales base-role users get their own My Dashboard too — to monitor their
    // approvals (notify client, 2nd QC, POD) and the production-status card —
    // even when they hold no workflow role.
    hasRole: isAdmin(user) || holdsAnyRole || user.role === "SALES" || user.role === "ENGINEER",
    roleLabels: viewerRoleLabels(user, assignments),
    pending: tasks,
    activity,
    byArea,
    materialsFeed: materialsFeed.slice(0, 15),
  };
}
