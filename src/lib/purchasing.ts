/**
 * Purchasing chain (Phase 3, steps 8-13) driven by the PurchaseRequest table.
 * A material request the warehouse escalates becomes a PurchaseRequest that walks
 * this role-gated status chain, each step stamped with who + when.
 */
import type { WorkflowRoleKey } from "@/lib/workflow-roles";

export type PRStatus =
  | "PENDING_APPROVAL"
  | "REJECTED"
  | "APPROVED"
  | "VOUCHER_READY"
  | "VOUCHER_SIGNED"
  | "CASH_RELEASED"
  | "WITH_PURCHASER"
  | "CASH_CONFIRMED"
  | "TASKED"
  | "LOGISTICS_CONFIRMED"
  | "PURCHASED"
  | "CHECKED"
  | "DELIVERED"
  | "RECEIVED"
  | "PLANT_APPROVED"
  | "COMPLETED"
  | "CANCELLED";

export const PR_STATUS_LABEL: Record<PRStatus, string> = {
  PENDING_APPROVAL: "Awaiting approval",
  REJECTED: "Rejected",
  APPROVED: "Approved — awaiting voucher",
  VOUCHER_READY: "Voucher ready — awaiting signing",
  VOUCHER_SIGNED: "Voucher signed — awaiting cash release",
  CASH_RELEASED: "Cash released — awaiting hand-off",
  WITH_PURCHASER: "Handed to purchaser — awaiting purchaser's confirmation",
  CASH_CONFIRMED: "Cash confirmed by purchaser — awaiting task assignment",
  TASKED: "Handed to Logistics Head — awaiting confirmation",
  LOGISTICS_CONFIRMED: "Cash confirmed by Logistics Head — awaiting purchase",
  PURCHASED: "Purchased — awaiting check",
  CHECKED: "Checked — awaiting delivery to warehouse",
  DELIVERED: "Delivered — awaiting Warehouseman's approval",
  RECEIVED: "Warehouseman approved — awaiting Plant Manager",
  PLANT_APPROVED: "Plant Manager approved — awaiting receiving into stock",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** The tab a PO belongs to, grouping the fine-grained chain statuses. */
export type PRBucket = "pending" | "approved" | "rejected" | "cancelled";
/**
 * The tab a purchase request belongs to. A material/department requisition is
 * kept in "pending" until the Approver approves its Purchase Order: the Plant
 * Manager approving the MRF (→ APPROVED) only clears it FOR purchasing, and the
 * Purchaser still has to raise the PO and the Approver still has to approve it
 * (chainLog.approve_po). Only then does it belong under "Approved".
 */
export function statusBucket(status: PRStatus, ctx?: { isDept?: boolean; poApproved?: boolean }): PRBucket {
  if (status === "PENDING_APPROVAL") return "pending";
  if (status === "REJECTED") return "rejected";
  if (status === "CANCELLED") return "cancelled";
  // A department/MRF requisition at APPROVED is only Plant-Manager-approved — it
  // still awaits the Approver's purchase-order approval (recorded in chainLog),
  // so keep it pending until that approval lands.
  if (ctx?.isDept && status === "APPROVED" && !ctx.poApproved) return "pending";
  return "approved"; // VOUCHER_READY, PURCHASED, CHECKED, RECEIVED, COMPLETED (+ approved dept & non-dept APPROVED)
}

/** A PO can be cancelled by the purchaser up until it's received into stock. */
export function isCancellable(status: PRStatus): boolean {
  return ([
    "PENDING_APPROVAL", "APPROVED", "VOUCHER_READY", "VOUCHER_SIGNED", "CASH_RELEASED",
    "WITH_PURCHASER", "CASH_CONFIRMED", "TASKED", "LOGISTICS_CONFIRMED",
    "PURCHASED", "CHECKED", "DELIVERED", "RECEIVED", "PLANT_APPROVED",
  ] as PRStatus[]).includes(status);
}

export interface PurchaseStepDef {
  key: string;
  from: PRStatus;
  to: PRStatus;
  role: WorkflowRoleKey;
  label: string;
}

/**
 * The chain, in order. PENDING_APPROVAL offers both approve and reject. For a
 * material/department requisition the Plant Manager's approval (approve) only
 * clears the MRF; the Purchaser then raises the PO and the Approver approves it
 * (approve_po, recorded in chainLog while the status stays APPROVED) before
 * accounting readies the voucher. Order-linked (non-department) requests skip
 * that second gate — their single "approve" IS the Approver's PO approval.
 */
export const PURCHASE_STEPS: PurchaseStepDef[] = [
  { key: "approve", from: "PENDING_APPROVAL", to: "APPROVED", role: "payment_approver", label: "Approve purchase" },
  { key: "reject", from: "PENDING_APPROVAL", to: "REJECTED", role: "payment_approver", label: "Reject" },
  // The Approver's PO approval keeps the status at APPROVED (it's recorded in
  // chainLog.approve_po) so no new enum value / DB migration is needed; the
  // voucher step then unlocks. reject_po sends it to REJECTED.
  { key: "approve_po", from: "APPROVED", to: "APPROVED", role: "payment_approver", label: "Approve purchase" },
  { key: "reject_po", from: "APPROVED", to: "REJECTED", role: "payment_approver", label: "Reject" },
  { key: "voucher", from: "APPROVED", to: "VOUCHER_READY", role: "accounting", label: "Voucher & Check Prepared" },
  { key: "sign", from: "VOUCHER_READY", to: "VOUCHER_SIGNED", role: "payment_approver", label: "Voucher & Check Signed" },
  { key: "release_cash", from: "VOUCHER_SIGNED", to: "CASH_RELEASED", role: "payment_approver", label: "Cash & Check Released" },
  { key: "hand_purchaser", from: "CASH_RELEASED", to: "WITH_PURCHASER", role: "accounting", label: "Give Cash & Check to Purchaser" },
  { key: "confirm_cash", from: "WITH_PURCHASER", to: "CASH_CONFIRMED", role: "purchaser", label: "Confirm cash & check received" },
  { key: "assign_tasks", from: "CASH_CONFIRMED", to: "TASKED", role: "purchaser", label: "Give to Logistics Head & Distribute Tasks" },
  { key: "logistics_confirm", from: "TASKED", to: "LOGISTICS_CONFIRMED", role: "logistics", label: "Confirm Cash Received by Logistics Head" },
  { key: "buy", from: "LOGISTICS_CONFIRMED", to: "PURCHASED", role: "purchaser", label: "Item Bought" },
  { key: "check", from: "PURCHASED", to: "CHECKED", role: "purchaser", label: "Check & Approve Purchased Item" },
  { key: "deliver", from: "CHECKED", to: "DELIVERED", role: "logistics", label: "Deliver to Warehouseman" },
  { key: "warehouse_approve", from: "DELIVERED", to: "RECEIVED", role: "warehouse", label: "Warehouseman Received and Approved" },
  { key: "plant", from: "RECEIVED", to: "PLANT_APPROVED", role: "plant_manager", label: "Plant Manager Final Approval" },
  { key: "receive", from: "PLANT_APPROVED", to: "COMPLETED", role: "warehouse", label: "Receive & Add Stock" },
];

/** New chain steps whose sign-off rides in the PurchaseRequest.chainLog JSON. */
export const CHAINLOG_STEPS = ["sign", "release_cash", "hand_purchaser", "confirm_cash", "assign_tasks", "logistics_confirm", "deliver", "warehouse_approve"] as const;

/** The linear main chain, in order (excludes REJECTED / CANCELLED branches). */
export const PR_MAIN_ORDER: PRStatus[] = [
  "PENDING_APPROVAL", "APPROVED", "VOUCHER_READY", "VOUCHER_SIGNED", "CASH_RELEASED",
  "WITH_PURCHASER", "CASH_CONFIRMED", "TASKED", "LOGISTICS_CONFIRMED",
  "PURCHASED", "CHECKED", "DELIVERED", "RECEIVED", "PLANT_APPROVED", "COMPLETED",
];
export function prMainIndex(status: PRStatus): number {
  return PR_MAIN_ORDER.indexOf(status);
}
/** Earlier statuses an admin may roll a request back to (a rejected/cancelled one reopens to the start). */
export function priorPurchaseStatuses(status: PRStatus): PRStatus[] {
  if (status === "REJECTED" || status === "CANCELLED") return ["PENDING_APPROVAL"];
  const idx = prMainIndex(status);
  return idx <= 0 ? [] : PR_MAIN_ORDER.slice(0, idx);
}

/**
 * The steps available from a status. For a material/department requisition the
 * APPROVED status has two sub-stages: before the Approver approves the PO it
 * offers approve_po / reject_po; once approved (chainLog.approve_po, passed as
 * `poApproved`) it offers the voucher. An order-linked request goes straight
 * from APPROVED to the voucher.
 */
export function purchaseStepsFrom(status: PRStatus, isDept = false, poApproved = false): PurchaseStepDef[] {
  if (status === "APPROVED") {
    if (isDept && !poApproved) return PURCHASE_STEPS.filter((s) => s.key === "approve_po" || s.key === "reject_po");
    return PURCHASE_STEPS.filter((s) => s.key === "voucher");
  }
  // Other statuses are single-branch transitions keyed by `from` (the approve_po
  // / reject_po / voucher steps that list from=APPROVED are handled above).
  return PURCHASE_STEPS.filter((s) => s.from === status && s.key !== "approve_po" && s.key !== "reject_po" && s.key !== "voucher");
}

/** Whether the Approver has approved the raised PO (recorded in chainLog). */
export function isPoApproved(chainLog: unknown): boolean {
  if (!chainLog || typeof chainLog !== "object") return false;
  const e = (chainLog as Record<string, unknown>).approve_po;
  return !!(e && typeof e === "object" && (e as Record<string, unknown>).byName);
}

/**
 * The role that acts on a step for a given request. For a department (warehouse)
 * requisition — raised when supplies aren't available — the initial approval /
 * rejection is done by the Plant Manager (workflow step 16) rather than the
 * Payment Approver. Every other step, and all order-linked requests, are
 * unchanged.
 */
export function effectiveStepRole(step: PurchaseStepDef, isDepartment: boolean): WorkflowRoleKey {
  if (isDepartment && (step.key === "approve" || step.key === "reject")) return "plant_manager";
  return step.role;
}

/**
 * A warehouse / material requisition — one whose initial approval (and rejection)
 * belongs to the Plant Manager (workflow step 16), not the Payment Approver. This
 * covers both standalone department requisitions (kind "department") and the
 * purchase requests escalated from an order's Material Request Form (they carry an
 * `mrfId`): in both cases the warehouseman asked for materials that aren't on hand.
 */
export function isDeptRequisition(pr: { kind?: string | null; mrfId?: string | null }): boolean {
  return pr.kind === "department" || pr.mrfId != null;
}

export function purchaseStep(key: string): PurchaseStepDef | undefined {
  return PURCHASE_STEPS.find((s) => s.key === key);
}
