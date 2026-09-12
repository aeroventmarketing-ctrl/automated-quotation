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
  isPending,
  voucherDeals,
  isVoucherable,
  canMarkPaid,
  markPaidOpensYMD,
  shiftYMD,
  MARK_PAID_LEAD_DAYS,
  MONTHLY_QUOTA_GROSS,
  COMMISSION_RATE_PCT,
  OVERRIDE_RATE_PCT,
  overrideOn,
  withOverrides,
  SALES_START_YMD,
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
    payeeKind: "base",
    sourceSalespersonName: null,
    ratePct: 1.5,
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
    expect(isPayable(d, "2026-12-31")).toBe(false);
    expect(months[0].earned).toBe(15_000);
    expect(months[0].paid).toBe(15_000);
    expect(months[0].unpaid).toBe(0);
  });
});

describe("the Sales Head's 0.25% override", () => {
  const HEAD = new Map([["head", "JayR"]]);
  /** Everyone in these fixtures is on the override allow-list unless said otherwise. */
  const ALL = new Set(["rey", "des", "head"]);
  /** Two reps: Rey qualifies (₱1.12M), Des does not (₱500k). Both fully paid. */
  const team = () => [
    deal({ refId: "rey1", salespersonId: "rey", salespersonName: "Rey", gross: 1_120_000, net: 1_000_000 }),
    deal({ refId: "des1", salespersonId: "des", salespersonName: "Des", gross: 500_000, net: 500_000 }),
  ];

  it("pays 0.25% of the same net base the rep's 1.5% is paid on", () => {
    expect(OVERRIDE_RATE_PCT).toBe(0.25);
    expect(overrideOn(1_000_000)).toBe(2_500);
    expect(commissionOn(1_000_000)).toBe(15_000);
  });

  it("is ON TOP of the rep's 1.5% — the rep's payout is untouched", () => {
    const months = groupByPersonMonth(withOverrides(team(), HEAD, ALL));
    const rey = months.find((m) => m.salespersonId === "rey" && m.kind === "base")!;
    const head = months.find((m) => m.salespersonId === "head")!;
    expect(rey.earned).toBe(15_000); // exactly what it was without a Sales Head
    expect(head.earned).toBe(2_500);
    // The company pays 1.75% on that sale, split between two people.
    expect(rey.earned + head.earned).toBe(commissionOn(1_000_000) + overrideOn(1_000_000));
  });

  it("earns nothing from a rep who missed the target", () => {
    const months = groupByPersonMonth(withOverrides(team(), HEAD, ALL));
    const head = months.find((m) => m.salespersonId === "head")!;
    // Only Rey's qualifying deal is overridden; Des's ₱500k month is not.
    expect(head.deals).toHaveLength(1);
    expect(head.deals[0].sourceSalespersonName).toBe("Rey");
  });

  it("earns nothing until the client has fully paid, like the rep's own", () => {
    const owing = [deal({ refId: "r", salespersonId: "rey", salespersonName: "Rey", gross: 1_120_000, fullyPaidYMD: null })];
    expect(groupByPersonMonth(withOverrides(owing, HEAD, ALL)).some((m) => m.salespersonId === "head")).toBe(false);
  });

  it("does NOT override the Sales Head's own sales — they earn 1.5% there, not 1.75%", () => {
    const own = [deal({ refId: "h1", salespersonId: "head", salespersonName: "JayR", gross: 1_120_000, net: 1_000_000 })];
    const months = groupByPersonMonth(withOverrides(own, HEAD, ALL));
    expect(months).toHaveLength(1);
    expect(months[0].kind).toBe("base");
    expect(months[0].earned).toBe(15_000);
  });

  it("keeps the override off the head's own quota — it is not their sale", () => {
    // JayR sells ₱600k himself (short of ₱1M) while Rey's ₱1.12M month qualifies.
    const mixed = [
      deal({ refId: "h1", salespersonId: "head", salespersonName: "JayR", gross: 600_000, net: 600_000 }),
      deal({ refId: "rey1", salespersonId: "rey", salespersonName: "Rey", gross: 1_120_000, net: 1_000_000 }),
    ];
    const months = groupByPersonMonth(withOverrides(mixed, HEAD, ALL));
    const own = months.find((m) => m.salespersonId === "head" && m.kind === "base")!;
    const ovr = months.find((m) => m.salespersonId === "head" && m.kind === "override")!;
    // His own month is still short, so his own sale earns nothing…
    expect(own.monthGross).toBe(600_000);
    expect(own.qualifies).toBe(false);
    expect(own.earned).toBe(0);
    // …but the override on Rey's qualifying month is unaffected by that.
    expect(ovr.monthGross).toBe(0);
    expect(ovr.earned).toBe(2_500);
  });

  it("releases on the same date as the commission it rides on", () => {
    const months = groupByPersonMonth(withOverrides(team(), HEAD, ALL));
    const rey = months.find((m) => m.salespersonId === "rey")!.deals[0];
    const ovr = months.find((m) => m.salespersonId === "head")!.deals[0];
    expect(ovr.payoutYMD).toBe(rey.payoutYMD);
    expect(ovr.salesMonth).toBe(rey.salesMonth);
  });

  it("carries its own payout record, not the rep's", () => {
    const paidTeam = team().map((d) => ({ ...d, paid: true, paidByName: "Acctg", commissionId: "c1" }));
    const months = groupByPersonMonth(withOverrides(paidTeam, HEAD, ALL));
    const ovr = months.find((m) => m.salespersonId === "head")!.deals[0];
    // The rep having been paid must not mark the head's override paid.
    expect(ovr.paid).toBe(false);
    expect(ovr.commissionId).toBeNull();
    expect(ovr.payeeKind).toBe("override");
  });

  it("does nothing at all when no one holds the Sales Head role", () => {
    expect(withOverrides(team(), new Map(), ALL)).toHaveLength(2);
  });
});

describe("the books open on 1 August 2026", () => {
  it("starts where the owner said", () => {
    expect(SALES_START_YMD).toBe("2026-08-01");
  });

  it("is a boundary the grouping never sees — a hidden sale cannot help meet a target", () => {
    // The cutoff is applied in `buildCommissions` BEFORE grouping, so this is the
    // property that matters: whatever survives it is all rule 1 counts. A July
    // sale reaching the grouper would silently lift a July or August month over
    // ₱1,000,000 on money the books are not supposed to see.
    const kept = [deal({ refId: "aug", recognisedYMD: "2026-08-01", salesMonth: "2026-08", gross: 1_200_000 })];
    const months = groupByPersonMonth(kept);
    expect(months).toHaveLength(1);
    expect(months[0].monthGross).toBe(1_200_000);
  });

  it("keeps 1 August itself — the boundary is inclusive", () => {
    expect("2026-08-01" < SALES_START_YMD).toBe(false);
    expect("2026-07-31" < SALES_START_YMD).toBe(true);
  });
});

describe("the Sales Head's own target does not gate their override", () => {
  const HEAD = new Map([["head", "JayR"]]);
  const ALL = new Set(["rey", "head"]);

  /**
   * Owner (2026-09-02): *"If incase JayR Basal was not able to meet the 1 million
   * pesos target, Basal will still get the 0.25% cut from every sales role who
   * meet the target."*
   */
  it("pays the override in full on a month where the head sold nothing at all", () => {
    const months = groupByPersonMonth(
      withOverrides([deal({ refId: "r", salespersonId: "rey", salespersonName: "Rey", gross: 1_120_000, net: 1_000_000 })], HEAD, ALL),
    );
    const head = months.find((m) => m.salespersonId === "head")!;
    expect(head.kind).toBe("override");
    expect(head.earned).toBe(2_500);
  });

  it("pays it in full on a month where the head sold, but fell short", () => {
    const months = groupByPersonMonth(withOverrides([
      deal({ refId: "h", salespersonId: "head", salespersonName: "JayR", gross: 10_000, net: 10_000 }),
      deal({ refId: "r", salespersonId: "rey", salespersonName: "Rey", gross: 1_120_000, net: 1_000_000 }),
    ], HEAD, ALL));
    const own = months.find((m) => m.salespersonId === "head" && m.kind === "base")!;
    const ovr = months.find((m) => m.salespersonId === "head" && m.kind === "override")!;
    expect(own.qualifies).toBe(false); // ₱10,000 — nowhere near
    expect(own.earned).toBe(0);        // …so his own sale earns him nothing
    expect(ovr.earned).toBe(2_500);    // …and the override is untouched by that
  });

  it("pays the same override whether the head qualified or not", () => {
    const rey = () => deal({ refId: "r", salespersonId: "rey", salespersonName: "Rey", gross: 1_120_000, net: 1_000_000 });
    const short = groupByPersonMonth(withOverrides([rey()], HEAD, ALL));
    const rich = groupByPersonMonth(withOverrides([
      rey(), deal({ refId: "h", salespersonId: "head", salespersonName: "JayR", gross: 5_000_000, net: 5_000_000 }),
    ], HEAD, ALL));
    const of = (ms: typeof short) => ms.find((m) => m.salespersonId === "head" && m.kind === "override")!.earned;
    expect(of(short)).toBe(of(rich));
  });
});

describe("the override allow-list — whose sales the Sales Head earns on", () => {
  const HEAD = new Map([["head", "JayR"]]);
  /**
   * Owner (2026-09-02): *"JayR Basal can have a 0.25% cut from Desiree Enigo,
   * Kurt Calucin, May-Ann Asong sales. We will add more sales if needed"* and
   * *"JayR Basal do not have 0.25% cut from Flor Gil sales"*.
   */
  const TEAM = [
    deal({ refId: "des", salespersonId: "des", salespersonName: "Desiree Enigo", gross: 1_120_000, net: 1_000_000 }),
    deal({ refId: "kur", salespersonId: "kur", salespersonName: "Kurt Calucin", gross: 1_120_000, net: 1_000_000 }),
    deal({ refId: "may", salespersonId: "may", salespersonName: "May-Ann Asong", gross: 1_120_000, net: 1_000_000 }),
    deal({ refId: "flo", salespersonId: "flo", salespersonName: "Flor Gil", gross: 1_120_000, net: 1_000_000 }),
  ];
  const LISTED = new Set(["des", "kur", "may"]); // Flor is deliberately absent

  it("earns 0.25% from each listed salesperson", () => {
    const head = groupByPersonMonth(withOverrides(TEAM, HEAD, LISTED)).find((m) => m.salespersonId === "head")!;
    expect(head.deals.map((d) => d.sourceSalespersonName).sort())
      .toEqual(["Desiree Enigo", "Kurt Calucin", "May-Ann Asong"]);
    expect(head.earned).toBe(overrideOn(1_000_000) * 3);
  });

  it("earns NOTHING from Flor Gil, whose month qualified just as well", () => {
    const months = groupByPersonMonth(withOverrides(TEAM, HEAD, LISTED));
    const flor = months.find((m) => m.salespersonId === "flo")!;
    const head = months.find((m) => m.salespersonId === "head")!;
    expect(flor.qualifies).toBe(true);          // she hit the target…
    expect(flor.earned).toBe(commissionOn(1_000_000)); // …and is paid her own 1.5%…
    // …but nothing of hers reaches the Sales Head.
    expect(head.deals.some((d) => d.sourceSalespersonName === "Flor Gil")).toBe(false);
  });

  it("adds a new salesperson the moment they are ticked — no code change", () => {
    const widened = new Set([...LISTED, "flo"]);
    const head = groupByPersonMonth(withOverrides(TEAM, HEAD, widened)).find((m) => m.salespersonId === "head")!;
    expect(head.deals).toHaveLength(4);
    expect(head.earned).toBe(overrideOn(1_000_000) * 4);
  });

  it("earns nothing at all while the list is empty — the safe default", () => {
    // Not "everyone by default": that would quietly pay an override on a rep the
    // owner had excluded. Nobody ticked, nobody counted.
    expect(withOverrides(TEAM, HEAD, new Set())).toHaveLength(TEAM.length);
  });

  it("still never overrides the head's own sales, even if the head is ticked", () => {
    const withHead = [...TEAM, deal({ refId: "h", salespersonId: "head", salespersonName: "JayR", gross: 1_120_000, net: 1_000_000 })];
    const head = groupByPersonMonth(withOverrides(withHead, HEAD, new Set([...LISTED, "head"])))
      .find((m) => m.salespersonId === "head" && m.kind === "override")!;
    expect(head.deals.some((d) => d.sourceSalespersonName === "JayR")).toBe(false);
    expect(head.deals).toHaveLength(3);
  });
});

/**
 * Rule 4's timing, which the payout list used to ignore.
 *
 * The owner, looking at a voucher for ₱9,586.15 on 11 September: *"Desiree Enigo
 * 9586.15 Cash Voucher commission is August+September commission. August sales
 * commission should be released on September, September sales should be released
 * on October."*
 *
 * `releaseDateFor` always computed that correctly — the bug was that `isPayable`
 * asked only "approved and unpaid", so a commission joined the payout the moment
 * it was earned, months before its release day.
 */
describe("a commission is payable only once its release day arrives", () => {
  const august = groupByPersonMonth([deal({ gross: 1_200_000, fullyPaidYMD: "2026-08-20" })])[0].deals[0];
  const september = groupByPersonMonth([
    deal({ refId: "s1", salesMonth: "2026-09", recognisedYMD: "2026-09-01", gross: 1_200_000, fullyPaidYMD: "2026-09-01" }),
  ])[0].deals[0];

  it("dates them the way the owner describes", () => {
    expect(august.payoutYMD).toBe("2026-09-15");   // August sales → September
    expect(september.payoutYMD).toBe("2026-10-15"); // September sales → October
  });

  it("on 11 September, only August is ready — the reported bug", () => {
    const today = "2026-09-11";
    expect(isPayable(august, today)).toBe(false); // not until the 15th
    expect(isPayable(september, today)).toBe(false);
    expect(isPending(august, today)).toBe(true);
    expect(isPending(september, today)).toBe(true);
  });

  it("on 15 September, August is ready and September is NOT", () => {
    const today = "2026-09-15";
    expect(isPayable(august, today)).toBe(true);
    expect(isPayable(september, today)).toBe(false);
    // …which is the whole point: one voucher, August's money only.
    expect(isPending(september, today)).toBe(true);
  });

  it("on 15 October, September joins it", () => {
    const today = "2026-10-15";
    expect(isPayable(august, today)).toBe(true);
    expect(isPayable(september, today)).toBe(true);
  });

  it("payable and pending partition every approved, unpaid deal", () => {
    for (const today of ["2026-08-31", "2026-09-11", "2026-09-15", "2026-10-15", "2027-01-01"]) {
      for (const d of [august, september]) {
        expect(isPayable(d, today) || isPending(d, today), `${d.salesMonth} @ ${today}`).toBe(true);
        expect(isPayable(d, today) && isPending(d, today)).toBe(false);
      }
    }
  });

  it("a paid deal is neither, whatever the date", () => {
    const done = groupByPersonMonth([deal({ gross: 1_200_000, paid: true, paidByName: "Acctg" })])[0].deals[0];
    expect(isPayable(done, "2027-01-01")).toBe(false);
    expect(isPending(done, "2027-01-01")).toBe(false);
  });

  it("nextPayoutYMD still reports a release that has not arrived", () => {
    // Deliberately NOT gated on today — the field answers "when is the next
    // release", so blanking it before the date would be backwards.
    const m = groupByPersonMonth([
      deal({ refId: "s2", salesMonth: "2026-09", recognisedYMD: "2026-09-01", gross: 1_200_000, fullyPaidYMD: "2026-09-01" }),
    ])[0];
    expect(m.nextPayoutYMD).toBe("2026-10-15");
  });
});

/**
 * `buildCommissions` is memoised per request, and a server action shares its
 * request with the re-render `revalidatePath` triggers. So an action that read
 * the view, wrote, and then let the page re-render would hand that page its own
 * pre-write answer: the row would still say "unpaid" until someone refreshed by
 * hand, and the button would look broken.
 *
 * The rule that prevents it — **write paths call `buildCommissionsFresh`** — is
 * invisible at the call site and would come back the first time someone adds a
 * commission action by copying an existing one. Nothing else would fail: not the
 * compiler, not a unit test, not the build. Only the screen, occasionally.
 *
 * So it is asserted against the source itself.
 */
describe("no server action uses the memoised build", () => {
  const SERVER_ACTION_FILES = [
    "src/app/(app)/commissions/actions.ts",
    "src/app/(app)/orders/actions.ts",
  ];

  for (const rel of SERVER_ACTION_FILES) {
    it(`${rel} calls buildCommissionsFresh, never buildCommissions`, async () => {
      const { readFile } = await import("node:fs/promises");
      const src = await readFile(rel, "utf8");
      expect(src, `${rel} is not a server-action module any more`).toContain('"use server"');
      // `buildCommissions(` / `buildCommissions({` but NOT `buildCommissionsFresh(`.
      const memoised = src.match(/\bbuildCommissions\s*\(/g) ?? [];
      expect(memoised, `${rel} must use buildCommissionsFresh in a write path`).toEqual([]);
      expect(src).toMatch(/\bbuildCommissionsFresh\s*\(/);
    });
  }
});

/**
 * The tick boxes. The owner: *"If sales personnel or sales head were able to
 * meet the qualifications to receive commission, put a tick box in the row of
 * mark paid so we can generate a single cash voucher. For sales head put a check
 * box in sales override to generate a single voucher either sales head meet the
 * qualifications or not."*
 *
 * The ticks reach the voucher as a list of KEYS in a URL, which makes this the
 * one place a browser gets a say in what the company pays out. So the contract
 * asserted here is narrow and absolute: **a key can only remove a commission,
 * never add, price, or release one.** The obvious implementation — build the
 * voucher's lines from the keys — would let anyone who can edit a URL pay
 * themselves an arbitrary sum, and it would pass a happy-path test.
 */
describe("a ticked voucher selection can only narrow", () => {
  const payable = [
    deal({ refId: "q1", approved: true, amount: 100 }),
    deal({ refId: "q2", approved: true, amount: 200 }),
    deal({ refId: "q3", approved: true, amount: 300 }),
  ];
  const keyOf = (refId: string) => `order-${refId}-base`;

  it("no selection means the whole payable set — what the voucher did before ticks existed", () => {
    expect(voucherDeals(payable, undefined)).toEqual(payable);
    expect(voucherDeals(payable, null)).toEqual(payable);
    expect(voucherDeals(payable, "")).toEqual(payable);
    expect(voucherDeals(payable, "  ,  ,")).toEqual(payable);
  });

  it("a subset is exactly that subset", () => {
    const got = voucherDeals(payable, [keyOf("q1"), keyOf("q3")].join(","));
    expect(got.map((d) => d.refId)).toEqual(["q1", "q3"]);
    expect(got.reduce((a, d) => a + d.amount, 0)).toBe(400);
  });

  it("a key for something not payable adds nothing", () => {
    // Unapproved, already paid, not yet released, someone else's — none of them
    // are in `payable`, so none of their keys can match. The filter is over what
    // the server computed, never over what the URL asked for.
    const got = voucherDeals(payable, [keyOf("q1"), "order-NOT-A-DEAL-base", "order-q9-override"].join(","));
    expect(got.map((d) => d.refId)).toEqual(["q1"]);
  });

  it("a selection of only unknown keys is empty, so the voucher refuses to render", () => {
    expect(voucherDeals(payable, "order-ghost-base")).toEqual([]);
  });

  it("keys cannot carry an amount — the deal's own figure is used", () => {
    // Whatever a URL says, the peso value comes from the recomputed deal.
    const got = voucherDeals(payable, `${keyOf("q2")}`);
    expect(got).toHaveLength(1);
    expect(got[0].amount).toBe(200);
  });

  it("an override row is selectable on the same terms as any other", () => {
    // *"either sales head meet the qualifications or not"* — an override exists
    // because someone ELSE's month cleared the quota, so nothing about the head's
    // own target was ever in this path.
    const withOverride = [...payable, deal({ refId: "q4", payeeKind: "override", approved: true, amount: 50 })];
    const got = voucherDeals(withOverride, "order-q4-override");
    expect(got.map((d) => d.payeeKind)).toEqual(["override"]);
  });

  it("duplicated and whitespaced keys select each deal once", () => {
    const got = voucherDeals(payable, ` ${keyOf("q1")} , ${keyOf("q1")},${keyOf("q2")} `);
    expect(got.map((d) => d.refId)).toEqual(["q1", "q2"]);
  });
});

/**
 * The owner's two answers when the tick box and "Mark paid" were found to
 * disagree in the same cell:
 *
 *  - *"Enable Mark Paid at least 5 days before the release date."*
 *  - *"Ticks open as soon as a commission is approved — proceed with this."*
 *
 * So there are now THREE moments, deliberately, and the tests keep them apart:
 * prepare the voucher when it is approved, hand over the money in the five days
 * before release, and count it released on the day itself.
 */
describe("the three moments of a commission", () => {
  const d = (over: Partial<CommissionDeal> = {}) => deal({ approved: true, payoutYMD: "2026-10-15", ...over });

  it("shiftYMD rolls across months and years", () => {
    expect(shiftYMD("2026-10-15", -5)).toBe("2026-10-10");
    expect(shiftYMD("2026-10-03", -5)).toBe("2026-09-28");
    expect(shiftYMD("2026-01-02", -5)).toBe("2025-12-28");
    expect(shiftYMD("2026-03-01", -1)).toBe("2026-02-28"); // 2026 is not a leap year
  });

  it("Mark paid opens exactly five days before the release date", () => {
    expect(MARK_PAID_LEAD_DAYS).toBe(5);
    expect(markPaidOpensYMD("2026-10-15")).toBe("2026-10-10");
    const x = d();
    expect(canMarkPaid(x, "2026-10-09")).toBe(false); // six days out
    expect(canMarkPaid(x, "2026-10-10")).toBe(true);  // the day it opens
    expect(canMarkPaid(x, "2026-10-15")).toBe(true);  // release day
    expect(canMarkPaid(x, "2026-11-01")).toBe(true);  // late, still payable
  });

  it("a tick opens on approval, months before the money is due", () => {
    const x = d();
    // 12 September: not payable, not markable — but voucherable.
    expect(isPayable(x, "2026-09-12")).toBe(false);
    expect(canMarkPaid(x, "2026-09-12")).toBe(false);
    expect(isVoucherable(x)).toBe(true);
  });

  it("the three widen in order: payable ⊂ markable ⊂ voucherable", () => {
    const x = d();
    for (const today of ["2026-09-12", "2026-10-10", "2026-10-15", "2026-11-20"]) {
      if (isPayable(x, today)) expect(canMarkPaid(x, today), today).toBe(true);
      if (canMarkPaid(x, today)) expect(isVoucherable(x), today).toBe(true);
    }
  });

  it("none of them survives payment or a failed month", () => {
    const paid = d({ paid: true });
    const unapproved = d({ approved: false });
    for (const x of [paid, unapproved]) {
      expect(isPayable(x, "2026-11-01")).toBe(false);
      expect(canMarkPaid(x, "2026-11-01")).toBe(false);
      expect(isVoucherable(x)).toBe(false);
    }
  });

  it("a deal with no release date at all can be paid — it is not held hostage to a null", () => {
    // `payoutYMD` is null only when the release cannot be computed. Blocking on
    // that would strand the money with no date to wait for.
    const noDate = d({ payoutYMD: null });
    expect(markPaidOpensYMD(null)).toBeNull();
    expect(canMarkPaid(noDate, "2026-09-12")).toBe(true);
    expect(isPayable(noDate, "2026-09-12")).toBe(false); // still not "released"
  });
});
