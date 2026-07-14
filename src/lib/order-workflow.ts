/**
 * Order-to-delivery workflow state (Phase 1 for now). The stage + the sign-offs
 * ride in the quotation's classification JSON (no migration), alongside the sale
 * data. Later phases (job orders, materials, delivery) append to this model.
 *
 * Phase 1 — order intake & payment clearing:
 *   payment_review → [Accounting: doc check] → docs_checked
 *   docs_checked   → [Payment Approver: clear payment] → released (job orders out)
 */
import type { WorkflowRoleKey } from "@/lib/workflow-roles";

export type OrderStage = "payment_review" | "docs_checked" | "released";

export const ORDER_STAGES: { key: OrderStage; label: string; phase: string }[] = [
  { key: "payment_review", label: "Payment review", phase: "Phase 1" },
  { key: "docs_checked", label: "Docs checked", phase: "Phase 1" },
  { key: "released", label: "Job orders released", phase: "Phase 1 done" },
];

export interface OrderApproval {
  by: string;
  byName: string;
  at: string;
}

export interface OrderWorkflow {
  stage: OrderStage;
  approvals: Partial<Record<OrderStepKey, OrderApproval>>;
}

/** A step the right role performs to advance the order from one stage to the next. */
export const ORDER_STEPS = {
  doc_check: {
    requiredRole: "accounting" as WorkflowRoleKey,
    from: "payment_review" as OrderStage,
    to: "docs_checked" as OrderStage,
    label: "Mark documents checked",
  },
  payment_cleared: {
    requiredRole: "payment_approver" as WorkflowRoleKey,
    from: "docs_checked" as OrderStage,
    to: "released" as OrderStage,
    label: "Clear payment & release job orders",
  },
} as const;

export type OrderStepKey = keyof typeof ORDER_STEPS;

const STAGE_KEYS = new Set(ORDER_STAGES.map((s) => s.key));

/** Read the workflow state from a quotation's classification (defaults to start). */
export function readOrderWorkflow(classification: unknown): OrderWorkflow {
  const wf = (classification as Record<string, unknown> | null)?.workflow as
    | Record<string, unknown>
    | undefined;
  const stage = typeof wf?.stage === "string" && STAGE_KEYS.has(wf.stage as OrderStage)
    ? (wf.stage as OrderStage)
    : "payment_review";
  const approvals = (wf?.approvals && typeof wf.approvals === "object"
    ? (wf.approvals as OrderWorkflow["approvals"])
    : {}) as OrderWorkflow["approvals"];
  return { stage, approvals };
}

/** The next step to perform at a given stage, or null when Phase 1 is complete. */
export function nextOrderStep(
  stage: OrderStage,
): { key: OrderStepKey; requiredRole: WorkflowRoleKey; label: string } | null {
  for (const key of Object.keys(ORDER_STEPS) as OrderStepKey[]) {
    if (ORDER_STEPS[key].from === stage) {
      return { key, requiredRole: ORDER_STEPS[key].requiredRole, label: ORDER_STEPS[key].label };
    }
  }
  return null;
}

export function stageLabel(stage: OrderStage): string {
  return ORDER_STAGES.find((s) => s.key === stage)?.label ?? stage;
}
