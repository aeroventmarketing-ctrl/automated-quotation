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
  | "PURCHASED"
  | "CHECKED"
  | "RECEIVED"
  | "COMPLETED"
  | "CANCELLED";

export const PR_STATUS_LABEL: Record<PRStatus, string> = {
  PENDING_APPROVAL: "Awaiting approval",
  REJECTED: "Rejected",
  APPROVED: "Approved — awaiting voucher",
  VOUCHER_READY: "Voucher ready — awaiting purchase",
  PURCHASED: "Purchased — awaiting check",
  CHECKED: "Checked — awaiting receiving",
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
  return (["PENDING_APPROVAL", "APPROVED", "VOUCHER_READY", "PURCHASED", "CHECKED"] as PRStatus[]).includes(status);
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
  { key: "voucher", from: "APPROVED", to: "VOUCHER_READY", role: "accounting", label: "Voucher & check ready" },
  { key: "buy", from: "VOUCHER_READY", to: "PURCHASED", role: "logistics", label: "Mark purchased" },
  { key: "check", from: "PURCHASED", to: "CHECKED", role: "purchaser", label: "Items checked" },
  { key: "receive", from: "CHECKED", to: "RECEIVED", role: "warehouse", label: "Received at warehouse" },
  { key: "plant", from: "RECEIVED", to: "COMPLETED", role: "plant_manager", label: "Final approval" },
];

export function purchaseStepsFrom(status: PRStatus): PurchaseStepDef[] {
  return PURCHASE_STEPS.filter((s) => s.from === status);
}

export function purchaseStep(key: string): PurchaseStepDef | undefined {
  return PURCHASE_STEPS.find((s) => s.key === key);
}
