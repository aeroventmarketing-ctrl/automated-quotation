/**
 * Combined Purchase Order ("batch"): one supplier PO that covers several
 * PurchaseRequests — possibly from different orders — and moves through the
 * approval → voucher → purchase → check → receive chain as a single unit.
 *
 * No new table: every member PurchaseRequest carries the SAME `po` JSON (with the
 * combined lines and one PO number) plus the batch link below, and every chain
 * step updates all members together, keeping their status in sync.
 */

/** The batch id stored inside a combined PO's JSON, or null for a single-request PO. */
export function poBatchId(po: unknown): string | null {
  if (!po || typeof po !== "object") return null;
  const b = (po as Record<string, unknown>).batchId;
  return typeof b === "string" && b ? b : null;
}

/** The member PurchaseRequest ids a combined PO covers (empty for a single PO). */
export function poMemberIds(po: unknown): string[] {
  if (!po || typeof po !== "object") return [];
  const m = (po as Record<string, unknown>).memberPrIds;
  return Array.isArray(m) ? m.filter((x): x is string => typeof x === "string" && !!x) : [];
}
