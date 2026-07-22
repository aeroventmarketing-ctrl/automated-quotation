/**
 * Builds the row shape the PurchasingChain component renders, from a stored
 * PurchaseRequest. Shared by the per-order Phase 3 box (read-only monitoring)
 * and the central Purchasing workspace (where the purchaser processes them).
 */
import { coercePurchaseOrder, poLineFromPRItem, poLineAmount, poHasEwt, type POLine, type PurchaseOrder } from "@/lib/purchase-order";
import { purchaseStepsFrom, effectiveStepRole, PR_STATUS_LABEL, priorPurchaseStatuses, type PRStatus } from "@/lib/purchasing";
import { coercePurchaseReturns, hasUnresolvedReturn, canRaiseReturnAt } from "@/lib/purchase-returns";
import { coerceReconciliation, reconcileTotals, vatFactor, isReconciled, canReconcileAt, type ReconcileStatus, type ReconcileVatMode } from "@/lib/purchase-reconcile";
import { round2 } from "@/lib/quote";
import { workflowRoleLabel, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { deptLabel, PRODUCTION_DEPTS } from "@/lib/order-workflow";
import { formatDateTime } from "@/lib/utils";

export interface PurchaseActionOpt {
  key: string;
  label: string;
  canAct: boolean;
  roleLabel: string;
}

/** A supplier return, formatted for display. */
export interface PurchaseReturnView {
  id: string;
  items: string;
  reason: string;
  raised: string; // "Name (Role) · date/time"
  resolved: string | null; // resolution stamp, or null while awaiting replacement
  proof: { path: string; name: string }[]; // proof the item was replaced
}

/** One reconciled line: PO expected (VAT-adjusted) vs actual paid. */
export interface ReconcileLineView {
  description: string;
  qty: string;
  poAmount: number; // PO gross line amount as priced
  expected: number; // poAmount × VAT factor (what should be paid)
  actualAmount: number; // actual paid, per the receipt
  variance: number; // expected − actual
}

/** Voucher reconciliation, formatted for display. */
export interface PurchaseReconcileView {
  vatMode: ReconcileVatMode;
  // PO lines for seeding the record form (description, qty, expected PO amount).
  poLines: { description: string; qty: string; unit: string; poAmount: number }[];
  // Recorded per-line actuals (null until the purchaser records them).
  lines: ReconcileLineView[] | null;
  voucherAmount: number; // expected total (Σ PO amount × VAT factor)
  actualSpent: number | null; // Σ actual paid, or null until recorded
  variance: number; // voucher − spent
  status: ReconcileStatus | null; // null until recorded
  receipts: { path: string; name: string }[];
  recorded: string | null; // "Name (Role) · date/time"
  escalated: string | null; // accounting informed the approver
  approved: string | null; // approver authorised the discrepancy
  settled: string | null; // settlement stamp, or null
  note: string | null;
  aiReads: number; // AI receipt reads used (against the per-voucher limit)
  aiReadEscalated: string | null; // accounting informed the approver the AI limit was hit
}

export function buildReconcileView(pr: PurchaseRequestLike): PurchaseReconcileView {
  const r = coerceReconciliation(pr.reconciliation);
  const po = coercePurchaseOrder(pr.po);
  const poLines = (po?.lines ?? []).map((l) => ({ description: l.description, qty: l.qty, unit: l.unit, poAmount: poLineAmount(l) }));
  // Until the purchaser records the reconciliation, default the VAT mode from the
  // PO: a PO with no EWT is a VAT-exclusive purchase; one that withholds EWT
  // (by percent or a flat amount) is VAT-inclusive.
  const vatMode = r.vatMode ?? (po && !poHasEwt(po) ? "exclusive" : "inclusive");
  const factor = vatFactor(vatMode);
  const recorded = isReconciled(r);

  let lines: ReconcileLineView[] | null = null;
  let voucherAmount: number;
  let actualSpent: number | null = null;
  let variance = 0;
  let status: ReconcileStatus | null = null;

  if (recorded) {
    const t = reconcileTotals(r.lines!, vatMode);
    lines = r.lines!.map((l) => {
      const expected = round2(l.poAmount * factor);
      return { description: l.description, qty: l.qty, poAmount: l.poAmount, expected, actualAmount: l.actualAmount, variance: round2(expected - l.actualAmount) };
    });
    voucherAmount = t.voucher;
    actualSpent = t.actual;
    variance = t.variance;
    status = t.status;
  } else {
    voucherAmount = round2(poLines.reduce((a, l) => a + l.poAmount, 0) * factor);
  }

  return {
    vatMode,
    poLines,
    lines,
    voucherAmount,
    actualSpent,
    variance,
    status,
    receipts: (r.receipts ?? []).map((d) => ({ path: d.path, name: d.name })),
    recorded: r.recordedAt ? `${r.recordedByName}${r.recordedRole ? ` (${r.recordedRole})` : ""} · ${formatDateTime(new Date(r.recordedAt))}` : null,
    escalated: stampLabel(r.escalation),
    approved: stampLabel(r.approval),
    settled: stampLabel(r.settled),
    note: r.note ?? null,
    aiReads: r.aiReadCount ?? 0,
    aiReadEscalated: stampLabel(r.aiReadEscalation),
  };
}

function stampLabel(s: { byName: string; role: string; at: string; note?: string } | undefined): string | null {
  if (!s?.at) return null;
  return `${s.byName}${s.role ? ` (${s.role})` : ""} · ${formatDateTime(new Date(s.at))}${s.note ? ` · ${s.note}` : ""}`;
}

export interface PurchaseChainRow {
  id: string;
  deptLabel: string;
  mrfNo?: string | null;
  items: string[];
  note?: string | null;
  status: PRStatus;
  statusLabel: string;
  variant: "secondary" | "warning" | "success" | "destructive";
  trail: string[];
  actions: PurchaseActionOpt[];
  po: PurchaseOrder | null;
  poDefaultLines: POLine[];
  canManagePO: boolean;
  canCancel?: boolean;
  canDelete?: boolean;
  returns: PurchaseReturnView[];
  canRaiseReturn: boolean;
  canResolveReturn: boolean;
  reconcile: PurchaseReconcileView;
  canRecordReconcile: boolean;
  canSettleReconcile: boolean;
  canEscalateReconcile: boolean;
  canApproveReconcile: boolean;
  canOverride: boolean; // admin escape hatch — roll the chain back
  priorStatuses: { key: string; label: string }[];
}

/** The PurchaseRequest fields the builder reads (subset of the Prisma row). */
export interface PurchaseRequestLike {
  id: string;
  kind?: string | null;
  dept: string | null;
  items: unknown;
  note: string | null;
  status: string;
  po: unknown;
  createdByName: string;
  createdAt: Date;
  decidedByName: string | null;
  decidedAt: Date | null;
  voucherByName: string | null;
  voucherAt: Date | null;
  purchasedByName: string | null;
  purchasedAt: Date | null;
  checkedByName: string | null;
  checkedAt: Date | null;
  receivedByName: string | null;
  receivedAt: Date | null;
  plantApprovedByName: string | null;
  plantApprovedAt: Date | null;
  chainLog?: unknown;
  returns?: unknown;
  reconciliation?: unknown;
}

/** Format a request's supplier returns for display. */
export function buildReturnViews(pr: PurchaseRequestLike): PurchaseReturnView[] {
  return coercePurchaseReturns(pr.returns).map((r) => ({
    id: r.id,
    items: r.items,
    reason: r.reason,
    raised: `${r.raisedByName}${r.raisedRole ? ` (${r.raisedRole})` : ""} · ${formatDateTime(r.raisedAt ? new Date(r.raisedAt) : undefined)}`,
    resolved: r.resolvedAt
      ? `Replacement received — ${r.resolvedByName}${r.resolvedRole ? ` (${r.resolvedRole})` : ""} · ${formatDateTime(new Date(r.resolvedAt))}${r.resolutionNote ? ` · ${r.resolutionNote}` : ""}`
      : null,
    proof: (r.proof ?? []).map((d) => ({ path: d.path, name: d.name })),
  }));
}

interface ChainLogEntry { byName?: string; at?: string }
export function coerceChainLog(v: unknown): Record<string, ChainLogEntry> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, ChainLogEntry> = {};
  for (const [k, e] of Object.entries(v as Record<string, unknown>)) {
    if (e && typeof e === "object") {
      const o = e as Record<string, unknown>;
      out[k] = { byName: typeof o.byName === "string" ? o.byName : undefined, at: typeof o.at === "string" ? o.at : undefined };
    }
  }
  return out;
}

/**
 * The full role-stamped chain trail for a purchase request, in order. Each entry
 * carries the actor's name, their title (designation), and the date & time.
 */
export function buildPurchaseTrail(pr: PurchaseRequestLike): string[] {
  const status = pr.status as PRStatus;
  const log = coerceChainLog(pr.chainLog);
  const stamp = (label: string, title: string, who?: string | null, at?: Date | null) =>
    who ? `${label} — ${who} (${title}) · ${formatDateTime(at ?? undefined)}` : null;
  const lstamp = (label: string, title: string, key: string) => {
    const e = log[key];
    return e?.byName ? `${label} — ${e.byName} (${title}) · ${formatDateTime(e.at ? new Date(e.at) : undefined)}` : null;
  };
  const approver = workflowRoleLabel("payment_approver");
  const acct = workflowRoleLabel("accounting");
  const purchaser = workflowRoleLabel("purchaser");
  const logistics = workflowRoleLabel("logistics");
  const warehouse = workflowRoleLabel("warehouse");
  const plant = workflowRoleLabel("plant_manager");
  // Department requisitions are approved/rejected by the Plant Manager (step 16).
  const decider = pr.kind === "department" ? plant : approver;
  return [
    stamp("Requested", "Requestor", pr.createdByName, pr.createdAt),
    stamp(status === "REJECTED" ? "Rejected" : "Approved", decider, pr.decidedByName, pr.decidedAt),
    stamp("Voucher & checks prepared", acct, pr.voucherByName, pr.voucherAt),
    lstamp("Check & voucher signed", approver, "sign"),
    lstamp("Cash released", approver, "release_cash"),
    lstamp("Cash & check to Purchaser", acct, "hand_purchaser"),
    lstamp("Cash & check received", purchaser, "confirm_cash"),
    lstamp("Tasks distributed to Logistics", purchaser, "assign_tasks"),
    lstamp("Cash received by Logistics Head", logistics, "logistics_confirm"),
    stamp("Item bought", purchaser, pr.purchasedByName, pr.purchasedAt),
    stamp("Item checked & approved", purchaser, pr.checkedByName, pr.checkedAt),
    lstamp("Delivered to Warehouseman", logistics, "deliver"),
    lstamp("Warehouseman received & approved", warehouse, "warehouse_approve"),
    stamp("Plant Manager final approval", plant, pr.plantApprovedByName, pr.plantApprovedAt),
    stamp("Received & added to stock", warehouse, pr.receivedByName, pr.receivedAt),
  ].filter((s): s is string => s !== null);
}

function prVariant(s: PRStatus): PurchaseChainRow["variant"] {
  return s === "PENDING_APPROVAL" ? "secondary" : s === "REJECTED" ? "destructive" : s === "COMPLETED" ? "success" : "warning";
}

export function buildPurchaseChainRow(
  pr: PurchaseRequestLike,
  ctx: {
    mrfNo?: string | null;
    canManagePO: boolean;
    canCancel?: boolean;
    canDelete?: boolean;
    namesForRole: (role: WorkflowRoleKey) => string[];
    canAct: (role: WorkflowRoleKey) => boolean;
    admin?: boolean;
  },
): PurchaseChainRow {
  const status = pr.status as PRStatus;
  const prItems = Array.isArray(pr.items) ? (pr.items as string[]) : [];
  const trail = buildPurchaseTrail(pr);
  const returns = buildReturnViews(pr);
  // Inspectors (purchaser / warehouse / plant manager) can flag a return; the
  // purchaser or warehouse can mark the replacement received.
  const canRaiseReturn =
    canRaiseReturnAt(status) && (ctx.canAct("purchaser") || ctx.canAct("warehouse") || ctx.canAct("plant_manager"));
  const canResolveReturn = ctx.canAct("purchaser") || ctx.canAct("warehouse");
  // Voucher reconciliation: the purchaser records the spend once bought;
  // accounting or the purchaser settle any change / overspend.
  const reconcile = buildReconcileView(pr);
  // Purchaser/accounting record it; the approver may also edit figures.
  const canRecordReconcile = canReconcileAt(status) && (ctx.canAct("purchaser") || ctx.canAct("accounting") || ctx.canAct("payment_approver"));
  const canSettleReconcile = ctx.canAct("accounting") || ctx.canAct("purchaser");
  // Discrepancy authorisation: accounting/purchaser escalate; the approver approves.
  const canEscalateReconcile = ctx.canAct("accounting") || ctx.canAct("purchaser");
  const canApproveReconcile = ctx.canAct("payment_approver");
  const isDept = pr.kind === "department";
  const actions = purchaseStepsFrom(status).map((step) => {
    const role = effectiveStepRole(step, isDept);
    const names = ctx.namesForRole(role);
    return {
      key: step.key,
      label: step.label,
      roleLabel: `${workflowRoleLabel(role)}${names.length ? ` (${names.join(", ")})` : ""}`,
      canAct: ctx.canAct(role),
    };
  });
  return {
    id: pr.id,
    deptLabel: deptLabel(pr.dept as (typeof PRODUCTION_DEPTS)[number]["key"]),
    mrfNo: ctx.mrfNo ?? null,
    items: prItems,
    note: pr.note,
    status,
    statusLabel: PR_STATUS_LABEL[status],
    variant: prVariant(status),
    trail,
    actions,
    po: coercePurchaseOrder(pr.po),
    poDefaultLines: prItems.map(poLineFromPRItem),
    canManagePO: ctx.canManagePO,
    canCancel: ctx.canCancel ?? false,
    canDelete: ctx.canDelete ?? false,
    returns,
    canRaiseReturn,
    canResolveReturn,
    reconcile,
    canRecordReconcile,
    canSettleReconcile,
    canEscalateReconcile,
    canApproveReconcile,
    canOverride: ctx.admin ?? false,
    priorStatuses: ctx.admin ? priorPurchaseStatuses(status).map((s) => ({ key: s, label: PR_STATUS_LABEL[s] })) : [],
  };
}
