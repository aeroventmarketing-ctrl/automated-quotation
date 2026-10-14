/**
 * Who a BOUGHT-IN order is waiting on while it sits at "For PO creation".
 *
 * The owner, on order 3512: *"Order 3512 is flashing for Allan Ramos and
 * Purchaser but we cannot find anything to be approved by purchaser."*
 * `pendingStep` named the Purchaser for the whole time a bought-in order is at
 * "released" — from the moment payment cleared until Sales notified the client
 * — without looking at the order's purchase request. That request is raised
 * already "Approved", so its first step is the Payment Approver's "Approve
 * purchase"; the Purchaser has nothing to do until then, and again nothing once
 * the PO is with Accounting, Logistics, and so on.
 *
 * So the order follows its request, exactly as the purchase chain's own
 * "awaiting approval" badge does:
 *
 *   - any request bought (PURCHASED onward) → Sales, "Notify Client — Order
 *     Ready" — the same test `notifyClientBoughtInOrder` makes;
 *   - otherwise each live request's next step and its role:
 *       PENDING_APPROVAL                → Plant Manager, approve
 *       APPROVED, purchase not approved → Payment Approver, approve purchase
 *       APPROVED, approved, no PO       → Purchaser, prepare the PO
 *       APPROVED with a PO              → Accounting, voucher & check
 *       later                           → that status's step;
 *   - no live request at all → the Purchaser, as before (nothing better to say).
 *
 * Pure. The rows are read by `boughtInPurchaseRows` (lib/bought-in-pending-data).
 */
import type { PendingStep } from "@/lib/order-workflow";
import { effectiveStepRole, purchaseStepsFrom, type PRStatus } from "@/lib/purchasing";
import type { WorkflowRoleKey } from "@/lib/workflow-roles";

/** The few facts about one of the order's requisitions that decide its next step. */
export interface BoughtInPurchaseRow {
  status: string;
  /** A PO has been prepared on it. */
  hasPo: boolean;
  /** The Payment Approver's purchase approval (chainLog.approve_po). */
  poApproved: boolean;
}

/** Bought — the order may now be handed to Sales. Same list as `notifyClientBoughtInOrder`. */
export const BOUGHT_STATUSES: readonly PRStatus[] = ["PURCHASED", "CHECKED", "DELIVERED", "RECEIVED", "PLANT_APPROVED", "COMPLETED"];

/** What `pendingStep` said before — and still says when there is no request. */
export const PREPARE_PO_STEP: PendingStep = { action: "Prepare & process the Purchase Order", roles: ["purchaser"] };

function nextFor(r: BoughtInPurchaseRow): { action: string; role: WorkflowRoleKey } | null {
  const status = r.status as PRStatus;
  if (status === "APPROVED") {
    if (!r.poApproved) return { action: "Approve purchase", role: "payment_approver" };
    if (!r.hasPo) return { action: "Prepare the Purchase Order", role: "purchaser" };
  }
  // A bought-in order's requisitions are department requisitions.
  const step = purchaseStepsFrom(status, true, r.poApproved).find((s) => s.key !== "reject" && s.key !== "reject_po");
  return step ? { action: step.label, role: effectiveStepRole(step, true) } : null;
}

export function boughtInPurchasePending(rows: BoughtInPurchaseRow[]): PendingStep {
  const live = rows.filter((r) => r.status !== "REJECTED" && r.status !== "CANCELLED");
  if (live.some((r) => BOUGHT_STATUSES.includes(r.status as PRStatus))) {
    return { action: "Notify Client — Order Ready", roles: [], sales: true };
  }
  const steps = live.map(nextFor).filter((s): s is NonNullable<typeof s> => s != null);
  if (steps.length === 0) return PREPARE_PO_STEP;
  return {
    action: [...new Set(steps.map((s) => s.action))].join(" · "),
    roles: [...new Set(steps.map((s) => s.role))],
  };
}
