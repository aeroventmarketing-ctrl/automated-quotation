import { describe, it, expect } from "vitest";
import { computeCashPosition, coerceCashPosition, EMPTY_CASH_POSITION, type CashPositionInput } from "./cash-position";
import { buildCheckWatch, checkWatchSummary } from "./check-monitor";
import type { CheckDoc } from "./voucher-check";

const input = (over: Partial<CashPositionInput> = {}): CashPositionInput => ({
  ...EMPTY_CASH_POSITION, cob: 0, coh: 0, collectibles: 0, cashGcashChecking: 0, ...over,
});

/**
 * The owner's eight rules, asserted against the figures on their own screenshot:
 * First Priority 22,538.94 · COB 121,658.12 · Remaining COB 99,119.18 ·
 * COH/Collectibles/Cash 0 · Remaining Cash and Dispensable Cash 99,119.18 ·
 * Total Payables 1,712,027.87 · Deficit 1,612,908.69.
 */
describe("the cash position, on the owner's own numbers", () => {
  const pos = computeCashPosition(input({ cob: 121658.12 }), {
    firstPriority: 22538.94,
    totalPayables: 1712027.87,
    receivables: 0,
  });

  it("rule 3 — Remaining COB is COB less Total First Priority", () => {
    expect(pos.remainingCob).toBe(99119.18);
  });

  it("rules 5 and 6 — Remaining Cash, and Dispensable Cash the same figure", () => {
    expect(pos.remainingCash).toBe(99119.18);
    expect(pos.dispensableCash).toBe(pos.remainingCash);
  });

  it("rule 8 — Deficit is Total Payables less Dispensable Cash", () => {
    expect(pos.deficit).toBe(1612908.69);
  });

  it("adds Cash on Hand, the linked Receivables and Cash/Gcash into Available Cash Balance", () => {
    const withCash = computeCashPosition(
      input({ cob: 121658.12, coh: 5000, cashGcashChecking: 1000.25 }),
      { firstPriority: 22538.94, totalPayables: 1712027.87, receivables: 2500.5 },
    );
    expect(withCash.remainingCash).toBe(107619.93); // 99,119.18 + 8,500.75
    expect(withCash.deficit).toBe(1604407.94);
  });

  /**
   * *"Collectibles change to Receivables, link and show the amount from
   * Receivables in Management dashboard."* The figure comes from the dashboard
   * now, so a stale hand-typed `collectibles` must not be counted as well.
   */
  it("ignores the old hand-typed Collectibles and uses the linked figure", () => {
    const stale = computeCashPosition(
      input({ cob: 100000, collectibles: 999999 }),
      { firstPriority: 0, totalPayables: 0, receivables: 2343701.47 },
    );
    expect(stale.receivables).toBe(2343701.47);
    expect(stale.remainingCash).toBe(2443701.47); // 100,000 + receivables — the 999,999 is gone
  });

  it("lets Remaining COB go negative — the bank cannot cover what clears today", () => {
    const short = computeCashPosition(input({ cob: 10000 }), { firstPriority: 22538.94, totalPayables: 0, receivables: 0 });
    expect(short.remainingCob).toBe(-12538.94);
    expect(short.dispensableCash).toBe(-12538.94);
  });

  it("reports a surplus as a negative deficit rather than hiding it", () => {
    const flush = computeCashPosition(input({ cob: 500000 }), { firstPriority: 0, totalPayables: 100000, receivables: 0 });
    expect(flush.deficit).toBe(-400000);
  });
});

/**
 * Rule 1: *"Total First Priority is the total check amount for clearing based on
 * the current date, if not cleared it will stay in this row."* And rule 7:
 * *"Total Payables is the total amount of checks issued."*
 *
 * Both come from the register itself, so the panel cannot disagree with the
 * table above it.
 */
describe("the two figures the register supplies", () => {
  const TODAY = "2026-09-03";
  const read = (clearing: string | null, amount: number) => ({
    accountNo: null, accountName: null, checkNo: "0000486722", payee: null,
    clearingYMD: clearing, amount, amountWords: null, bank: null,
    confidence: 0.95, warnings: [], issues: [], readByName: "M", readAt: "",
  });
  const doc = (path: string, clearing: string | null, amount: number, over: Partial<CheckDoc> = {}): CheckDoc => ({
    path, name: "c.jpg", uploadedAt: "", uploadedByName: "M", read: read(clearing, amount), ...over,
  });
  const helpers = {
    coerceDocs: (v: unknown) => v as CheckDoc[],
    poOf: () => ({ poNumber: "PO-1", supplierCompany: "Powerlink", date: "2026-07-01" }),
  };
  const pr = (id: string, docs: CheckDoc[]) => ({ id, quotationId: null, po: {}, voucherCheckDocs: docs });

  const rows = buildCheckWatch([
    pr("a", [doc("overdue", "2026-09-01", 11000)]),           // date passed, not cleared
    pr("b", [doc("today", "2026-09-03", 12000)]),             // clears today
    pr("c", [doc("soon", "2026-09-05", 13000)]),              // 2 days out
    pr("d", [doc("later", "2026-10-17", 14000)]),             // further out
    pr("e", [doc("gone", "2026-08-01", 15000, { cleared: { on: "2026-08-01", byName: "A", at: "" } })]),
  ], TODAY, helpers);
  const s = checkWatchSummary(rows);

  it("counts only checks whose date has arrived as First Priority", () => {
    // Overdue + today. NOT the one two days out: that gets a notice, not the
    // bank's money today.
    expect(s.firstPriorityAmount).toBe(23000);
  });

  it("keeps an uncleared overdue check in First Priority", () => {
    // "if not cleared it will stay in this row" — it is more urgent, not less.
    const onlyOverdue = checkWatchSummary(buildCheckWatch([pr("a", [doc("overdue", "2026-08-01", 11000)])], TODAY, helpers));
    expect(onlyOverdue.firstPriorityAmount).toBe(11000);
  });

  it("counts every uncleared check as Total Payables, and drops the cleared one", () => {
    expect(s.openAmount).toBe(11000 + 12000 + 13000 + 14000);
  });

  it("feeds the panel so the two can never drift apart", () => {
    const pos = computeCashPosition(input({ cob: 50000 }), {
      firstPriority: s.firstPriorityAmount,
      totalPayables: s.openAmount,
      receivables: 0,
    });
    expect(pos.firstPriority).toBe(23000);
    expect(pos.remainingCob).toBe(27000);
    expect(pos.totalPayables).toBe(50000);
    expect(pos.deficit).toBe(23000);
  });
});

describe("coerceCashPosition", () => {
  it("survives whatever is in the setting", () => {
    expect(coerceCashPosition(null)).toEqual(EMPTY_CASH_POSITION);
    expect(coerceCashPosition("nope")).toEqual(EMPTY_CASH_POSITION);
    expect(coerceCashPosition({ cob: "not a number" }).cob).toBe(0);
  });

  it("reads numbers typed as strings, which is what a form sends", () => {
    const c = coerceCashPosition({ cob: "121658.12", coh: 500, updatedByName: "Admin Ana" });
    expect(c.cob).toBe(121658.12);
    expect(c.coh).toBe(500);
    expect(c.updatedByName).toBe("Admin Ana");
  });
});
