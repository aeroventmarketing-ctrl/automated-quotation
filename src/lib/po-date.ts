/**
 * Changing a PO's date after the fact.
 *
 * The owner: *"Is there a possibility that we can manually edit the PO date and
 * will reflect to the system?"* — then *"build for admin, payment approver role
 * and purchaser role."* The PO date drives the printed PO, the BIR 2307 (its
 * quarter, and which month column the amount lands in), the Check Monitoring
 * "PO date" column and the EWT Summary's date for a PO not yet paid. Editing the
 * PO itself is closed once it is approved / purchased; this changes the date and
 * nothing else, at any stage, with a reason, on every request of a combined PO.
 *
 * The record of each change is an ActivityLog entry (`PO_DATE_ACTION`), read
 * back onto the PO card — who, from, to, when and why.
 */
// Who may do it is `canChangePoDate` in po-date-access.ts — kept apart so this
// file has no server imports and the PO card (a client component) can use it.

export const PO_DATE_ACTION = "purchase.po_date";

/** A real calendar day as YYYY-MM-DD, or null. */
export function normalisePoDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

/** The day part of a stored PO date ("2026-10-26" or an ISO timestamp). */
export const poDateYmd = (stored: string | null | undefined): string => (stored ?? "").slice(0, 10);

export interface PoDateChange {
  from: string;
  to: string;
  reason: string;
  byName: string;
  at: string;
}

/**
 * The latest date change for each purchase request, from the activity entries.
 * A combined PO's entry names every member, so each of them maps to it.
 */
export function latestPoDateChanges(
  entries: { actorName: string; createdAt: Date | string; meta: unknown }[],
): Record<string, PoDateChange> {
  const out: Record<string, PoDateChange> = {};
  const sorted = [...entries].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  for (const e of sorted) {
    const m = (e.meta ?? {}) as Record<string, unknown>;
    const ids = Array.isArray(m.prIds) ? m.prIds.filter((x): x is string => typeof x === "string") : [];
    if (typeof m.from !== "string" || typeof m.to !== "string" || ids.length === 0) continue;
    const change: PoDateChange = {
      from: m.from,
      to: m.to,
      reason: typeof m.reason === "string" ? m.reason : "",
      byName: e.actorName,
      at: new Date(e.createdAt).toISOString(),
    };
    for (const id of ids) out[id] = change;
  }
  return out;
}
