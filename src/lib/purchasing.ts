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
  | "TASKED"
  | "PURCHASED"
  | "CHECKED"
  | "DELIVERED"
  | "RECEIVED"
  | "COMPLETED"
  | "CANCELLED";

export const PR_STATUS_LABEL: Record<PRStatus, string> = {
  PENDING_APPROVAL: "Awaiting approval",
  REJECTED: "Rejected",
  APPROVED: "Approved — awaiting voucher",
  VOUCHER_READY: "Voucher ready — awaiting signing",
  VOUCHER_SIGNED: "Voucher signed — awaiting cash release",
  CASH_RELEASED: "Cash released — awaiting hand-off",
  WITH_PURCHASER: "With purchaser — awaiting task assignment",
  TASKED: "Tasks assigned — awaiting purchase",
  PURCHASED: "Purchased — awaiting check",
  CHECKED: "Checked — awaiting delivery to warehouse",
  DELIVERED: "Delivered — awaiting warehouse receiving",
  RECEIVED: "Received — awaiting Plant Manager",
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
    "WITH_PURCHASER", "TASKED", "PURCHASED", "CHECKED", "DELIVERED",
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
  { key: "voucher", from: "APPROVED", to: "VOUCHER_READY", role: "accounting", label: "Prepare voucher & checks" },
  { key: "sign", from: "VOUCHER_READY", to: "VOUCHER_SIGNED", role: "payment_approver", label: "Sign check & voucher" },
  { key: "release_cash", from: "VOUCHER_SIGNED", to: "CASH_RELEASED", role: "payment_approver", label: "Release cash" },
  { key: "hand_purchaser", from: "CASH_RELEASED", to: "WITH_PURCHASER", role: "accounting", label: "Give cash & check to Purchaser" },
  { key: "assign_tasks", from: "WITH_PURCHASER", to: "TASKED", role: "purchaser", label: "Give to Logistics Head & distribute tasks" },
  { key: "buy", from: "TASKED", to: "PURCHASED", role: "purchaser", label: "Item bought" },
  { key: "check", from: "PURCHASED", to: "CHECKED", role: "purchaser", label: "Check & approve purchased item" },
  { key: "deliver", from: "CHECKED", to: "DELIVERED", role: "logistics", label: "Deliver to Warehouseman" },
  { key: "receive", from: "DELIVERED", to: "RECEIVED", role: "warehouse", label: "Warehouseman receive & approve" },
  { key: "plant", from: "RECEIVED", to: "COMPLETED", role: "plant_manager", label: "Plant Manager final approval" },
];

/** New chain steps whose sign-off rides in the PurchaseRequest.chainLog JSON. */
export const CHAINLOG_STEPS = ["sign", "release_cash", "hand_purchaser", "assign_tasks", "deliver"] as const;

export function purchaseStepsFrom(status: PRStatus): PurchaseStepDef[] {
  return PURCHASE_STEPS.filter((s) => s.from === status);
}

export function purchaseStep(key: string): PurchaseStepDef | undefined {
  return PURCHASE_STEPS.find((s) => s.key === key);
}
