/**
 * Builds the row shape the PurchasingChain component renders, from a stored
 * PurchaseRequest. Shared by the per-order Phase 3 box (read-only monitoring)
 * and the central Purchasing workspace (where the purchaser processes them).
 */
import { coercePurchaseOrder, poLineFromPRItem, type POLine, type PurchaseOrder } from "@/lib/purchase-order";
import { purchaseStepsFrom, PR_STATUS_LABEL, type PRStatus } from "@/lib/purchasing";
import { coercePurchaseReturns, hasUnresolvedReturn, canRaiseReturnAt } from "@/lib/purchase-returns";
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
}

/** The PurchaseRequest fields the builder reads (subset of the Prisma row). */
export interface PurchaseRequestLike {
  id: string;
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
  return [
    stamp("Requested", "Requestor", pr.createdByName, pr.createdAt),
    stamp(status === "REJECTED" ? "Rejected" : "Approved", approver, pr.decidedByName, pr.decidedAt),
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
  const actions = purchaseStepsFrom(status).map((step) => {
    const names = ctx.namesForRole(step.role);
    return {
      key: step.key,
      label: step.label,
      roleLabel: `${workflowRoleLabel(step.role)}${names.length ? ` (${names.join(", ")})` : ""}`,
      canAct: ctx.canAct(step.role),
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
  };
}
