/**
 * Multiple-batch delivery.
 *
 * For large orders delivered in parts. The order enters "multiple deliveries"
 * mode at Phase 5; each batch is a set of items/quantities run through the SAME
 * sequence the single-batch delivery uses — reused verbatim, payment-first —
 * from "Client notified" through "Documents filed". Several batches run in
 * parallel. This is a separate module: it never touches the single-batch flow.
 *
 * Stored as JSON on the order's workflow (no migration).
 */
import type { WorkflowRoleKey } from "@/lib/workflow-roles";

export interface MBLine {
  description: string;
  qty: number;
}
export interface MBStamp {
  byName: string;
  at: string; // ISO
  note?: string;
}
export interface MultiDeliveryBatch {
  id: string;
  createdAt: string;
  createdByName: string;
  drNumber: string;
  lines: MBLine[];
  steps: Record<string, MBStamp>; // keyed by MULTIBATCH_STEPS[].key
  // Partial payment collected for this batch (a linked "progress" sale payment),
  // captured at the "Payment checked" step.
  paymentAmount?: number;
  paymentId?: string;
  cancelled?: boolean;
  cancelledAt?: string;
}

/** "sales" resolves to the order's Sales preparer (or admin) — there is no Sales role. */
export type MBRole = WorkflowRoleKey | "sales";

export interface MBStepDef {
  key: string;
  label: string;
  done: string;
  role: MBRole;
  collectsPayment?: boolean; // the "Payment checked" step records the partial payment
}

/**
 * The delivery sequence, reused from the single-batch flow verbatim (payment
 * first). Only the payment labels drop the word "Final" — each batch's payment is
 * partial. "Documents filed" closes this batch (a partial delivery), not the order.
 */
export const MULTIBATCH_STEPS: MBStepDef[] = [
  { key: "client_notified", label: "Notify client — batch ready", done: "Client notified (order ready)", role: "sales" },
  { key: "payment_checked", label: "Payment checked", done: "Payment checked", role: "accounting", collectsPayment: true },
  { key: "payment_confirmed", label: "Payment confirmed", done: "Payment confirmed", role: "payment_approver" },
  { key: "qa_tested", label: "Quality tested — pass", done: "Quality tested", role: "technical_head" },
  { key: "qa_plant_checked", label: "Quality & quantity approved", done: "Plant QC & quantity passed", role: "plant_manager" },
  { key: "qa_transferred", label: "Transferred to office", done: "Transferred to office", role: "logistics" },
  { key: "qa_sales_checked", label: "Quality & quantity re-checked", done: "Sales 2nd QC & quantity passed", role: "sales" },
  { key: "delivery_docs", label: "Save documents & approve delivery", done: "Delivery documents ready", role: "accounting" },
  { key: "delivered", label: "Mark delivered", done: "Delivered", role: "logistics" },
  { key: "delivery_confirmed", label: "Approve POD — successful delivery", done: "Delivery confirmed (successful delivery)", role: "sales" },
  { key: "docs_surrendered", label: "Documents surrendered to accounting", done: "Signed documents surrendered", role: "logistics" },
  { key: "docs_received", label: "Confirm documents received", done: "Documents received by accounting", role: "accounting" },
  { key: "docs_filed", label: "File documents — batch delivered", done: "Documents filed (partial delivery)", role: "accounting" },
];

export const MB_DELIVERED_STEP = "delivered";
export const MB_FINAL_STEP = "docs_filed";
const MB_STEP_KEYS = new Set(MULTIBATCH_STEPS.map((s) => s.key));

export function mbStepDef(key: string): MBStepDef | undefined {
  return MULTIBATCH_STEPS.find((s) => s.key === key);
}

/** Last completed step index (−1 if none) and the next step to do (or null). */
export function mbProgress(b: MultiDeliveryBatch): { lastDone: number; next: MBStepDef | null } {
  let lastDone = -1;
  for (let i = 0; i < MULTIBATCH_STEPS.length; i++) {
    if (b.steps[MULTIBATCH_STEPS[i].key]) lastDone = i;
    else break;
  }
  const next = lastDone + 1 < MULTIBATCH_STEPS.length ? MULTIBATCH_STEPS[lastDone + 1] : null;
  return { lastDone, next };
}

export function isMbDelivered(b: MultiDeliveryBatch): boolean {
  return !b.cancelled && !!b.steps[MB_DELIVERED_STEP];
}
export function isMbFiled(b: MultiDeliveryBatch): boolean {
  return !b.cancelled && !!b.steps[MB_FINAL_STEP];
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const str = (v: unknown): string => (v == null ? "" : String(v)).trim();

function coerceLine(value: unknown): MBLine | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const description = str(o.description);
  const qty = num(o.qty);
  return description && qty > 0 ? { description, qty } : null;
}
function coerceStamp(value: unknown): MBStamp | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (!str(o.byName) && !str(o.at)) return null;
  return { byName: str(o.byName), at: str(o.at), ...(str(o.note) ? { note: str(o.note) } : {}) };
}

export function coerceMultiBatch(value: unknown): MultiDeliveryBatch | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const lines = Array.isArray(o.lines) ? (o.lines as unknown[]).map(coerceLine).filter((l): l is MBLine => !!l) : [];
  if (!str(o.id) || lines.length === 0) return null;
  const steps: Record<string, MBStamp> = {};
  if (o.steps && typeof o.steps === "object") {
    for (const [k, v] of Object.entries(o.steps as Record<string, unknown>)) {
      if (MB_STEP_KEYS.has(k)) {
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

export function coerceMultiBatches(value: unknown): MultiDeliveryBatch[] {
  return Array.isArray(value) ? (value as unknown[]).map(coerceMultiBatch).filter((b): b is MultiDeliveryBatch => !!b) : [];
}

/** Quantity committed to a (non-cancelled) batch, per item description. */
export function mbBatchedByDescription(batches: MultiDeliveryBatch[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of batches) {
    if (b.cancelled) continue;
    for (const l of b.lines) {
      const k = l.description.trim().toLowerCase();
      m.set(k, (m.get(k) ?? 0) + l.qty);
    }
  }
  return m;
}

/** Quantity delivered (batch reached the "Delivered" step), per item description. */
export function mbDeliveredByDescription(batches: MultiDeliveryBatch[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of batches) {
    if (!isMbDelivered(b)) continue;
    for (const l of b.lines) {
      const k = l.description.trim().toLowerCase();
      m.set(k, (m.get(k) ?? 0) + l.qty);
    }
  }
  return m;
}
