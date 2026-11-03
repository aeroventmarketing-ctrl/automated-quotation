import { describe, it, expect } from "vitest";
import { saleRemovalActivity } from "./sale-activity";
import type { SaleRecord } from "./sale";

const quote = {
  id: "q1",
  quoteNumber: "2026 - AFBM00002492A",
  total: 112000,
  discountPct: 0,
  vatMode: "INCLUSIVE",
  currency: "PHP",
  classification: {},
  inquiry: { customer: { company: "DG ENGINEERING AND CONSTRUCTION SERVICES" } },
};

const confirmed: SaleRecord = {
  arrangement: "downpayment_full",
  po: { path: "sales/q1/po.pdf", name: "po.pdf", uploadedAt: "2026-09-10T00:00:00.000Z" },
  payments: [{ id: "p1", kind: "down", amount: 50000, date: "2026-09-12T00:00:00.000Z" }],
};

describe("saleRemovalActivity", () => {
  it("names the client, the quote and the value that leaves the books", () => {
    const entry = saleRemovalActivity(quote, confirmed, "sale.cleared", "Sale cleared");
    expect(entry.action).toBe("sale.cleared");
    expect(entry.summary).toContain("DG ENGINEERING AND CONSTRUCTION SERVICES");
    expect(entry.summary).toContain("2026 - AFBM00002492A");
    // The deal value the sales report and the dashboard were counting.
    expect(entry.summary).toContain("112,000.00");
    expect(entry.href).toBe("/quotations/q1");
    expect(entry.entityId).toBe("q1");
  });

  it("records what was removed, so the figures survive the record", () => {
    const { meta } = saleRemovalActivity(quote, confirmed, "sale.cleared", "Sale cleared");
    expect(meta).toMatchObject({
      dealValue: 112000,
      currency: "PHP",
      wasConfirmed: true,
      arrangement: "downpayment_full",
      hadPo: true,
      payments: 1,
      collected: 50000,
    });
  });

  it("tells apart a sale that was never counted", () => {
    // No PO → never confirmed → it was not in anyone's sales figures.
    const draft: SaleRecord = { arrangement: "downpayment_full", po: null, payments: [] };
    const { meta } = saleRemovalActivity(quote, draft, "order.removed", "Order removed");
    expect(meta).toMatchObject({ wasConfirmed: false, hadPo: false, payments: 0, collected: 0 });
  });

  it("handles a quotation whose sale is already gone", () => {
    const entry = saleRemovalActivity({ ...quote, inquiry: null }, null, "order.removed", "Order removed");
    expect(entry.summary).toContain("customer");
    expect(entry.meta).toMatchObject({ wasConfirmed: false, hadPo: false, payments: 0, collected: 0 });
  });
});
