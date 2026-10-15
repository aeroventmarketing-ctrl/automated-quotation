import { describe, it, expect } from "vitest";
import { reconcile, reconSummary, groupByPurchaseOrder, type ReconInput } from "./expense-check-recon";

const base: ReconInput = {
  key: "po:po-afbm20260000607", poNumber: "PO-AFBM20260000607", supplier: "RITE PRODUCTS INC.",
  deptLabels: ["Duct"], inExpenses: true, releasedYMD: "2026-08-28",
  gross: 88_858.22, ewt: 793.38, vatInclusive: true, checkAmounts: [88_064.84], paidInCash: false, requests: 1, href: null,
};

describe("PO-607 — the owner's example", () => {
  const r = reconcile(base);
  it("expense = total ÷ 1.12 (Expenses Records' figure); the check = total − EWT (Check monitoring's)", () => {
    expect(r.expense).toBe(79_337.7);
    expect(r.vat).toBe(9_520.52);
    expect(r.expectedCheck).toBe(88_064.84);
    expect(r.actualCheck).toBe(88_064.84);
    expect(r.status).toBe("match");
    expect(r.diff).toBe(0);
  });
});

describe("what counts as a discrepancy", () => {
  it("a check more than ₱1 away from total − EWT", () => {
    const r = reconcile({ ...base, checkAmounts: [88_864.84] });
    expect(r.status).toBe("mismatch");
    expect(r.diff).toBe(800);
  });
  it("within ₱1 is rounding, not a discrepancy", () => {
    expect(reconcile({ ...base, checkAmounts: [88_065.5] }).status).toBe("match");
  });
  it("two checks on one PO add up", () => {
    expect(reconcile({ ...base, checkAmounts: [40_000, 48_064.84] }).status).toBe("match");
  });
  it("a photo nobody could read, no check yet, or paid in cash — named, not called a mismatch", () => {
    expect(reconcile({ ...base, checkAmounts: [null] }).status).toBe("unread");
    expect(reconcile({ ...base, checkAmounts: [] }).status).toBe("no-check");
    expect(reconcile({ ...base, checkAmounts: [], paidInCash: true }).status).toBe("cash");
  });
  it("a non-VAT supplier: the expense is the whole total", () => {
    const r = reconcile({ ...base, vatInclusive: false });
    expect(r.expense).toBe(88_858.22);
    expect(r.vat).toBe(0);
  });
});

describe("one row per purchase order", () => {
  it("a combined PO's requests group together; separate POs stay apart", () => {
    const po = (n: string, batchId?: string) => ({ poNumber: n, ...(batchId ? { batchId } : {}) });
    const groups = groupByPurchaseOrder([
      { id: "b", po: po("PO-770", "batch-770") },
      { id: "a", po: po("PO-770", "batch-770") },
      { id: "c", po: po("PO-607") },
      { id: "d", po: po("PO-608") },
    ]);
    expect(groups.map((g) => g.map((m) => m.id))).toEqual([["a", "b"], ["c"], ["d"]]);
  });
  it("the summary counts each PO once and only Expenses Records' POs toward the expense total", () => {
    const s = reconSummary([reconcile(base), reconcile({ ...base, key: "x", inExpenses: false, checkAmounts: [1] })]);
    expect(s.count).toBe(2);
    expect(s.mismatches).toBe(1);
    expect(s.expense).toBe(79_337.7);
  });
});
