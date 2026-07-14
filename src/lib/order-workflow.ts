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

export type OrderStage =
  | "payment_review"
  | "docs_checked"
  | "released"
  | "in_production"
  | "production_finished"
  | "final_pay_review"
  | "final_pay_checked"
  | "final_pay_cleared"
  | "delivery_docs_ready"
  | "delivered"
  | "closed";

export const ORDER_STAGES: { key: OrderStage; label: string; phase: string }[] = [
  { key: "payment_review", label: "Payment review", phase: "Phase 1" },
  { key: "docs_checked", label: "Docs checked", phase: "Phase 1" },
  { key: "released", label: "Job orders released", phase: "Phase 1 done" },
  { key: "in_production", label: "In production", phase: "Phase 4" },
  { key: "production_finished", label: "Production finished", phase: "Phase 4 done" },
  { key: "final_pay_review", label: "Awaiting final payment", phase: "Phase 5" },
  { key: "final_pay_checked", label: "Final payment checked", phase: "Phase 5" },
  { key: "final_pay_cleared", label: "Final payment confirmed", phase: "Phase 5 done" },
  { key: "delivery_docs_ready", label: "Delivery docs ready", phase: "Phase 6" },
  { key: "delivered", label: "Delivered", phase: "Phase 6" },
  { key: "closed", label: "Closed", phase: "Phase 6 done" },
];

/** The four production departments a job order can go to (relevant ones only). */
export const PRODUCTION_DEPTS = [
  { key: "fans", label: "Fans & Blower", role: "prod_head_fans" },
  { key: "duct", label: "Duct", role: "prod_head_duct" },
  { key: "accessories", label: "Accessories", role: "prod_head_accessories" },
  { key: "motor", label: "Motor Controller", role: "prod_head_motor" },
] as const;

export type ProductionDeptKey = (typeof PRODUCTION_DEPTS)[number]["key"];
export type JobOrderStatus = "issued" | "in_production" | "finished";

export interface JobOrder {
  status: JobOrderStatus;
  issuedAt: string;
  issuedByName: string;
  startedAt?: string;
  startedByName?: string;
  finishedAt?: string;
  finishedByName?: string;
}

export interface OrderApproval {
  by: string;
  byName: string;
  at: string;
}

/**
 * A Material Request Form raised by a production department against the order.
 * The warehouse either issues it (in stock) or escalates it to purchasing.
 */
export type MaterialRequestStatus = "requested" | "issued" | "purchasing";

export interface MaterialRequest {
  id: string;
  dept: ProductionDeptKey;
  items: string[]; // one material per line
  note?: string;
  status: MaterialRequestStatus;
  raisedAt: string;
  raisedByName: string;
  handledAt?: string;
  handledByName?: string;
}

/** Delivery-document reference numbers captured in Phase 6. */
export interface OrderDocuments {
  dr?: string; // Delivery Receipt
  si?: string; // Sales Invoice
  or?: string; // Official Receipt
  pod?: string; // Proof of Delivery
}

export interface OrderWorkflow {
  stage: OrderStage;
  // Keyed by step name (Phase 1 steps + Phase 5/6 fulfillment steps).
  approvals: Record<string, OrderApproval>;
  jobOrders: Partial<Record<ProductionDeptKey, JobOrder>>;
  materialRequests: MaterialRequest[];
  documents: OrderDocuments;
}

const DEPT_KEYS = new Set(PRODUCTION_DEPTS.map((d) => d.key));

/** The workflow role that heads a production department. */
export function deptRole(dept: ProductionDeptKey): string {
  return PRODUCTION_DEPTS.find((d) => d.key === dept)!.role;
}
export function deptLabel(dept: ProductionDeptKey): string {
  return PRODUCTION_DEPTS.find((d) => d.key === dept)?.label ?? dept;
}

/** True when every issued job order is finished (and at least one was issued). */
export function allJobOrdersFinished(wf: OrderWorkflow): boolean {
  const jobs = Object.values(wf.jobOrders).filter(Boolean) as JobOrder[];
  return jobs.length > 0 && jobs.every((j) => j.status === "finished");
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

  const documents = (wf?.documents && typeof wf.documents === "object"
    ? (wf.documents as OrderDocuments)
    : {}) as OrderDocuments;

  const jobOrders: OrderWorkflow["jobOrders"] = {};
  if (wf?.jobOrders && typeof wf.jobOrders === "object") {
    for (const [k, v] of Object.entries(wf.jobOrders as Record<string, unknown>)) {
      if (DEPT_KEYS.has(k as ProductionDeptKey) && v && typeof v === "object") {
        jobOrders[k as ProductionDeptKey] = v as JobOrder;
      }
    }
  }

  const materialRequests: MaterialRequest[] = Array.isArray(wf?.materialRequests)
    ? (wf.materialRequests as unknown[]).filter(
        (m): m is MaterialRequest =>
          !!m && typeof m === "object" && DEPT_KEYS.has((m as MaterialRequest).dept),
      )
    : [];

  return { stage, approvals, jobOrders, materialRequests, documents };
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
