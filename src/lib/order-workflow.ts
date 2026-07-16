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
import { coerceFansJobOrder, type FansJobOrder } from "@/lib/job-order";

export type OrderStage =
  | "payment_review"
  | "docs_checked"
  | "released"
  | "in_production"
  | "jo_received"
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
  { key: "released", label: "For JO creation", phase: "Phase 1 done" },
  { key: "in_production", label: "JO released", phase: "Phase 4" },
  { key: "jo_received", label: "JO Received", phase: "Phase 4" },
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
export type MaterialRequestStatus = "requested" | "issued" | "purchasing" | "partial";

/** Per-line outcome once the warehouse triages a Material Request Form. */
export type MRFLineDisposition = "issue" | "purchase";

/** One line of the Material Request Form (mirrors the paper form's columns). */
export interface MRFItem {
  description: string; // Articles / Description
  qty: string;
  unit: string;
  remark?: string;
  /** Set by the warehouse when handling: issued from stock or sent to purchasing. */
  disposition?: MRFLineDisposition;
}

export interface MaterialRequest {
  id: string;
  formNo: string; // running form number, e.g. "0173"
  dept: ProductionDeptKey;
  items: MRFItem[];
  note?: string;
  status: MaterialRequestStatus;
  raisedAt: string;
  raisedByName: string;
  handledAt?: string;
  handledByName?: string;
}

/** Coerce raw JSON items to MRFItem[] (accepts legacy string[] entries). */
export function coerceMrfItems(raw: unknown): MRFItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x): MRFItem => {
      if (typeof x === "string") return { description: x, qty: "", unit: "", remark: undefined };
      const o = (x ?? {}) as Record<string, unknown>;
      const disp = o.disposition === "issue" || o.disposition === "purchase" ? o.disposition : undefined;
      return {
        description: String(o.description ?? ""),
        qty: String(o.qty ?? ""),
        unit: String(o.unit ?? ""),
        remark: o.remark ? String(o.remark) : undefined,
        disposition: disp,
      };
    })
    .filter((i) => i.description.trim() !== "");
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
  // Detailed Fans & Blowers job order documents made by the Engineer. An order
  // can carry several; they share a base number claimed once (joBaseNo/joBaseYear)
  // and get an a/b/c suffix when there is more than one.
  fansJobOrders: FansJobOrder[];
  joBaseNo?: number;
  joBaseYear?: number;
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
    label: "Clear payment & create JO",
  },
} as const;

export type OrderStepKey = keyof typeof ORDER_STEPS;

/**
 * Every approval key that can be recorded on an order → a human label and the
 * stage transition it represents (from → to). Used by the admin rollback to undo
 * a sign-off and return the order to the stage just before it.
 */
export const APPROVAL_STEPS: Record<string, { label: string; from: OrderStage; to: OrderStage }> = {
  doc_check: { label: "Documents checked", from: "payment_review", to: "docs_checked" },
  payment_cleared: { label: "Payment cleared & JO created", from: "docs_checked", to: "released" },
  jo_received: { label: "Job orders received", from: "in_production", to: "jo_received" },
  client_notified: { label: "Client notified (order ready)", from: "production_finished", to: "final_pay_review" },
  final_pay_checked: { label: "Final payment checked", from: "final_pay_review", to: "final_pay_checked" },
  final_pay_confirmed: { label: "Final payment confirmed", from: "final_pay_checked", to: "final_pay_cleared" },
  delivery_approved: { label: "Delivery documents ready", from: "final_pay_cleared", to: "delivery_docs_ready" },
  delivered: { label: "Delivered", from: "delivery_docs_ready", to: "delivered" },
  documents_filed: { label: "Documents filed (order closed)", from: "delivered", to: "closed" },
};

/** Position of a stage in the linear workflow (−1 if unknown). */
export function stageIndex(stage: OrderStage): number {
  return ORDER_STAGES.findIndex((s) => s.key === stage);
}

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
    ? (wf.materialRequests as unknown[])
        .filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && DEPT_KEYS.has((m as MaterialRequest).dept))
        .map((m) => ({
          id: String(m.id ?? ""),
          formNo: String(m.formNo ?? ""),
          dept: m.dept as ProductionDeptKey,
          items: coerceMrfItems(m.items),
          note: m.note ? String(m.note) : undefined,
          status: (m.status as MaterialRequestStatus) ?? "requested",
          raisedAt: String(m.raisedAt ?? ""),
          raisedByName: String(m.raisedByName ?? ""),
          handledAt: m.handledAt ? String(m.handledAt) : undefined,
          handledByName: m.handledByName ? String(m.handledByName) : undefined,
        }))
    : [];

  const fansJobOrders: FansJobOrder[] = Array.isArray(wf?.fansJobOrders)
    ? (wf.fansJobOrders as unknown[]).map(coerceFansJobOrder).filter((x): x is FansJobOrder => !!x)
    : [];
  const joBaseNo = typeof wf?.joBaseNo === "number" ? (wf.joBaseNo as number) : undefined;
  const joBaseYear = typeof wf?.joBaseYear === "number" ? (wf.joBaseYear as number) : undefined;

  return { stage, approvals, jobOrders, materialRequests, documents, fansJobOrders, joBaseNo, joBaseYear };
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

export function stagePhase(stage: OrderStage): string {
  return ORDER_STAGES.find((s) => s.key === stage)?.phase ?? "";
}

/**
 * Who must act next to move the order forward, given the current stage. Used to
 * show every viewer "waiting for: <role(s)>" and the live workflow status.
 * `sales` marks the step the salesperson owns (not a workflow role). Returns null
 * when the order is closed.
 */
export interface PendingStep {
  action: string;
  roles: WorkflowRoleKey[];
  sales?: boolean;
}

export function pendingStep(wf: OrderWorkflow): PendingStep | null {
  switch (wf.stage) {
    case "payment_review":
      return { action: "Check order documents", roles: ["accounting"] };
    case "docs_checked":
      return { action: "Clear payment & create JO", roles: ["payment_approver"] };
    case "released":
      return { action: "Issue job orders", roles: ["technical_head"] };
    case "in_production":
      return { action: "Receive job order", roles: ["plant_manager"] };
    case "jo_received": {
      const roles = PRODUCTION_DEPTS.filter((d) => {
        const jo = wf.jobOrders[d.key];
        return jo && jo.status !== "finished";
      }).map((d) => d.role as WorkflowRoleKey);
      return { action: "Complete production", roles };
    }
    case "production_finished":
      return { action: "Notify client the order is ready", roles: [], sales: true };
    case "final_pay_review":
      return { action: "Check final payment", roles: ["accounting"] };
    case "final_pay_checked":
      return { action: "Confirm final payment", roles: ["payment_approver"] };
    case "final_pay_cleared":
      return { action: "Prepare delivery documents", roles: ["accounting"] };
    case "delivery_docs_ready":
      return { action: "Deliver the order", roles: ["logistics"] };
    case "delivered":
      return { action: "File documents & close the order", roles: ["accounting"] };
    case "closed":
    default:
      return null;
  }
}
