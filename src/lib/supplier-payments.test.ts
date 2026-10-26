import { describe, it, expect } from "vitest";
import { coerceSupplierPayments, supplierPaymentTotals } from "./supplier-payments";

/**
 * The owner: *"Some PO requires DP to suppliers, we want to monitor those
 * payments made."* — e.g. PO-AFBM20260000954, ₱40,000.00 to JOEL LATERO SHOP.
 */
const dp = { id: "a", amount: 20000, date: "2026-10-20", note: "50% DP", proof: { path: "purchases/pr1/dp.jpg", name: "dp.jpg", uploadedAt: "" }, byName: "Michelle Cotura", at: "2026-10-20T03:00:00Z" };
const rest = { id: "b", amount: 20000, date: "2026-10-26", byName: "Michelle Cotura", at: "2026-10-26T03:00:00Z" };

describe("payments to a supplier", () => {
  it("are read back in date order, with their proof", () => {
    const list = coerceSupplierPayments([rest, dp]);
    expect(list.map((p) => p.id)).toEqual(["a", "b"]);
    expect(list[0].proof).toEqual({ path: "purchases/pr1/dp.jpg", name: "dp.jpg", uploadedAt: "" });
    expect(list[1].proof).toBeNull();
  });
  it("drop anything without an amount or a real date, and a proof outside purchases/", () => {
    const list = coerceSupplierPayments([{ ...dp, amount: 0 }, { ...dp, id: "c", date: "26/10/2026" }, { ...dp, id: "d", proof: { path: "sales/x.jpg", name: "x" } }, null, "x"]);
    expect(list.map((p) => p.id)).toEqual(["d"]);
    expect(list[0].proof).toBeNull();
    expect(coerceSupplierPayments(null)).toEqual([]);
  });
  it("total against what the supplier is owed: a 50% DP, then the balance", () => {
    expect(supplierPaymentTotals(coerceSupplierPayments([dp]), 40000)).toEqual({ paid: 20000, balance: 20000, over: 0, pct: 50 });
    expect(supplierPaymentTotals(coerceSupplierPayments([dp, rest]), 40000)).toEqual({ paid: 40000, balance: 0, over: 0, pct: 100 });
  });
  it("an overpayment is named, not hidden as a zero balance", () => {
    expect(supplierPaymentTotals(coerceSupplierPayments([dp, rest, { ...rest, id: "c" }]), 40000)).toMatchObject({ balance: 0, over: 20000 });
  });
});
