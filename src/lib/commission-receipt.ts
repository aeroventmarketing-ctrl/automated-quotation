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
