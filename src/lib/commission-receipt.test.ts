import { describe, it, expect } from "vitest";
import { canConfirmReceipt, isReceived, awaitingReceipt, type ReceiptDeal } from "./commission-receipt";

/**
 * The receipt link's rule. The owner asked for a link *"clickable by sales
 * personnel when receiving commissions. Once clicked it will be the proof that
 * the sales personnel received the amount."*
 *
 * Proof is a strong word, and every case below is what it costs: a receipt
 * anyone else could write, or that could be written before the money moved, or
 * taken back afterwards, would not be one.
 */
const deal = (over: Partial<ReceiptDeal> = {}): ReceiptDeal => ({
  salespersonId: "rep-1",
  paid: true,
  receivedAt: null,
  amount: 15_000,
  ...over,
});

describe("who may confirm a commission was received", () => {
  it("the payee may confirm their own", () => {
    expect(canConfirmReceipt("rep-1", deal())).toBe(true);
  });

  /**
   * The case the whole feature turns on. Accounting released the money and an
   * admin can do everything else on this page — neither may sign for it. A
   * receipt the payer can write on the payee's behalf records nothing.
   */
  it("nobody else may — not Accounting, not an admin, not the Sales Head", () => {
    for (const someoneElse of ["accounting-1", "admin-1", "sales-head-1"]) {
      expect(canConfirmReceipt(someoneElse, deal()), someoneElse).toBe(false);
    }
  });

  it("not before Accounting has released it", () => {
    expect(canConfirmReceipt("rep-1", deal({ paid: false }))).toBe(false);
  });

  it("not twice — a receipt that can be rewritten is not evidence", () => {
    const already = deal({ receivedAt: "2026-09-15T02:00:00.000Z" });
    expect(isReceived(already)).toBe(true);
    expect(canConfirmReceipt("rep-1", already)).toBe(false);
  });

  it("an override row is the Sales Head's own money, and theirs to confirm", () => {
    const override = deal({ salespersonId: "sales-head-1" });
    expect(canConfirmReceipt("sales-head-1", override)).toBe(true);
    expect(canConfirmReceipt("rep-1", override)).toBe(false);
  });
});

describe("what one click covers", () => {
  const deals: ReceiptDeal[] = [
    deal({ amount: 15_000 }),                                        // theirs, awaiting
    deal({ amount: 7_500.25 }),                                      // theirs, awaiting
    deal({ amount: 900, receivedAt: "2026-09-01T00:00:00.000Z" }),   // theirs, already done
    deal({ amount: 50_000, paid: false }),                           // theirs, not released
    deal({ amount: 99_999, salespersonId: "rep-2" }),                // somebody else's
  ];

  it("everything released to them and not yet confirmed — and nothing else", () => {
    const { rows, total } = awaitingReceipt("rep-1", deals);
    expect(rows).toHaveLength(2);
    expect(total).toBe(22_500.25);
  });

  it("another person's click covers only their own", () => {
    const { rows, total } = awaitingReceipt("rep-2", deals);
    expect(rows).toHaveLength(1);
    expect(total).toBe(99_999);
  });

  it("nothing waiting is nothing to sign", () => {
    const { rows, total } = awaitingReceipt("nobody", deals);
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  it("the total is money — added to the cent, not to a floating-point blur", () => {
    const { total } = awaitingReceipt("rep-1", [deal({ amount: 0.1 }), deal({ amount: 0.2 })]);
    expect(total).toBe(0.3);
  });
});
