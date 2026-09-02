import { describe, it, expect } from "vitest";
import {
  payoutDateFor,
  firstReleaseForMonth,
  releaseDateFor,
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

  /**
   * The owner's wording, month shape by month shape (2026-09-02): *"commission
   * release is 15th and 30th of the month. If there is 31st in the month, pay on
   * 30th. If there is no 30th, let us say 29th or 28th, pay on 29th or 28th
   * whichever is applicable."*
   *
   * Asserted as a table across every shape a month can have, because the shapes
   * are exactly where this goes wrong — the previous "rolls to the 30th" test
   * used September, a 30-day month, so it never showed that a 31-day month must
   * stop at the 30th.
   */
  const MONTH_SHAPES: { label: string; y: number; m: string; last: number; second: string }[] = [
    { label: "31-day month pays on the 30th, never the 31st", y: 2026, m: "01", last: 31, second: "30" },
    { label: "August, 31 days", y: 2026, m: "08", last: 31, second: "30" },
    { label: "30-day month pays on the 30th", y: 2026, m: "04", last: 30, second: "30" },
    { label: "February pays on the 28th — there is no 30th", y: 2026, m: "02", last: 28, second: "28" },
    { label: "leap February pays on the 29th", y: 2028, m: "02", last: 29, second: "29" },
  ];

  for (const { label, y, m, last, second } of MONTH_SHAPES) {
    it(label, () => {
      const day = (d: number) => `${y}-${m}-${String(d).padStart(2, "0")}`;
      // First half of the month → the 15th.
      expect(payoutDateFor(day(1))).toBe(`${y}-${m}-15`);
      expect(payoutDateFor(day(15))).toBe(`${y}-${m}-15`);
      // Second half → this month's second release day, whatever the shape.
      expect(payoutDateFor(day(16))).toBe(`${y}-${m}-${second}`);
      expect(payoutDateFor(day(Number(second)))).toBe(`${y}-${m}-${second}`);
      // The release day is never the 31st, and never later than the month's end.
      expect(Number(second)).toBeLessThanOrEqual(30);
      expect(Number(second)).toBeLessThanOrEqual(last);
    });
  }

  it("carries money that lands on the 31st to the next cycle", () => {
    // Both of October's releases (15th, 30th) are gone by the 31st — the 30th
    // cannot pay out cash that had not arrived by the 30th.
    expect(payoutDateFor("2026-10-31")).toBe("2026-11-15");
    expect(payoutDateFor("2026-12-31")).toBe("2027-01-15");
  });
});

describe("rule 4's floor — a month's commissions start after the month ends", () => {
  it("starts August's releases on 15 September, per the owner's Desiree example", () => {
    expect(firstReleaseForMonth("2026-08")).toBe("2026-09-15");
    // Every August deal, however early the client paid, waits for 15 September.
    expect(releaseDateFor("2026-08-03", "2026-08")).toBe("2026-09-15");
    expect(releaseDateFor("2026-08-28", "2026-08")).toBe("2026-09-15");
    expect(releaseDateFor("2026-08-31", "2026-08")).toBe("2026-09-15");
  });

  it("still honours the owner's original worked example", () => {
    // "client made a full payment on September 1, 2026 → September 15, 2026"
    expect(releaseDateFor("2026-09-01", "2026-08")).toBe("2026-09-15");
  });

  it("trickles on past the floor as each client settles", () => {
    // "…onwards until every client who purchased in August 2026 has paid."
    expect(releaseDateFor("2026-09-20", "2026-08")).toBe("2026-09-30");
    expect(releaseDateFor("2026-10-02", "2026-08")).toBe("2026-10-15");
    expect(releaseDateFor("2027-01-20", "2026-08")).toBe("2027-01-30");
  });

  it("rolls a December sales month into January", () => {
    expect(firstReleaseForMonth("2026-12")).toBe("2027-01-15");
    expect(releaseDateFor("2026-12-05", "2026-12")).toBe("2027-01-15");
  });

  it("never releases inside the sales month, whatever its length", () => {
    for (const [month, paid] of [["2026-02", "2026-02-20"], ["2026-04", "2026-04-30"], ["2026-09", "2026-09-16"]]) {
      expect(releaseDateFor(paid, month) > `${month}-31`).toBe(true);
    }
  });

  it("applies the floor through the grouping, not just in the helper", () => {
    // Desiree's August, in miniature: qualified, client paid 3 August. The card
    // used to say "Release Aug 15" — a date inside the month it was earned in.
    const months = groupByPersonMonth([deal({ gross: 1_200_000, salesMonth: "2026-08", fullyPaidYMD: "2026-08-03" })]);
    expect(months[0].qualifies).toBe(true);
    expect(months[0].deals[0].payoutYMD).toBe("2026-09-15");
    expect(months[0].nextPayoutYMD).toBe("2026-09-15");
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
