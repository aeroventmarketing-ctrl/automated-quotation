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
import type { SaleDoc } from "@/lib/sale";

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
  // Proof-of-delivery attachments (signed DRs / photos). Logistics must attach at
  // least one before the "Mark delivered" step; admins can manage them anytime.
  pod?: SaleDoc[];
  // This batch's own closing documents (Sales Invoice / OR-CR-AF / Delivery
  // Receipt / BIR 2307), keyed by document type. Accounting attaches them at the
  // "delivery documents" step — each batch carries its own set.
  docs?: Record<string, SaleDoc[]>;
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
  /**
   * Extra roles allowed to perform this step, beyond `role`. Used for the
   * produced quality test, which the 1st Quality Inspector may run alongside the
   * Technical Head — matching the single-batch `canQaTest` gate.
   */
  altRoles?: MBRole[];
  collectsPayment?: boolean; // the "Payment checked" step records the partial payment
}

/** Every role allowed to perform a step (`role` plus any `altRoles`). */
export function mbStepRoles(s: MBStepDef): MBRole[] {
  return s.altRoles && s.altRoles.length ? [s.role, ...s.altRoles] : [s.role];
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
  { key: "qa_tested", label: "Quality tested — pass", done: "Quality tested", role: "technical_head", altRoles: ["quality_inspector"] },
  { key: "qa_plant_checked", label: "Quality & Quantity Approved", done: "Plant QC & quantity passed", role: "plant_manager" },
  { key: "qa_transferred", label: "Transferred to Office", done: "Transferred to office", role: "logistics" },
  { key: "qa_sales_checked", label: "Quality & Quantity Re-Checked", done: "Sales 2nd QC & quantity passed", role: "sales" },
  { key: "delivery_docs", label: "Save documents & approve delivery", done: "Delivery documents ready", role: "accounting" },
  { key: "delivered", label: "Mark delivered", done: "Delivered", role: "logistics" },
  { key: "delivery_confirmed", label: "Approve POD — successful delivery", done: "Delivery confirmed (successful delivery)", role: "sales" },
  { key: "docs_surrendered", label: "Documents surrendered to accounting", done: "Signed documents surrendered", role: "logistics" },
  { key: "docs_received", label: "Confirm documents received", done: "Documents received by accounting", role: "accounting" },
  { key: "docs_filed", label: "File documents — batch delivered", done: "Documents filed (partial delivery)", role: "accounting" },
];

/**
 * From-stock delivery variant — for an order fulfilled from Fans & Blowers on-hand
 * stock (e.g. angle corner). Identical to the delivery sequence except the quality
 * & quantity test is run by the **Warehouse** (who holds the stock) instead of the
 * Technical Head; the Plant Manager still approves and Logistics still transfers.
 */
export const MULTIBATCH_STOCK_STEPS: MBStepDef[] = MULTIBATCH_STEPS.map((s) =>
  s.key === "qa_tested" ? { ...s, role: "warehouse", altRoles: undefined } : s,
);

/**
 * Office-pickup variant of the per-batch sequence. Same engine, but each batch
 * follows the pickup path: it SKIPS plant-QC → transfer → Sales-2nd-QC, the
 * quality test is the 2nd Quality Inspector's, and the pick-up documents / proof
 * of pick up / surrender are handled by Sales (client collects at the office).
 * Shares the step KEYS with the delivery list so the POD (`delivered`) and
 * document (`delivery_docs`) gates keep working.
 */
export const MULTIBATCH_PICKUP_STEPS: MBStepDef[] = [
  { key: "client_notified", label: "Notify client — batch ready for pick up", done: "Client notified (batch ready)", role: "sales" },
  { key: "payment_checked", label: "Payment checked", done: "Payment checked", role: "accounting", collectsPayment: true },
  { key: "payment_confirmed", label: "Payment confirmed", done: "Payment confirmed", role: "payment_approver" },
  { key: "qa_tested", label: "Quality tested — pass", done: "Quality tested", role: "quality_inspector_2" },
  { key: "delivery_docs", label: "Save documents & approve pick up", done: "Pick-up documents ready", role: "accounting" },
  // Combined step (matches the single-pickup flow): Sales uploads the proof of
  // pick up (into the batch's POD) and approves it in one action. Keeps the
  // `delivered` key so the POD gate, delivered-qty tracking and close trigger work.
  { key: "delivered", label: "Approve POP — successful pick up", done: "Picked up (successful pick up)", role: "sales" },
  { key: "docs_surrendered", label: "Documents surrendered to accounting", done: "Signed documents surrendered", role: "sales" },
  { key: "docs_received", label: "Confirm documents received", done: "Documents received by accounting", role: "accounting" },
  { key: "docs_filed", label: "File documents — batch picked up", done: "Documents filed (partial pick up)", role: "accounting" },
];

/**
 * Plant-pickup variant of the per-batch sequence — the client collects at the
 * plant. Produced-order QA (Technical Head/QI → Plant Manager), then the
 * Warehouseman makes the delivery form and uploads the proof of pick up, the
 * Plant Manager approves the delivery, and Sales approves the POD. No transfer to
 * office and no surrender step. Keeps the `delivery_docs` (batch documents) and
 * `delivered` (proof-of-pick-up) keys so the panel's upload gates keep working.
 */
export const MULTIBATCH_PLANT_PICKUP_STEPS: MBStepDef[] = [
  { key: "client_notified", label: "Notify client — batch ready for pick up", done: "Client notified (batch ready)", role: "sales" },
  { key: "payment_checked", label: "Payment checked", done: "Payment checked", role: "accounting", collectsPayment: true },
  { key: "payment_confirmed", label: "Payment confirmed", done: "Payment confirmed", role: "payment_approver" },
  { key: "qa_tested", label: "Quality tested — pass", done: "Quality tested", role: "technical_head", altRoles: ["quality_inspector"] },
  { key: "qa_plant_checked", label: "Quality & Quantity Approved", done: "Plant QC & quantity passed", role: "plant_manager" },
  { key: "delivery_docs", label: "Make the delivery form", done: "Delivery form made", role: "warehouse" },
  { key: "delivery_approved", label: "Approve delivery", done: "Delivery approved", role: "plant_manager" },
  { key: "delivered", label: "Upload proof of pick up & mark picked up", done: "Picked up", role: "warehouse" },
  { key: "delivery_confirmed", label: "Approve POP — successful pick up", done: "Pick up confirmed (successful pick up)", role: "sales" },
  { key: "docs_received", label: "Confirm documents received", done: "Documents received by accounting", role: "accounting" },
  { key: "docs_filed", label: "File documents — batch picked up", done: "Documents filed (partial pick up)", role: "accounting" },
];

/**
 * From-stock plant-pickup variant — like the plant-pickup sequence, but the quality
 * & quantity test is run by the **Warehouse** (who holds the F&B stock) instead of
 * the Technical Head, mirroring the from-stock delivery variant.
 */
export const MULTIBATCH_PLANT_STOCK_STEPS: MBStepDef[] = MULTIBATCH_PLANT_PICKUP_STEPS.map((s) =>
  s.key === "qa_tested" ? { ...s, role: "warehouse", altRoles: undefined } : s,
);

/**
 * Bought-in delivery variant — a bought-in order has no plant quality steps, so it
 * skips "Quality tested" and "Plant QC": after payment it goes straight to Transferred
 * to office (Logistics), then Sales' (single) quality & quantity check.
 */
export const MULTIBATCH_BOUGHTIN_STEPS: MBStepDef[] = MULTIBATCH_STEPS
  .filter((s) => s.key !== "qa_tested" && s.key !== "qa_plant_checked")
  .map((s) => (s.key === "qa_sales_checked" ? { ...s, label: "Quality & Quantity Checked", done: "Quality & quantity checked" } : s));

/**
 * Bought-in office-pickup variant — the bought-in delivery flow, but the client
 * collects at the office: Sales uploads the proof of pick up and surrenders the signed
 * documents (no Logistics delivery / separate POD approval).
 */
export const MULTIBATCH_BOUGHTIN_PICKUP_STEPS: MBStepDef[] = [
  { key: "client_notified", label: "Notify client — batch ready for pick up", done: "Client notified (batch ready)", role: "sales" },
  { key: "payment_checked", label: "Payment checked", done: "Payment checked", role: "accounting", collectsPayment: true },
  { key: "payment_confirmed", label: "Payment confirmed", done: "Payment confirmed", role: "payment_approver" },
  { key: "qa_transferred", label: "Transferred to Office", done: "Transferred to office", role: "logistics" },
  { key: "qa_sales_checked", label: "Quality & Quantity Checked", done: "Quality & quantity checked", role: "sales" },
  { key: "delivery_docs", label: "Save documents & approve pick up", done: "Pick-up documents ready", role: "accounting" },
  { key: "delivered", label: "Approve POP — successful pick up", done: "Picked up (successful pick up)", role: "sales" },
  { key: "docs_surrendered", label: "Documents surrendered to accounting", done: "Signed documents surrendered", role: "sales" },
  { key: "docs_received", label: "Confirm documents received", done: "Documents received by accounting", role: "accounting" },
  { key: "docs_filed", label: "File documents — batch picked up", done: "Documents filed (partial pick up)", role: "accounting" },
];

export const MB_DELIVERED_STEP = "delivered";
export const MB_FINAL_STEP = "docs_filed";
const MB_STEP_KEYS = new Set(
  [...MULTIBATCH_STEPS, ...MULTIBATCH_PICKUP_STEPS, ...MULTIBATCH_PLANT_PICKUP_STEPS, ...MULTIBATCH_BOUGHTIN_PICKUP_STEPS].map((s) => s.key),
);

/** The order's fulfilment mode, mirrored here to pick the per-batch step table. */
export type MBMode = "delivery" | "office_pickup" | "plant_pickup";

/**
 * The per-batch step sequence for this order, by fulfilment mode. `stockOnly`
 * selects the from-stock delivery variant (Warehouse runs the quality test).
 */
export function mbSteps(mode: MBMode = "delivery", stockOnly = false, boughtInOnly = false): MBStepDef[] {
  if (mode === "office_pickup") return boughtInOnly ? MULTIBATCH_BOUGHTIN_PICKUP_STEPS : MULTIBATCH_PICKUP_STEPS;
  if (mode === "plant_pickup") return stockOnly ? MULTIBATCH_PLANT_STOCK_STEPS : MULTIBATCH_PLANT_PICKUP_STEPS;
  return boughtInOnly ? MULTIBATCH_BOUGHTIN_STEPS : stockOnly ? MULTIBATCH_STOCK_STEPS : MULTIBATCH_STEPS;
}

export function mbStepDef(key: string, mode: MBMode = "delivery", stockOnly = false, boughtInOnly = false): MBStepDef | undefined {
  return mbSteps(mode, stockOnly, boughtInOnly).find((s) => s.key === key);
}

/** Last completed step index (−1 if none) and the next step to do (or null). */
export function mbProgress(b: MultiDeliveryBatch, mode: MBMode = "delivery", stockOnly = false, boughtInOnly = false): { lastDone: number; next: MBStepDef | null } {
  const steps = mbSteps(mode, stockOnly, boughtInOnly);
  let lastDone = -1;
  for (let i = 0; i < steps.length; i++) {
    if (b.steps[steps[i].key]) lastDone = i;
    else break;
  }
  const next = lastDone + 1 < steps.length ? steps[lastDone + 1] : null;
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
function coercePodDoc(value: unknown): SaleDoc | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (typeof o.path !== "string" || !o.path) return null;
  return { path: o.path, name: typeof o.name === "string" ? o.name : o.path.split("/").pop() ?? "file", uploadedAt: typeof o.uploadedAt === "string" ? o.uploadedAt : "" };
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
  const pod = Array.isArray(o.pod) ? (o.pod as unknown[]).map(coercePodDoc).filter((d): d is SaleDoc => !!d) : [];
  const docs: Record<string, SaleDoc[]> = {};
  if (o.docs && typeof o.docs === "object") {
    for (const [k, v] of Object.entries(o.docs as Record<string, unknown>)) {
      const files = Array.isArray(v) ? (v as unknown[]).map(coercePodDoc).filter((d): d is SaleDoc => !!d) : [];
      if (files.length) docs[k] = files;
    }
  }
  return {
    id: str(o.id),
    createdAt: str(o.createdAt),
    createdByName: str(o.createdByName),
    drNumber: str(o.drNumber),
    lines,
    steps,
    ...(pod.length ? { pod } : {}),
    ...(Object.keys(docs).length ? { docs } : {}),
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
