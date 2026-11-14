import { describe, it, expect } from "vitest";
import { buildSalesHistory, counterSaleEvent, quoteSaleEvent, salesMonthKey, type SaleEvent } from "./monthly-sales";

const ev = (iso: string, amount: number, person = "Sam", kind: SaleEvent["kind"] = "quote"): SaleEvent => ({ at: new Date(iso), amount, person, kind });
const NOW = new Date("2026-11-13T10:00:00");

describe("monthly sales history", () => {
  it("lists every month from the first sale to now, empty months included", () => {
    const h = buildSalesHistory([ev("2026-08-05T10:00:00", 100), ev("2026-11-02T10:00:00", 50)], NOW);
    expect(h.months.map((m) => [m.key, m.total])).toEqual([["2026-08", 100], ["2026-09", 0], ["2026-10", 0], ["2026-11", 50]]);
    expect(h.thisMonth?.label).toBe("November 2026");
    expect(h.months[0]).toMatchObject({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("counts orders and counter sales apart, and names the month's top salesperson", () => {
    const h = buildSalesHistory(
      [ev("2026-11-01T10:00:00", 300, "Ana"), ev("2026-11-03T10:00:00", 200, "Ben"), ev("2026-11-04T10:00:00", 150, "Ben", "counter")],
      NOW,
    );
    expect(h.thisMonth).toMatchObject({ total: 650, quoteDeals: 2, counterDeals: 1, top: { name: "Ben", amount: 350 } });
  });

  it("change vs the prior month, the best month, the 12-month average of complete months, and year to date", () => {
    const h = buildSalesHistory(
      [ev("2025-11-10T10:00:00", 400), ev("2026-09-10T10:00:00", 1000), ev("2026-10-10T10:00:00", 800), ev("2026-11-10T10:00:00", 200)],
      NOW,
    );
    const oct = h.months.find((m) => m.key === "2026-10")!;
    expect(oct.change).toBe(-20);
    expect(h.months.find((m) => m.key === "2025-12")!.change).toBe(-100);
    expect(h.months.find((m) => m.key === "2026-01")!.change).toBeNull(); // nothing to compare to
    expect(h.best?.key).toBe("2026-09");
    // Nov 2025 → Oct 2026 (this month excluded): 400 + 1000 + 800 over 12 months.
    expect(h.last12).toEqual({ total: 2200, average: 183.33, months: 12 });
    expect(h.ytd).toBe(2000);
    expect(h.ytdLastYear).toBe(400);
    expect(h.months[0].short).toBe("Nov '25"); // spans two years
  });

  it("ignores a sale dated ahead of today", () => {
    const h = buildSalesHistory([ev("2026-12-02T10:00:00", 999)], NOW);
    expect(h.months.map((m) => m.key)).toEqual(["2026-11"]);
    expect(h.thisMonth?.total).toBe(0);
  });

  it("books a quotation only when its sale is confirmed, on the recognition date, at the payable total", () => {
    const base = { createdAt: new Date("2026-01-01"), total: 1120, discountPct: 0, vatMode: "INCLUSIVE", preparedBy: { name: "Sam" } };
    expect(quoteSaleEvent({ ...base, classification: {} })).toBeNull();
    const confirmed = quoteSaleEvent({
      ...base,
      classification: { sale: { arrangement: "cash", po: { path: "p", uploadedAt: "2026-10-01T00:00:00Z" }, payments: [{ amount: 500, date: "2026-10-20T02:00:00Z" }] } },
    });
    expect(confirmed).not.toBeNull();
    expect(salesMonthKey(confirmed!.at)).toBe("2026-10");
    expect(confirmed).toMatchObject({ person: "Sam", kind: "quote" });
    expect(confirmed!.amount).toBeGreaterThan(0);
  });

  it("books a counter sale on completion to its salesperson, else whoever recorded it", () => {
    const e = counterSaleEvent({ total: "250.5", completedAt: new Date("2026-11-02T10:00:00"), createdAt: new Date("2026-10-30"), salespersonName: null, soldByName: "Rey" });
    expect(e).toMatchObject({ amount: 250.5, person: "Rey", kind: "counter" });
    expect(salesMonthKey(e.at)).toBe("2026-11");
  });
});
