/**
 * Partial deliveries for an order.
 *
 * A client can take finished items before the whole order is done — e.g. 20 of
 * 50 air grilles now, the remaining 30 when they're finished. Each delivery is a
 * Delivery Receipt (DR) recording which items (by description) and how many left
 * on that trip. The order tracks ordered vs cumulative-delivered vs remaining.
 *
 * Stored as JSON on the order's workflow (no migration).
 */

/** One line of a delivery: an ordered item and how many were delivered now. */
export interface DeliveryLine {
  description: string;
  qty: number;
}

/** One delivery trip / Delivery Receipt. */
export interface DeliveryRecord {
  id: string;
  date: string; // YYYY-MM-DD the items left
  drNumber: string; // optional DR reference the sales/logistics team writes
  lines: DeliveryLine[];
  note: string;
  deliveredByName: string;
  createdAt: string; // ISO timestamp
  // Optional partial payment collected with this delivery. The amount is recorded
  // as a "progress" sale payment (so it counts toward Collected / Outstanding);
  // paymentId links to that sale payment so removing the delivery removes it too.
  paymentAmount?: number;
  paymentId?: string;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const str = (v: unknown): string => (v == null ? "" : String(v)).trim();

export function coerceDeliveryLine(value: unknown): DeliveryLine | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const description = str(o.description);
  const qty = num(o.qty);
  if (!description || qty <= 0) return null;
  return { description, qty };
}

export function coerceDeliveryRecord(value: unknown): DeliveryRecord | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const lines = Array.isArray(o.lines)
    ? (o.lines as unknown[]).map(coerceDeliveryLine).filter((l): l is DeliveryLine => !!l)
    : [];
  if (!str(o.id) || lines.length === 0) return null;
  const paymentAmount = num(o.paymentAmount);
  return {
    id: str(o.id),
    date: str(o.date),
    drNumber: str(o.drNumber),
    lines,
    note: str(o.note),
    deliveredByName: str(o.deliveredByName),
    createdAt: str(o.createdAt),
    ...(paymentAmount > 0 ? { paymentAmount, paymentId: str(o.paymentId) || undefined } : {}),
  };
}

export function coerceDeliveries(value: unknown): DeliveryRecord[] {
  return Array.isArray(value)
    ? (value as unknown[]).map(coerceDeliveryRecord).filter((d): d is DeliveryRecord => !!d)
    : [];
}

/** Total quantity delivered so far for each item description (case-insensitive key). */
export function deliveredByDescription(deliveries: DeliveryRecord[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of deliveries) {
    for (const l of d.lines) {
      const key = l.description.trim().toLowerCase();
      m.set(key, (m.get(key) ?? 0) + l.qty);
    }
  }
  return m;
}

/**
 * A quality check sign-off — finished items can't be delivered until they pass
 * QC, and only quantities that have passed QC may be delivered. Recorded per item
 * so partial batches (e.g. 20 of 50) can be checked and released as they finish.
 */
export interface QualityCheckRecord {
  id: string;
  date: string; // YYYY-MM-DD checked
  lines: DeliveryLine[]; // item + quantity passed
  note: string;
  checkedByName: string;
  createdAt: string;
}

export function coerceQualityCheckRecord(value: unknown): QualityCheckRecord | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const lines = Array.isArray(o.lines)
    ? (o.lines as unknown[]).map(coerceDeliveryLine).filter((l): l is DeliveryLine => !!l)
    : [];
  if (!str(o.id) || lines.length === 0) return null;
  return {
    id: str(o.id),
    date: str(o.date),
    lines,
    note: str(o.note),
    checkedByName: str(o.checkedByName),
    createdAt: str(o.createdAt),
  };
}

export function coerceQualityChecks(value: unknown): QualityCheckRecord[] {
  return Array.isArray(value)
    ? (value as unknown[]).map(coerceQualityCheckRecord).filter((q): q is QualityCheckRecord => !!q)
    : [];
}

/** Total quantity that has passed QC for each item description (case-insensitive key). */
export function qcByDescription(checks: QualityCheckRecord[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of checks) {
    for (const l of c.lines) {
      const key = l.description.trim().toLowerCase();
      m.set(key, (m.get(key) ?? 0) + l.qty);
    }
  }
  return m;
}
