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
export function statusBucket(status: PRStatus): PRBucket {
  if (status === "PENDING_APPROVAL") return "pending";
  if (status === "REJECTED") return "rejected";
  if (status === "CANCELLED") return "cancelled";
  return "approved"; // APPROVED, VOUCHER_READY, PURCHASED, CHECKED, RECEIVED, COMPLETED
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

/** The chain, in order. PENDING_APPROVAL offers both approve and reject. */
export const PURCHASE_STEPS: PurchaseStepDef[] = [
  { key: "approve", from: "PENDING_APPROVAL", to: "APPROVED", role: "payment_approver", label: "Approve purchase" },
  { key: "reject", from: "PENDING_APPROVAL", to: "REJECTED", role: "payment_approver", label: "Reject" },
  { key: "voucher", from: "APPROVED", to: "VOUCHER_READY", role: "accounting", label: "Voucher & Check Prepared" },
  { key: "sign", from: "VOUCHER_READY", to: "VOUCHER_SIGNED", role: "payment_approver", label: "Voucher & Check Signed" },
  { key: "release_cash", from: "VOUCHER_SIGNED", to: "CASH_RELEASED", role: "payment_approver", label: "Cash & Check Released" },
  { key: "hand_purchaser", from: "CASH_RELEASED", to: "WITH_PURCHASER", role: "accounting", label: "Give Cash & Check to Purchaser" },
  { key: "confirm_cash", from: "WITH_PURCHASER", to: "CASH_CONFIRMED", role: "purchaser", label: "Confirm cash & check received" },
  { key: "assign_tasks", from: "CASH_CONFIRMED", to: "TASKED", role: "purchaser", label: "Give to Logistics Head & Distribute Tasks" },
  { key: "logistics_confirm", from: "TASKED", to: "LOGISTICS_CONFIRMED", role: "logistics", label: "Confirm cash received by Logistics Head" },
  { key: "buy", from: "LOGISTICS_CONFIRMED", to: "PURCHASED", role: "purchaser", label: "Item bought" },
  { key: "check", from: "PURCHASED", to: "CHECKED", role: "purchaser", label: "Check & approve purchased item" },
  { key: "deliver", from: "CHECKED", to: "DELIVERED", role: "logistics", label: "Deliver to Warehouseman" },
  { key: "warehouse_approve", from: "DELIVERED", to: "RECEIVED", role: "warehouse", label: "Warehouseman Received and Approved" },
  { key: "plant", from: "RECEIVED", to: "PLANT_APPROVED", role: "plant_manager", label: "Plant Manager final approval" },
  { key: "receive", from: "PLANT_APPROVED", to: "COMPLETED", role: "warehouse", label: "Receive & add to stock" },
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

export function purchaseStepsFrom(status: PRStatus): PurchaseStepDef[] {
  return PURCHASE_STEPS.filter((s) => s.from === status);
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
