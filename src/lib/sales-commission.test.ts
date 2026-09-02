import { describe, it, expect } from "vitest";
import {
  payoutDateFor,
  netOfVat,
  commissionOn,
  fullyPaidOn,
  groupByPersonMonth,
  isPayable,
  MONTHLY_QUOTA_GROSS,
  COMMISSION_RATE_PCT,
  type CommissionDeal,
} from "./sales-commission";
import type { SaleRecord } from "./sale";

/** A deal fixture — everything the rules need, nothing they don't. */
function deal(over: Partial<CommissionDeal> = {}): CommissionDeal {
  const gross = over.gross ?? 1_120_000;
  return {
    kind: "order",
    refId: over.refId ?? "q1",
    refLabel: over.refLabel ?? "2026 - AFBM00000001R",
    href: "/orders/q1",
    company: "Acme",
    salespersonId: "u1",
    salespersonName: "Rey",
    salesMonth: "2026-08",
    recognisedYMD: "2026-08-10",
    basis: "payment",
    gross,
    net: over.net ?? Math.round((gross / 1.12) * 100) / 100,
    vatDeducted: true,
    collected: gross,
    fullyPaid: true,
    fullyPaidYMD: "2026-09-01",
    amount: 0,
    payoutYMD: null,
    approved: false,
    paid: false,
    paidAt: null,
    paidByName: null,
    commissionId: null,
    ...over,
  };
}

const sale = (payments: { amount: number; date: string }[]): SaleRecord => ({
  arrangement: "downpayment_full",
  po: { path: "p", name: "PO", uploadedAt: "2026-08-01" },
  payments: payments.map((p, i) => ({ id: `p${i}`, kind: "progress", amount: p.amount, date: p.date })),
});

describe("rule 4 — released every 15th and 30th", () => {
  it("pays the owner's worked example: full payment 1 Sept → 15 Sept", () => {
    expect(payoutDateFor("2026-09-01")).toBe("2026-09-15");
  });

  it("pays on the 15th itself when the money lands on the 15th", () => {
    expect(payoutDateFor("2026-09-15")).toBe("2026-09-15");
  });

  it("rolls to the 30th from the 16th onward", () => {
    expect(payoutDateFor("2026-09-16")).toBe("2026-09-30");
    expect(payoutDateFor("2026-09-30")).toBe("2026-09-30");
  });

  it("carries the 31st of a long month to the next 15th, and December to January", () => {
    expect(payoutDateFor("2026-10-31")).toBe("2026-11-15");
    expect(payoutDateFor("2026-12-31")).toBe("2027-01-15");
  });

  it("uses the last day of February, which has no 30th", () => {
    expect(payoutDateFor("2026-02-20")).toBe("2026-02-28"); // 2026 is not a leap year
    expect(payoutDateFor("2028-02-20")).toBe("2028-02-29");
    // …and never skips the cycle: the 28th still pays on the 28th.
    expect(payoutDateFor("2026-02-28")).toBe("2026-02-28");
  });
});

describe("rule 6 — 1.5% of gross sales less VAT", () => {
  /**
   * All four VAT presentations, and the owner's ruling on each (2026-09-02):
   * *"if order is VAT inclusive, deduct vat amount to sales commission. If order
   * is VAT Exclusive or Zero Rated do not deduct VAT amount."* The "+12%" mode is
   * labelled exclusive but adds VAT on top, so the client IS charged it — the
   * owner confirmed it deducts. Whole table asserted at once, so widening or
   * narrowing the rule shows up as a moved cell rather than a missing test.
   */
  const VAT_MODES: { mode: string; label: string; gross: number; base: number; deducts: boolean }[] = [
    { mode: "INCLUSIVE", label: "VAT inclusive", gross: 1_120_000, base: 1_000_000, deducts: true },
    { mode: "EXCLUSIVE_PLUS", label: "VAT exclusive (+12%)", gross: 1_120_000, base: 1_000_000, deducts: true },
    { mode: "EXCLUSIVE", label: "VAT exclusive (÷1.12)", gross: 900_000, base: 900_000, deducts: false },
    { mode: "ZERO_RATED", label: "VAT exclusive zero rated", gross: 900_000, base: 900_000, deducts: false },
  ];

  for (const { mode, label, gross, base, deducts } of VAT_MODES) {
    it(`${label} — ${deducts ? "deducts" : "does NOT deduct"} VAT`, () => {
      expect(netOfVat({ total: gross, vatMode: mode }, gross)).toBe(base);
      expect(base < gross).toBe(deducts);
      // …and the commission follows the base, not the invoice.
      expect(commissionOn(netOfVat({ total: gross, vatMode: mode }, gross))).toBe(commissionOn(base));
    });
  }

  it("pays 1.5% of the net", () => {
    expect(commissionOn(1_000_000)).toBe(15_000);
  });

  it("costs the salesperson ₱1,800 on a ₱1.12M deal when VAT is deducted", () => {
    // The whole point of the distinction, in one number: 1.5% of ₱1,120,000 is
    // ₱16,800; of the ₱1,000,000 net it is ₱15,000.
    expect(commissionOn(1_120_000) - commissionOn(1_000_000)).toBe(1_800);
  });

  it("keeps flat VAT-exempt lines at face value inside a VAT-inclusive deal", () => {
    // ₱1,000,000 total of which ₱200,000 is a flat exempt line: only the other
    // ₱800,000 is divided by 1.12.
    const q = { total: 1_000_000, vatMode: "INCLUSIVE", classification: { vatExemptTotal: 200_000 } };
    expect(netOfVat(q, 1_000_000)).toBe(200_000 + Math.round((800_000 / 1.12) * 100) / 100);
  });

  it("computes 1.5%, not 1.5% of the gross", () => {
    expect(COMMISSION_RATE_PCT).toBe(1.5);
    expect(commissionOn(1_120_000)).not.toBe(commissionOn(1_000_000));
  });
});

describe("rule 3 — fully paid, regardless of date", () => {
  it("dates full payment by the LAST payment, not the first", () => {
    const s = sale([{ amount: 300_000, date: "2026-08-28" }, { amount: 700_000, date: "2026-09-01" }]);
    expect(fullyPaidOn(s, 1_000_000)).toBe("2026-09-01");
  });

  it("is null while a peso is still outstanding", () => {
    const s = sale([{ amount: 999_999, date: "2026-08-28" }]);
    expect(fullyPaidOn(s, 1_000_000)).toBeNull();
  });

  it("tolerates rounding to the cent", () => {
    const s = sale([{ amount: 999_999.999, date: "2026-08-28" }]);
    expect(fullyPaidOn(s, 1_000_000)).toBe("2026-08-28");
  });
});

describe("rule 1 — the ₱1,000,000 month, and rule 5's automatic approval", () => {
  it("is the salesperson's MONTH total, not one order: three ₱600k deals qualify", () => {
    const months = groupByPersonMonth([
      deal({ refId: "a", gross: 600_000 }),
      deal({ refId: "b", gross: 600_000 }),
      deal({ refId: "c", gross: 600_000 }),
    ]);
    expect(months).toHaveLength(1);
    expect(months[0].monthGross).toBe(1_800_000);
    expect(months[0].qualifies).toBe(true);
    expect(months[0].deals.every((d) => d.approved)).toBe(true);
  });

  it("earns nothing at all in a month under the quota, however well paid", () => {
    const months = groupByPersonMonth([deal({ gross: 900_000 })]);
    expect(months[0].qualifies).toBe(false);
    expect(months[0].shortfall).toBe(100_000);
    expect(months[0].earned).toBe(0);
    expect(months[0].deals[0].approved).toBe(false);
    expect(months[0].deals[0].amount).toBe(0);
    // …but the payout date it WOULD have is still shown.
    expect(months[0].deals[0].payoutYMD).toBe("2026-09-15");
  });

  it("wants MORE than a million — exactly ₱1,000,000 is short", () => {
    expect(groupByPersonMonth([deal({ gross: MONTHLY_QUOTA_GROSS })])[0].qualifies).toBe(false);
    expect(groupByPersonMonth([deal({ gross: MONTHLY_QUOTA_GROSS + 0.01 })])[0].qualifies).toBe(true);
  });

  it("counts the quota on GROSS while paying 1.5% of the NET", () => {
    // ₱1,050,000 gross is over the quota; its net (₱937,500) is not.
    const months = groupByPersonMonth([deal({ gross: 1_050_000, net: 937_500 })]);
    expect(months[0].qualifies).toBe(true);
    expect(months[0].earned).toBe(commissionOn(937_500));
  });

  it("counts an unpaid deal towards the quota but does not pay it (rule 3)", () => {
    const months = groupByPersonMonth([
      deal({ refId: "paid", gross: 600_000, net: 600_000, fullyPaidYMD: "2026-09-01" }),
      deal({ refId: "owing", gross: 600_000, net: 600_000, fullyPaidYMD: null }),
    ]);
    expect(months[0].qualifies).toBe(true);
    expect(months[0].deals.find((d) => d.refId === "owing")!.approved).toBe(false);
    expect(months[0].earned).toBe(commissionOn(600_000));
  });

  it("keeps each month and each salesperson on its own quota", () => {
    const months = groupByPersonMonth([
      deal({ refId: "a", gross: 900_000, salesMonth: "2026-08" }),
      deal({ refId: "b", gross: 900_000, salesMonth: "2026-09", recognisedYMD: "2026-09-04" }),
      deal({ refId: "c", gross: 2_000_000, salespersonId: "u2", salespersonName: "Des" }),
    ]);
    expect(months).toHaveLength(3);
    expect(months.filter((m) => m.qualifies)).toHaveLength(1);
    expect(months.find((m) => m.qualifies)!.salespersonName).toBe("Des");
  });

  it("sorts months newest first and reports the earliest pending payout", () => {
    const months = groupByPersonMonth([
      deal({ refId: "a", gross: 1_200_000, fullyPaidYMD: "2026-09-20" }),
      deal({ refId: "b", gross: 1_200_000, fullyPaidYMD: "2026-09-02" }),
    ]);
    expect(months[0].nextPayoutYMD).toBe("2026-09-15");
  });

  it("stops counting a deal as payable once it has been paid out", () => {
    const months = groupByPersonMonth([deal({ gross: 1_200_000, net: 1_000_000, paid: true, paidByName: "Acctg" })]);
    const d = months[0].deals[0];
    expect(d.approved).toBe(true);
    expect(isPayable(d)).toBe(false);
    expect(months[0].earned).toBe(15_000);
    expect(months[0].paid).toBe(15_000);
    expect(months[0].unpaid).toBe(0);
  });
});
