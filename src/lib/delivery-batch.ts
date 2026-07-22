/**
 * Delivery batches — the per-batch fulfillment pipeline.
 *
 * A batch is a set of finished items (any items / partial quantities) the team
 * decides to deliver together. Each batch runs the 13-step process the plant
 * follows once a job order is finished: inform client → bill → collect & clear
 * payment → quality testing → Plant Manager QC → transfer to office → Sales
 * re-check → delivery documents → deliver (proof) → approve proof → surrender
 * signed documents. Several batches can run in parallel, so one department's
 * items can be delivered while others are still in production.
 *
 * Stored as JSON on the order's workflow (no migration).
 */
import type { WorkflowRoleKey } from "@/lib/workflow-roles";

export interface BatchLine {
  description: string;
  qty: number;
}

export interface BatchStamp {
  byName: string;
  at: string; // ISO
  note?: string;
}

/**
 * When the client pays for the batch:
 *  - "prepay" — Payment first before delivery (bill → pay → check → approve → …).
 *  - "cod"    — Cash on Delivery (deliver & collect at the door → check → approve).
 */
export type PaymentMode = "prepay" | "cod";

export interface DeliveryBatch {
  id: string;
  createdAt: string;
  createdByName: string;
  drNumber: string;
  paymentMode: PaymentMode;
  lines: BatchLine[];
  // Per-step sign-offs, keyed by step key.
  steps: Record<string, BatchStamp>;
  // Payment collected at the payment step (a linked "progress" sale payment).
  paymentAmount?: number;
  paymentId?: string;
  cancelled?: boolean;
  cancelledAt?: string;
}

/**
 * The batch role that acts on a step. "sales" is special — there is no Sales
 * workflow role, so it resolves to the order's Sales preparer (or an admin).
 */
export type BatchRole = WorkflowRoleKey | "sales";

export interface BatchStepDef {
  key: string;
  label: string; // the action button
  done: string; // the past-tense trail label
  role: BatchRole;
  /** The payment step also records a payment amount (prepay: "paid"; COD: "delivered"). */
  collectsPayment?: boolean;
}

// Every step definition, keyed. Ordered into a pipeline per payment mode below.
const S: Record<string, BatchStepDef> = {
  client_notified: { key: "client_notified", label: "Inform client of the order", done: "Client informed", role: "sales" },
  billed: { key: "billed", label: "Issue billing statement", done: "Billing statement issued", role: "accounting" },
  paid: { key: "paid", label: "Record client payment", done: "Payment recorded", role: "accounting", collectsPayment: true },
  payment_checked: { key: "payment_checked", label: "Check payment", done: "Payment checked", role: "accounting" },
  payment_approved: { key: "payment_approved", label: "Approve payment", done: "Payment approved", role: "payment_approver" },
  qc_tested: { key: "qc_tested", label: "Quality testing", done: "Quality tested", role: "technical_head" },
  plant_checked: { key: "plant_checked", label: "Plant Manager quality & quantity check", done: "Plant QC & quantity passed", role: "plant_manager" },
  transferred: { key: "transferred", label: "Transfer to office", done: "Transferred to office", role: "logistics" },
  sales_checked: { key: "sales_checked", label: "Sales 2nd quality & quantity check", done: "Sales re-checked", role: "sales" },
  docs_ready: { key: "docs_ready", label: "Prepare DR / SI / OR & approve delivery", done: "Delivery documents ready", role: "accounting" },
  deliver_prepay: { key: "delivered", label: "Deliver & upload proof of delivery", done: "Delivered", role: "logistics" },
  deliver_cod: { key: "delivered", label: "Deliver & collect payment (COD) + proof", done: "Delivered & payment collected", role: "logistics", collectsPayment: true },
  proof_approved: { key: "proof_approved", label: "Approve proof of delivery", done: "Proof of delivery approved", role: "sales" },
  docs_surrendered: { key: "docs_surrendered", label: "Surrender signed documents to Accounting", done: "Documents surrendered", role: "logistics" },
};

/** The step sequence for a batch, by payment mode. */
export function batchSteps(mode: PaymentMode): BatchStepDef[] {
  if (mode === "cod") {
    // Cash on Delivery — quality first, then deliver & collect, then clear payment.
    return [
      S.client_notified, S.billed,
      S.qc_tested, S.plant_checked, S.transferred, S.sales_checked, S.docs_ready,
      S.deliver_cod, S.payment_checked, S.payment_approved, S.proof_approved, S.docs_surrendered,
    ];
  }
  // Payment first before delivery.
  return [
    S.client_notified, S.billed,
    S.paid, S.payment_checked, S.payment_approved,
    S.qc_tested, S.plant_checked, S.transferred, S.sales_checked, S.docs_ready,
    S.deliver_prepay, S.proof_approved, S.docs_surrendered,
  ];
}

export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  prepay: "Payment before delivery",
  cod: "Cash on delivery",
};

export const BATCH_DELIVERED_STEP = "delivered";
export const BATCH_FINAL_STEP = "docs_surrendered";
const ALL_STEP_KEYS = new Set(Object.values(S).map((s) => s.key));

export function batchStepDef(mode: PaymentMode, key: string): BatchStepDef | undefined {
  return batchSteps(mode).find((s) => s.key === key);
}

/** Index of the last completed step (−1 if none), and the next step to do (or null). */
export function batchProgress(b: DeliveryBatch): { lastDone: number; next: BatchStepDef | null } {
  const steps = batchSteps(b.paymentMode);
  let lastDone = -1;
  for (let i = 0; i < steps.length; i++) {
    if (b.steps[steps[i].key]) lastDone = i;
    else break;
  }
  const next = lastDone + 1 < steps.length ? steps[lastDone + 1] : null;
  return { lastDone, next };
}

export function isBatchDelivered(b: DeliveryBatch): boolean {
  return !b.cancelled && !!b.steps[BATCH_DELIVERED_STEP];
}
export function isBatchComplete(b: DeliveryBatch): boolean {
  return !b.cancelled && !!b.steps[BATCH_FINAL_STEP];
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const str = (v: unknown): string => (v == null ? "" : String(v)).trim();

function coerceLine(value: unknown): BatchLine | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const description = str(o.description);
  const qty = num(o.qty);
  return description && qty > 0 ? { description, qty } : null;
}

function coerceStamp(value: unknown): BatchStamp | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (!str(o.byName) && !str(o.at)) return null;
  return { byName: str(o.byName), at: str(o.at), ...(str(o.note) ? { note: str(o.note) } : {}) };
}

export function coerceDeliveryBatch(value: unknown): DeliveryBatch | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const lines = Array.isArray(o.lines) ? (o.lines as unknown[]).map(coerceLine).filter((l): l is BatchLine => !!l) : [];
  if (!str(o.id) || lines.length === 0) return null;
  const steps: Record<string, BatchStamp> = {};
  if (o.steps && typeof o.steps === "object") {
    for (const [k, v] of Object.entries(o.steps as Record<string, unknown>)) {
      if (ALL_STEP_KEYS.has(k)) {
        const s = coerceStamp(v);
        if (s) steps[k] = s;
      }
    }
  }
  const paymentAmount = num(o.paymentAmount);
  return {
    id: str(o.id),
    createdAt: str(o.createdAt),
    createdByName: str(o.createdByName),
    drNumber: str(o.drNumber),
    paymentMode: o.paymentMode === "cod" ? "cod" : "prepay",
    lines,
    steps,
    ...(paymentAmount > 0 ? { paymentAmount, paymentId: str(o.paymentId) || undefined } : {}),
    ...(o.cancelled ? { cancelled: true, cancelledAt: str(o.cancelledAt) } : {}),
  };
}

export function coerceDeliveryBatches(value: unknown): DeliveryBatch[] {
  return Array.isArray(value) ? (value as unknown[]).map(coerceDeliveryBatch).filter((b): b is DeliveryBatch => !!b) : [];
}

/** Quantity committed to a (non-cancelled) batch, per item description. */
export function batchedByDescription(batches: DeliveryBatch[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of batches) {
    if (b.cancelled) continue;
    for (const l of b.lines) {
      const key = l.description.trim().toLowerCase();
      m.set(key, (m.get(key) ?? 0) + l.qty);
    }
  }
  return m;
}

/** Quantity actually delivered (batch reached the "delivered" step), per item. */
export function deliveredByDescription(batches: DeliveryBatch[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of batches) {
    if (!isBatchDelivered(b)) continue;
    for (const l of b.lines) {
      const key = l.description.trim().toLowerCase();
      m.set(key, (m.get(key) ?? 0) + l.qty);
    }
  }
  return m;
}
