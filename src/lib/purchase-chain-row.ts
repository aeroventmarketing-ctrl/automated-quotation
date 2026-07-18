/**
 * Builds the row shape the PurchasingChain component renders, from a stored
 * PurchaseRequest. Shared by the per-order Phase 3 box (read-only monitoring)
 * and the central Purchasing workspace (where the purchaser processes them).
 */
import { coercePurchaseOrder, poLineFromPRItem, type POLine, type PurchaseOrder } from "@/lib/purchase-order";
import { purchaseStepsFrom, PR_STATUS_LABEL, type PRStatus } from "@/lib/purchasing";
import { workflowRoleLabel, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { deptLabel, PRODUCTION_DEPTS } from "@/lib/order-workflow";
import { formatDateTime } from "@/lib/utils";

export interface PurchaseActionOpt {
  key: string;
  label: string;
  canAct: boolean;
  roleLabel: string;
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
    namesForRole: (role: WorkflowRoleKey) => string[];
    canAct: (role: WorkflowRoleKey) => boolean;
  },
): PurchaseChainRow {
  const status = pr.status as PRStatus;
  const prItems = Array.isArray(pr.items) ? (pr.items as string[]) : [];
  const stamp = (label: string, who?: string | null, at?: Date | null) =>
    who ? `${label} — ${who} · ${formatDateTime(at ?? undefined)}` : null;
  const trail = [
    stamp("Requested", pr.createdByName, pr.createdAt),
    stamp(status === "REJECTED" ? "Rejected" : "Approved", pr.decidedByName, pr.decidedAt),
    stamp("Voucher & check", pr.voucherByName, pr.voucherAt),
    stamp("Purchased", pr.purchasedByName, pr.purchasedAt),
    stamp("Checked", pr.checkedByName, pr.checkedAt),
    stamp("Received", pr.receivedByName, pr.receivedAt),
    stamp("Plant Manager approved", pr.plantApprovedByName, pr.plantApprovedAt),
  ].filter((s): s is string => s !== null);
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
  };
}
