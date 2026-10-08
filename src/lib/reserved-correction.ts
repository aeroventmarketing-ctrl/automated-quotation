/**
 * Setting an item's **Reserved** figure by typing a number.
 *
 * Reserved is not a column: it is the sum of active `StockReservation` rows, and
 * each one names what it is held for — an order number, a job. Overwriting the
 * total would cut that link, so the owner chose **"Correction entry"**:
 *
 *  - **Raising** it adds one reservation, *"Inventory correction"*, for the
 *    difference.
 *  - **Lowering** it releases the correction entries first (newest first — the
 *    most recent correction is the likeliest to be the wrong one), then the
 *    **oldest** real reservations. Whatever is released is stamped with the name
 *    of the person who did it.
 *
 * The last reservation touched may only need to give up part of its quantity.
 * It is then **reduced** in place, not released and re-created, so it keeps its
 * order reference, its original holder and its date — the things that make it
 * traceable — and the reduction is written into its note.
 *
 * Pure: it plans, the server action applies. That keeps the arithmetic
 * assertable without a database.
 */

export const CORRECTION_REF = "Inventory correction";

export interface ActiveReservation {
  id: string;
  qty: number;
  forRef: string;
  createdAt: Date | string;
}

export interface ReservedCorrectionPlan {
  /** Quantity of the one new correction reservation to create; 0 for none. */
  add: number;
  /** Reservations released in full, in the order they were chosen. */
  release: string[];
  /** The single reservation that gives up only part of its quantity. */
  reduce: { id: string; from: number; to: number } | null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const time = (d: Date | string) => new Date(d).getTime();

export const NO_CHANGE: ReservedCorrectionPlan = { add: 0, release: [], reduce: null };

export function planReservedCorrection(active: readonly ActiveReservation[], target: number): ReservedCorrectionPlan {
  if (!Number.isFinite(target) || target < 0) throw new Error("Reserved can't be negative.");
  const current = round3(active.reduce((s, r) => s + r.qty, 0));
  const diff = round3(target - current);
  if (diff === 0) return NO_CHANGE;
  if (diff > 0) return { add: diff, release: [], reduce: null };

  const corrections = active.filter((r) => r.forRef === CORRECTION_REF).sort((a, b) => time(b.createdAt) - time(a.createdAt));
  const real = active.filter((r) => r.forRef !== CORRECTION_REF).sort((a, b) => time(a.createdAt) - time(b.createdAt));

  let need = -diff;
  const release: string[] = [];
  let reduce: ReservedCorrectionPlan["reduce"] = null;
  for (const r of [...corrections, ...real]) {
    if (need <= 0) break;
    if (r.qty <= need) {
      release.push(r.id);
      need = round3(need - r.qty);
    } else {
      reduce = { id: r.id, from: r.qty, to: round3(r.qty - need) };
      need = 0;
    }
  }
  return { add: 0, release, reduce };
}
