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

export interface DeliveryBatch {
  id: string;
  createdAt: string;
  createdByName: string;
  drNumber: string;
  lines: BatchLine[];
  // Per-step sign-offs, keyed by BATCH_STEPS[].key.
  steps: Record<string, BatchStamp>;
  // Payment collected at the "paid" step (a linked "progress" sale payment).
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
  /** The "paid" step also records a payment amount. */
  collectsPayment?: boolean;
}

/** The 13-step pipeline, in order. */
export const BATCH_STEPS: BatchStepDef[] = [
  { key: "client_notified", label: "Inform client of the order", done: "Client informed", role: "sales" },
  { key: "billed", label: "Issue billing statement", done: "Billing statement issued", role: "accounting" },
  { key: "paid", label: "Record client payment", done: "Payment recorded", role: "accounting", collectsPayment: true },
  { key: "payment_checked", label: "Check payment", done: "Payment checked", role: "accounting" },
  { key: "payment_approved", label: "Approve payment", done: "Payment approved", role: "payment_approver" },
  { key: "qc_tested", label: "Quality testing", done: "Quality tested", role: "technical_head" },
  { key: "plant_checked", label: "Plant Manager quality & quantity check", done: "Plant QC & quantity passed", role: "plant_manager" },
  { key: "transferred", label: "Transfer to office", done: "Transferred to office", role: "logistics" },
  { key: "sales_checked", label: "Sales 2nd quality & quantity check", done: "Sales re-checked", role: "sales" },
  { key: "docs_ready", label: "Prepare DR / SI / OR & approve delivery", done: "Delivery documents ready", role: "accounting" },
  { key: "delivered", label: "Deliver & upload proof of delivery", done: "Delivered", role: "logistics" },
  { key: "proof_approved", label: "Approve proof of delivery", done: "Proof of delivery approved", role: "sales" },
  { key: "docs_surrendered", label: "Surrender signed documents to Accounting", done: "Documents surrendered", role: "logistics" },
];

export const BATCH_DELIVERED_STEP = "delivered";
export const BATCH_FINAL_STEP = "docs_surrendered";
const STEP_KEYS = BATCH_STEPS.map((s) => s.key);

export function batchStepDef(key: string): BatchStepDef | undefined {
  return BATCH_STEPS.find((s) => s.key === key);
}

/** Index of the last completed step (−1 if none), and the next step to do (or null). */
export function batchProgress(b: DeliveryBatch): { lastDone: number; next: BatchStepDef | null } {
  let lastDone = -1;
  for (let i = 0; i < BATCH_STEPS.length; i++) {
    if (b.steps[BATCH_STEPS[i].key]) lastDone = i;
    else break;
  }
  const next = lastDone + 1 < BATCH_STEPS.length ? BATCH_STEPS[lastDone + 1] : null;
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
      if (STEP_KEYS.includes(k)) {
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
