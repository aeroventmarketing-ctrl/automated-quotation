/**
 * Who may confirm that a commission was received, and what that confirmation is
 * worth.
 *
 * The owner asked for a link each salesperson clicks when the money reaches
 * them, *"once clicked it will be the proof that the sales personnel received
 * the amount."*
 *
 * Everything here follows from that one word, **proof**:
 *
 *  - **Only the payee may click it.** Not Accounting, who released the money;
 *    not an admin, who can do everything else. A receipt the payer can stamp on
 *    the payee's behalf records nothing that was not already known — it would
 *    say "Accounting believes Accounting paid this". The value of the record is
 *    that a second, interested person wrote it.
 *  - **Only after it was paid.** Confirming receipt of money nobody has released
 *    yet is not a receipt; it is a guess.
 *  - **Once.** There is no un-confirming. A receipt that can be withdrawn is not
 *    evidence of anything, and the mistake it would guard against — clicking too
 *    early — is answered by the rule above.
 *
 * The Sales Head's override rows are their own money, so they acknowledge them
 * exactly as a rep acknowledges a 1.5% row: the payee is whoever the row pays.
 */

/** The parts of a commission this rule reads. */
export interface ReceiptDeal {
  /** Who the row pays — the rep on a base row, the Sales Head on an override. */
  salespersonId: string;
  /** Accounting has released it. */
  paid: boolean;
  /** ISO, once the payee has confirmed it arrived. */
  receivedAt?: string | null;
  amount: number;
}

/** Has the payee confirmed this one? */
export function isReceived(d: ReceiptDeal): boolean {
  return !!d.receivedAt;
}

/**
 * May `viewerId` confirm receipt of this row right now?
 *
 * Deliberately takes the viewer's id and nothing else — no roles, no admin flag.
 * There is no role that grants the right to receive somebody else's money.
 */
export function canConfirmReceipt(viewerId: string, d: ReceiptDeal): boolean {
  return d.salespersonId === viewerId && d.paid && !isReceived(d);
}

/**
 * What the viewer is being asked to acknowledge: the rows released to them and
 * not yet confirmed, and what they add up to.
 *
 * One click covers the lot, because one cash voucher is what they are handed —
 * *"Total every approved inquiry and make a single cash voucher per sales
 * personnel"*. Each row still gets its own stamp, so a line can be checked on its
 * own afterwards.
 */
export function awaitingReceipt<T extends ReceiptDeal>(viewerId: string, deals: readonly T[]): { rows: T[]; total: number } {
  const rows = deals.filter((d) => canConfirmReceipt(viewerId, d));
  const total = Math.round(rows.reduce((a, d) => a + d.amount, 0) * 100) / 100;
  return { rows, total };
}

/**
 * What the viewer is owed a confirmation for, read from the PAYOUT RECORD rather
 * than from the live entitlement computation.
 *
 * The distinction matters. `buildCommissions` recomputes who has earned what from
 * the confirmed sales themselves, so a deal can stop computing — a revised order,
 * a month that no longer clears the quota, a cutoff moved. The money, once
 * released, does not stop having been released. Driving the payee's link off the
 * `Commission` table means the question they are asked is *"has this payout
 * reached you?"*, which has the same answer however the entitlement is
 * recalculated afterwards.
 *
 * It also matches what `confirmCommissionReceipt` actually writes, so the link
 * can never offer a confirmation the action would then refuse.
 */
export interface OutstandingReceipt {
  count: number;
  total: number;
  /** The slips attached to those payouts, de-duplicated. */
  proof: { path: string; name: string; uploadedAt: string; uploadedById: string; uploadedByName: string }[];
}

export async function readOutstandingReceipt(
  salespersonId: string,
  deps: {
    findMany: (args: { where: Record<string, unknown>; select: Record<string, boolean> }) => Promise<
      { amount: unknown; paymentProof?: unknown }[]
    >;
    coerceProof: (v: unknown) => OutstandingReceipt["proof"];
  },
): Promise<OutstandingReceipt> {
  if (!salespersonId) return { count: 0, total: 0, proof: [] };
  const rows = await deps
    .findMany({ where: { salespersonId, paid: true, receivedAt: null }, select: { amount: true, paymentProof: true } })
    .catch(() => []);
  const total = Math.round(rows.reduce((a, r) => a + Number(r.amount), 0) * 100) / 100;
  const seen = new Set<string>();
  const proof = rows
    .flatMap((r) => deps.coerceProof(r.paymentProof))
    .filter((d) => (seen.has(d.path) ? false : (seen.add(d.path), true)));
  return { count: rows.length, total, proof };
}

/**
 * The payouts that have left the company and not yet been signed for, by person.
 *
 * Accounting's chase list, and the home of the proof of payment. It reads the
 * `Commission` table for the same reason `readOutstandingReceipt` does: a payout
 * is a fact about money that moved, and it must stay visible however the
 * entitlement behind it is later recalculated.
 *
 * This is also the answer to *where* a slip gets attached. The `Commission` row
 * is created when the voucher is marked paid, so before that there is nothing to
 * attach to — a proof of payment cannot precede the payment. The "Ready for
 * payout" panel is therefore the wrong place to offer it, and this is the right
 * one.
 */
export interface AwaitingConfirmation {
  salespersonId: string;
  salespersonName: string;
  count: number;
  total: number;
  /** When the money was released — the earliest of the unconfirmed payouts. */
  paidAt: string | null;
  proof: OutstandingReceipt["proof"];
}

export async function readAwaitingConfirmation(deps: {
  findMany: (args: { where: Record<string, unknown>; select: Record<string, boolean> }) => Promise<
    { salespersonId: string; salespersonName: string; amount: unknown; paidAt: Date | null; paymentProof?: unknown }[]
  >;
  coerceProof: (v: unknown) => OutstandingReceipt["proof"];
}): Promise<AwaitingConfirmation[]> {
  const rows = await deps
    .findMany({
      where: { paid: true, receivedAt: null },
      select: { salespersonId: true, salespersonName: true, amount: true, paidAt: true, paymentProof: true },
    })
    .catch(() => []);
  const by = new Map<string, AwaitingConfirmation & { seen: Set<string> }>();
  for (const r of rows) {
    const e = by.get(r.salespersonId) ?? {
      salespersonId: r.salespersonId, salespersonName: r.salespersonName,
      count: 0, total: 0, paidAt: null as string | null, proof: [], seen: new Set<string>(),
    };
    e.count += 1;
    e.total = Math.round((e.total + Number(r.amount)) * 100) / 100;
    const at = r.paidAt ? r.paidAt.toISOString() : null;
    if (at && (!e.paidAt || at < e.paidAt)) e.paidAt = at;
    for (const d of deps.coerceProof(r.paymentProof)) {
      if (e.seen.has(d.path)) continue;
      e.seen.add(d.path);
      e.proof.push(d);
    }
    by.set(r.salespersonId, e);
  }
  return [...by.values()]
    .map(({ seen: _seen, ...e }) => e)
    .sort((a, b) => b.total - a.total);
}
