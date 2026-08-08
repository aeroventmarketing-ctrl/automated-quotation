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
import type { SaleDoc } from "@/lib/sale";
import { coerceFansJobOrder, type FansJobOrder } from "@/lib/job-order";
import { coerceDuctJobOrder, type DuctJobOrder } from "@/lib/duct-job-order";
import { coerceAccessoriesJobOrder, type AccessoriesJobOrder } from "@/lib/accessories-job-order";
import { coerceMotorControllerJobOrder, type MotorControllerJobOrder } from "@/lib/motor-controller-job-order";
import { coerceMultiBatches, type MultiDeliveryBatch } from "@/lib/delivery-multibatch";

export type OrderStage =
  | "payment_review"
  | "docs_checked"
  | "released"
  | "in_production"
  | "jo_received"
  | "producing"
  | "production_finished"
  | "final_pay_review"
  | "final_pay_checked"
  | "final_pay_cleared"
  | "qa_tested"
  | "qa_plant_checked"
  | "qa_transferred"
  | "qa_sales_checked"
  | "delivery_docs_ready"
  | "delivered"
  | "delivery_confirmed"
  | "docs_surrendered"
  | "docs_received"
  | "closed";

// Phases match the order-page cards (gapless): 1 intake, 2 job orders &
// production, 3 materials, 4 purchasing (3 & 4 run concurrently during
// production — no dedicated linear stage), 5 finalize (final payment, quality,
// delivery, documents & commission).
export const ORDER_STAGES: { key: OrderStage; label: string; phase: string }[] = [
  { key: "payment_review", label: "Payment review", phase: "Phase 1" },
  { key: "docs_checked", label: "Docs checked", phase: "Phase 1" },
  { key: "released", label: "For JO creation", phase: "Phase 2" },
  { key: "in_production", label: "JO released", phase: "Phase 2" },
  { key: "jo_received", label: "JO Received", phase: "Phase 2" },
  { key: "producing", label: "In Production", phase: "Phase 2" },
  { key: "production_finished", label: "Production finished", phase: "Phase 2" },
  { key: "final_pay_review", label: "Awaiting final payment", phase: "Phase 5" },
  { key: "final_pay_checked", label: "Final payment checked", phase: "Phase 5" },
  { key: "final_pay_cleared", label: "Final payment confirmed", phase: "Phase 5" },
  { key: "qa_tested", label: "Quality tested", phase: "Phase 5" },
  { key: "qa_plant_checked", label: "Plant QC passed", phase: "Phase 5" },
  { key: "qa_transferred", label: "Transferred to office", phase: "Phase 5" },
  { key: "qa_sales_checked", label: "Sales re-checked", phase: "Phase 5" },
  { key: "delivery_docs_ready", label: "Delivery docs ready", phase: "Phase 5" },
  { key: "delivered", label: "Delivered", phase: "Phase 5" },
  { key: "delivery_confirmed", label: "Delivery confirmed", phase: "Phase 5" },
  { key: "docs_surrendered", label: "Docs surrendered", phase: "Phase 5" },
  { key: "docs_received", label: "Docs received", phase: "Phase 5" },
  { key: "closed", label: "Closed", phase: "Closed" },
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

/**
 * Departments that can raise a requisition (office supplies etc.). This is the
 * four production departments plus a non-production "Office" department (where
 * Sales sit) — Office has no job orders or production head; it just groups
 * office/admin requisitions that still walk the normal purchasing chain.
 */
export const OFFICE_DEPT_KEY = "office";
export const REQUISITION_DEPTS: { key: string; label: string }[] = [
  ...PRODUCTION_DEPTS.map((d) => ({ key: d.key, label: d.label })),
  { key: OFFICE_DEPT_KEY, label: "Office" },
];
export const REQUISITION_DEPT_KEYS = new Set(REQUISITION_DEPTS.map((d) => d.key));
/** Label for any requisition department (production or Office); falls back to the key. */
export function requisitionDeptLabel(key: string | null | undefined): string {
  return REQUISITION_DEPTS.find((d) => d.key === key)?.label ?? key ?? "—";
}

/**
 * The department a requestor belongs to: the production department they head, or
 * else "Office" (Sales, admin, accounting, purchaser, warehouse, … all sit in
 * Office). `hasRole` checks a workflow role for the user. Used to fix the
 * department on cash requests / requisitions so it can't be chosen by hand.
 */
export function requestorDeptKey(hasRole: (role: string) => boolean): string {
  for (const d of PRODUCTION_DEPTS) if (hasRole(d.role)) return d.key;
  return OFFICE_DEPT_KEY;
}

/**
 * A proofing picture attached to a department's job order before it can be
 * marked finished — extends a stored SaleDoc with who uploaded it.
 */
export interface JobOrderProof extends SaleDoc {
  byName?: string;
}

export interface JobOrder {
  status: JobOrderStatus;
  issuedAt: string;
  issuedByName: string;
  startedAt?: string;
  startedByName?: string;
  finishedAt?: string;
  finishedByName?: string;
  dueAt?: string; // target completion date (YYYY-MM-DD)
  proofs?: JobOrderProof[]; // proofing pictures required before "Mark finished"
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
export type MaterialRequestStatus = "requested" | "issued" | "purchasing" | "partial" | "completed" | "cancelled";

/** Per-line outcome once the warehouse triages a Material Request Form. */
export type MRFLineDisposition = "issue" | "purchase" | "reserve";

/** One line of the Material Request Form (mirrors the paper form's columns). */
export interface MRFItem {
  description: string; // Articles / Description
  qty: string;
  unit: string;
  remark?: string;
  /** Set by the warehouse when handling: issued from stock or sent to purchasing. */
  disposition?: MRFLineDisposition;
  /** Quantity actually issued/reserved from stock (may be less than requested). */
  issuedQty?: string;
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
  /** Warehouse pressed "…Request Received" (acknowledged before releasing). */
  receivedAt?: string;
  receivedByName?: string;
  /** Warehouse informed the requesting department the materials are available. */
  informedAt?: string;
  informedByName?: string;
  /** Purchased materials released to the requesting department (after receiving). */
  releasedAt?: string;
  releasedByName?: string;
  /** The requesting department confirmed it received the released materials. */
  confirmedAt?: string;
  confirmedByName?: string;
  /** Follow-ups raised by the requesting department (most recent last). */
  followUps?: { at: string; byName: string }[];
}

/** Coerce raw JSON items to MRFItem[] (accepts legacy string[] entries). */
export function coerceMrfItems(raw: unknown): MRFItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x): MRFItem => {
      if (typeof x === "string") return { description: x, qty: "", unit: "", remark: undefined };
      const o = (x ?? {}) as Record<string, unknown>;
      const disp =
        o.disposition === "issue" || o.disposition === "purchase" || o.disposition === "reserve" ? o.disposition : undefined;
      return {
        description: String(o.description ?? ""),
        qty: String(o.qty ?? ""),
        unit: String(o.unit ?? ""),
        remark: o.remark ? String(o.remark) : undefined,
        disposition: disp,
        issuedQty: o.issuedQty != null && o.issuedQty !== "" ? String(o.issuedQty) : undefined,
      };
    })
    .filter((i) => i.description.trim() !== "");
}

/**
 * A note of a conversation sales had with a production head (or anyone) about
 * the order — captured on the Job orders & production card.
 */
export interface OrderConversation {
  id: string;
  at: string; // ISO — when the conversation happened
  withName: string; // person sales talked to (e.g. the production head)
  message: string; // the conversation / message
  loggedByName: string; // who logged it
  loggedAt: string; // ISO — when logged
}

/** A stored document reference (Supabase Storage path + original name). */
export interface WorkflowDoc {
  path: string;
  name: string;
  uploadedAt?: string;
}

/**
 * Sales-commission fulfillment sign-offs after the order closes:
 *   1. Approver approves the amount.
 *   2. Accounting uploads the commission voucher.
 *   3. Approver approves the voucher.
 *   4. Approver releases the budget.
 *   5. Accounting marks the commission received (DB Commission row marked paid).
 *   6. Accounting files the signed voucher (signed by the sales executive).
 * Rides in the order workflow JSON.
 */
export interface OrderCommissionFlow {
  approvedByName?: string;
  approvedAt?: string;
  voucherByName?: string;
  voucherAt?: string;
  voucherDoc?: WorkflowDoc | null;
  voucherApprovedByName?: string;
  voucherApprovedAt?: string;
  budgetReleasedByName?: string;
  budgetReleasedAt?: string;
  receivedByName?: string;
  receivedAt?: string;
  signedVoucherDoc?: WorkflowDoc | null;
  filedByName?: string;
  filedAt?: string;
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
  // Detailed Duct job orders made by the Engineer / Duct department. An order
  // can carry several; they share a base number claimed once (ductJoBaseNo/
  // ductJoBaseYear) in their own DUCT-JO series and get an a/b/c suffix when
  // there is more than one.
  ductJobOrders: DuctJobOrder[];
  ductJoBaseNo?: number;
  ductJoBaseYear?: number;
  // Detailed Accessories job orders. An order can carry several; they share a
  // base number claimed once (accJoBaseNo/accJoBaseYear) in their own ACCE-JO
  // series and get an a/b/c suffix when there is more than one.
  accessoriesJobOrders: AccessoriesJobOrder[];
  accJoBaseNo?: number;
  accJoBaseYear?: number;
  // Detailed Motor Controller job orders. An order can carry several; they share
  // a base number claimed once (mcJoBaseNo/mcJoBaseYear) in their own MC-JO
  // series and get an a/b/c suffix when there is more than one.
  motorJobOrders: MotorControllerJobOrder[];
  mcJoBaseNo?: number;
  mcJoBaseYear?: number;
  // Sales' log of conversations with production heads about the order.
  conversations: OrderConversation[];
  // Post-close sales-commission sign-offs (approve → voucher → received).
  commission?: OrderCommissionFlow;
  // Multiple-batch delivery (a separate, opt-in mode for large orders). When
  // deliveryMode is "multi" the order is delivered in batches instead of the
  // single-batch Phase 5 flow. Both are never active at once.
  deliveryMode?: "multi";
  // When true, the "Deliver in multiple batches?" option is offered on the order
  // (once production starts). Turned on by an Engineer / Payment Approver / admin
  // via a toggle; the single→multi switch itself is still a deliberate click.
  batchDeliveryEnabled?: boolean;
  deliveryBatches: MultiDeliveryBatch[];
  // How the finished goods reach the client — the fulfilment/handover mode.
  //  - "delivery"      Logistics delivers to the client (default).
  //  - "office_pickup" client collects at the office (from-stock orders).
  //  - "plant_pickup"  client collects at the plant (goods at the plant).
  // This is the source of truth; `officePickup` below is a derived convenience.
  fulfillmentMode: FulfillmentMode;
  // Derived: true when fulfillmentMode === "office_pickup". Kept so existing
  // office-pickup call sites read unchanged.
  officePickup?: boolean;
}

export type FulfillmentMode = "delivery" | "office_pickup" | "plant_pickup";
const FULFILMENT_MODES: readonly FulfillmentMode[] = ["delivery", "office_pickup", "plant_pickup"];

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
    label: "Documents Checked",
  },
  payment_cleared: {
    requiredRole: "payment_approver" as WorkflowRoleKey,
    from: "docs_checked" as OrderStage,
    to: "released" as OrderStage,
    label: "Payment Cleared",
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
  qa_tested: { label: "Quality tested", from: "final_pay_cleared", to: "qa_tested" },
  qa_plant_checked: { label: "Plant QC & quantity passed", from: "qa_tested", to: "qa_plant_checked" },
  qa_transferred: { label: "Transferred to office", from: "qa_plant_checked", to: "qa_transferred" },
  qa_sales_checked: { label: "Sales 2nd QC & quantity passed", from: "qa_transferred", to: "qa_sales_checked" },
  delivery_approved: { label: "Delivery documents ready", from: "qa_sales_checked", to: "delivery_docs_ready" },
  delivered: { label: "Delivered", from: "delivery_docs_ready", to: "delivered" },
  delivery_confirmed: { label: "Delivery confirmed (successful delivery)", from: "delivered", to: "delivery_confirmed" },
  docs_surrendered: { label: "Signed documents surrendered", from: "delivery_confirmed", to: "docs_surrendered" },
  docs_received: { label: "Documents received by accounting", from: "docs_surrendered", to: "docs_received" },
  documents_filed: { label: "Documents filed (order closed)", from: "docs_received", to: "closed" },
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
  const storedStage = typeof wf?.stage === "string" && STAGE_KEYS.has(wf.stage as OrderStage)
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
        const raw = v as JobOrder;
        const proofs: JobOrderProof[] = Array.isArray(raw.proofs)
          ? (raw.proofs as unknown[])
              .filter((p): p is Record<string, unknown> => !!p && typeof p === "object" && typeof (p as Record<string, unknown>).path === "string")
              .map((p) => ({
                path: String(p.path),
                name: String(p.name ?? "file"),
                uploadedAt: String(p.uploadedAt ?? ""),
                byName: p.byName ? String(p.byName) : undefined,
              }))
          : [];
        jobOrders[k as ProductionDeptKey] = proofs.length ? { ...raw, proofs } : { ...raw, proofs: undefined };
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
          receivedAt: m.receivedAt ? String(m.receivedAt) : undefined,
          receivedByName: m.receivedByName ? String(m.receivedByName) : undefined,
          informedAt: m.informedAt ? String(m.informedAt) : undefined,
          informedByName: m.informedByName ? String(m.informedByName) : undefined,
          releasedAt: m.releasedAt ? String(m.releasedAt) : undefined,
          releasedByName: m.releasedByName ? String(m.releasedByName) : undefined,
          confirmedAt: m.confirmedAt ? String(m.confirmedAt) : undefined,
          confirmedByName: m.confirmedByName ? String(m.confirmedByName) : undefined,
          followUps: Array.isArray(m.followUps)
            ? (m.followUps as unknown[])
                .map((f) => (f && typeof f === "object" ? { at: String((f as Record<string, unknown>).at ?? ""), byName: String((f as Record<string, unknown>).byName ?? "") } : null))
                .filter((f): f is { at: string; byName: string } => !!f && !!f.at)
            : undefined,
        }))
    : [];

  const fansJobOrders: FansJobOrder[] = Array.isArray(wf?.fansJobOrders)
    ? (wf.fansJobOrders as unknown[]).map(coerceFansJobOrder).filter((x): x is FansJobOrder => !!x)
    : [];
  const joBaseNo = typeof wf?.joBaseNo === "number" ? (wf.joBaseNo as number) : undefined;
  const joBaseYear = typeof wf?.joBaseYear === "number" ? (wf.joBaseYear as number) : undefined;

  const ductJobOrders: DuctJobOrder[] = Array.isArray(wf?.ductJobOrders)
    ? (wf.ductJobOrders as unknown[]).map(coerceDuctJobOrder).filter((x): x is DuctJobOrder => !!x)
    : [];
  const ductJoBaseNo = typeof wf?.ductJoBaseNo === "number" ? (wf.ductJoBaseNo as number) : undefined;
  const ductJoBaseYear = typeof wf?.ductJoBaseYear === "number" ? (wf.ductJoBaseYear as number) : undefined;

  const accessoriesJobOrders: AccessoriesJobOrder[] = Array.isArray(wf?.accessoriesJobOrders)
    ? (wf.accessoriesJobOrders as unknown[]).map(coerceAccessoriesJobOrder).filter((x): x is AccessoriesJobOrder => !!x)
    : [];
  const accJoBaseNo = typeof wf?.accJoBaseNo === "number" ? (wf.accJoBaseNo as number) : undefined;
  const accJoBaseYear = typeof wf?.accJoBaseYear === "number" ? (wf.accJoBaseYear as number) : undefined;

  const motorJobOrders: MotorControllerJobOrder[] = Array.isArray(wf?.motorJobOrders)
    ? (wf.motorJobOrders as unknown[]).map(coerceMotorControllerJobOrder).filter((x): x is MotorControllerJobOrder => !!x)
    : [];
  const mcJoBaseNo = typeof wf?.mcJoBaseNo === "number" ? (wf.mcJoBaseNo as number) : undefined;
  const mcJoBaseYear = typeof wf?.mcJoBaseYear === "number" ? (wf.mcJoBaseYear as number) : undefined;

  const conversations: OrderConversation[] = Array.isArray(wf?.conversations)
    ? (wf.conversations as unknown[])
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
        .map((c) => ({
          id: String(c.id ?? ""),
          at: String(c.at ?? ""),
          withName: String(c.withName ?? ""),
          message: String(c.message ?? ""),
          loggedByName: String(c.loggedByName ?? ""),
          loggedAt: String(c.loggedAt ?? ""),
        }))
        .filter((c) => c.message.trim() !== "")
    : [];

  const cm = wf?.commission && typeof wf.commission === "object" ? (wf.commission as Record<string, unknown>) : undefined;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const doc = (v: unknown): WorkflowDoc | null => {
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    return typeof o.path === "string" && o.path
      ? { path: o.path, name: typeof o.name === "string" ? o.name : o.path.split("/").pop() ?? "file", uploadedAt: str(o.uploadedAt) }
      : null;
  };
  const commission: OrderCommissionFlow | undefined = cm
    ? {
        approvedByName: str(cm.approvedByName),
        approvedAt: str(cm.approvedAt),
        voucherByName: str(cm.voucherByName),
        voucherAt: str(cm.voucherAt),
        voucherDoc: doc(cm.voucherDoc),
        voucherApprovedByName: str(cm.voucherApprovedByName),
        voucherApprovedAt: str(cm.voucherApprovedAt),
        budgetReleasedByName: str(cm.budgetReleasedByName),
        budgetReleasedAt: str(cm.budgetReleasedAt),
        receivedByName: str(cm.receivedByName),
        receivedAt: str(cm.receivedAt),
        signedVoucherDoc: doc(cm.signedVoucherDoc),
        filedByName: str(cm.filedByName),
        filedAt: str(cm.filedAt),
      }
    : undefined;

  // Normalize the JO-Received → In Production → Production finished window so the
  // order stage always reflects actual job-order progress. This self-heals orders
  // whose job orders were started before the "In Production" stage existed (their
  // stage was left at jo_received even though a job order is in production), and
  // promotes a "producing" order to "production_finished" once every job order is
  // finished, so Phase 5 opens without a manual nudge.
  let stage = storedStage;
  if (stage === "jo_received" || stage === "producing") {
    const jos = Object.values(jobOrders).filter(Boolean) as JobOrder[];
    if (jos.length > 0 && jos.every((j) => j.status === "finished")) stage = "production_finished";
    else if (jos.some((j) => j.status === "in_production" || j.status === "finished")) stage = "producing";
  }

  const deliveryMode = wf?.deliveryMode === "multi" ? "multi" as const : undefined;
  const batchDeliveryEnabled = wf?.batchDeliveryEnabled === true;
  const deliveryBatches = coerceMultiBatches(wf?.deliveryBatches);
  // Fulfilment mode: read the stored enum, else fall back to the legacy
  // `officePickup` boolean (so orders saved before the enum keep working).
  const rawMode = wf?.fulfillmentMode;
  const fulfillmentMode: FulfillmentMode = FULFILMENT_MODES.includes(rawMode as FulfillmentMode)
    ? (rawMode as FulfillmentMode)
    : wf?.officePickup === true
      ? "office_pickup"
      : "delivery";
  const officePickup = fulfillmentMode === "office_pickup";

  return { stage, approvals, jobOrders, materialRequests, documents, fansJobOrders, joBaseNo, joBaseYear, ductJobOrders, ductJoBaseNo, ductJoBaseYear, accessoriesJobOrders, accJoBaseNo, accJoBaseYear, motorJobOrders, mcJoBaseNo, mcJoBaseYear, conversations, commission, deliveryMode, batchDeliveryEnabled, deliveryBatches, fulfillmentMode, officePickup };
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
 * DOM id of the order-detail phase card for a stage — e.g. "phase-2" — so a
 * notification / alarm can deep-link straight to the card holding the pending
 * action. Empty when the stage has no numbered phase (e.g. "Closed").
 */
export function phaseAnchor(stage: OrderStage): string {
  const m = /Phase (\d+)/.exec(stagePhase(stage));
  return m ? `phase-${m[1]}` : "";
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
  // The Engineer base role (SALES/ENGINEER/ADMIN) also owns this step, in addition
  // to `roles` — e.g. approving a from-stock release (mirrors `sales`).
  engineer?: boolean;
}

/**
 * `stockOnly` marks a from-stock order (released from inventory, no job orders and
 * no purchase order). Such an order has no job-order content, so without this flag
 * it looks identical to a bought-in order and would be routed to the PO step. The
 * caller knows it from the quotation lines (`isStockOnlyOrder`); pass it so the
 * "released" stage routes to the stock-release path instead.
 *
 * `engineerApprovesStock` is vestigial (kept for signature stability): the from-stock
 * release role now depends on the fulfilment mode — delivery = Plant Manager releases
 * then Sales notifies; office pick up = Sales; plant pick up = Warehouse releases then
 * Plant Manager approves — not on duct-hardware/Engineer gating.
 */
export function pendingStep(
  wf: OrderWorkflow,
  stockOnly = false,
  engineerApprovesStock = false,
  officePickup = false,
  plantPickup = false,
): PendingStep | null {
  // A fully bought-in order has no job-order content — it skips production and its
  // Office-side roles (Logistics / Payment Approver / Sales / Engineer) handle the
  // Phase 5 quality steps instead of the production QC departments.
  const hasJoContent = [wf.fansJobOrders, wf.ductJobOrders, wf.accessoriesJobOrders, wf.motorJobOrders]
    .some((a) => (a?.length ?? 0) > 0);
  const boughtIn = !hasJoContent;
  // A from-stock order (F&B on-hand, e.g. angle corner) also has no job-order
  // content, but — unlike a bought-in order — its goods are at the plant, so its
  // Phase 5 quality check runs there (Warehouse tests, Plant Manager approves)
  // rather than by the Office-side actors a bought-in order uses.
  const boughtInOnly = boughtIn && !stockOnly;
  switch (wf.stage) {
    case "payment_review":
      return { action: "Check order documents", roles: ["accounting"] };
    case "docs_checked":
      return { action: "Payment Cleared", roles: ["payment_approver"] };
    case "released": {
      // From-stock order: released from Fans & Blowers on-hand stock. The release
      // choreography depends on the fulfilment mode (goods at the plant are far from
      // the office, so who releases differs). No job order and no purchase order.
      if (stockOnly) {
        // Office pick up: one step — Sales releases from stock and notifies the client.
        if (officePickup) {
          return { action: "Release from Stock & Notify Client", roles: [], sales: true };
        }
        const released = !!wf.approvals.stock_released;
        if (plantPickup) {
          // Plant pick up: the Warehouse releases from stock, then the Plant Manager approves.
          return released
            ? { action: "Quality & Quantity Approved", roles: ["plant_manager"] }
            : { action: "Release from Stock", roles: ["warehouse"] };
        }
        // Delivery: the Plant Manager releases from stock, then Sales notifies the client.
        return released
          ? { action: "Release from Stock & Notify Client", roles: [], sales: true }
          : { action: "Release from Stock", roles: ["plant_manager"] };
      }
      if (boughtIn) {
        return { action: "Prepare & process the Purchase Order", roles: ["purchaser", "technical_head"] };
      }
      return { action: "Issue job orders", roles: ["technical_head"] };
    }
    case "in_production":
      return { action: "Receive job order", roles: ["plant_manager"] };
    case "jo_received": {
      const roles = PRODUCTION_DEPTS.filter((d) => wf.jobOrders[d.key]?.status === "issued").map(
        (d) => d.role as WorkflowRoleKey,
      );
      return { action: "Start production", roles };
    }
    case "producing": {
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
      if (officePickup) return { action: "Quality testing", roles: ["quality_inspector_2"], sales: true };
      // From-stock (delivery OR plant pick up): the Warehouse (who holds the F&B
      // stock) runs the quality & quantity test.
      if (stockOnly) return { action: "Quality & quantity testing", roles: ["warehouse"] };
      // Plant pick up of a produced order: Technical Head / QI test.
      if (plantPickup) return { action: "Quality testing", roles: ["technical_head", "quality_inspector"] };
      return boughtInOnly
        ? { action: "Quality testing", roles: ["logistics", "payment_approver"], sales: true }
        : { action: "Quality testing", roles: ["technical_head", "quality_inspector"] };
    case "qa_tested":
      // Plant pick up: Plant Manager quality & quantity approval, then the
      // Warehouseman handles the delivery form (no transfer to office).
      if (plantPickup) return { action: "Quality & Quantity Approved", roles: ["plant_manager"] };
      // Office pickup skips plant-QC / transfer / Sales-2nd-QC and goes straight
      // to preparing the delivery documents.
      if (officePickup) return { action: "Prepare delivery documents", roles: ["accounting"] };
      // From-stock joins produced orders at the Plant Manager check; only a
      // bought-in order (never at the plant) is checked by the Office-side actors.
      return boughtInOnly
        ? { action: "QC & Quantity Checked", roles: ["logistics", "payment_approver"], sales: true }
        : { action: "Quality & Quantity Approved", roles: ["plant_manager"] };
    case "qa_plant_checked":
      if (plantPickup) return { action: "Make the delivery form", roles: ["warehouse"] };
      return { action: "Transfer items to office", roles: ["logistics"] };
    case "qa_transferred":
      if (plantPickup) return { action: "Approve delivery", roles: ["plant_manager"] };
      // A bought-in order has no earlier QC step, so this is its (only) quality &
      // quantity check — not a "2nd" check.
      return { action: boughtInOnly ? "Quality & quantity check" : "Sales 2nd QC & quantity check", roles: ["quality_inspector_2"], sales: true };
    case "qa_sales_checked":
      if (plantPickup) return { action: "Upload delivery form & proof of pick up", roles: ["warehouse"] };
      return { action: "Prepare delivery documents", roles: ["accounting"] };
    case "delivery_docs_ready":
      return officePickup
        ? { action: "Upload proof of pick up & approve", roles: [], sales: true }
        : { action: "Deliver the order", roles: ["logistics"] };
    case "delivered":
      return { action: plantPickup || officePickup ? "Approve POD - Successful Pick Up" : "Approve POD - Successful Delivery", roles: [], sales: true };
    case "delivery_confirmed":
      // Plant pick up skips the surrender step — straight to Accounting confirming receipt.
      if (plantPickup) return { action: "Confirm documents received", roles: ["accounting"] };
      return officePickup
        ? { action: "Surrender signed documents to accounting", roles: [], sales: true }
        : { action: "Surrender signed documents to accounting", roles: ["logistics"] };
    case "docs_surrendered":
      return { action: "Confirm documents received", roles: ["accounting"] };
    case "docs_received":
      return { action: "File documents & close the order", roles: ["accounting"] };
    case "closed":
    default:
      return null;
  }
}
