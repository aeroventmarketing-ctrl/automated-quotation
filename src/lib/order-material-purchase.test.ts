import { describe, it, expect } from "vitest";
import { orderMaterialPurchase, memberShare } from "./order-material-purchase";

const po = (lines: { description: string; qty: string; unitPrice: string; sku?: string }[], extra: Record<string, unknown> = {}) => ({
  poNumber: "PO-1", date: "2026-11-01", supplier: { company: "S", attention: "", address: "" },
  lines: lines.map((l) => ({ unit: "pc", ...l })), ewtPct: 1, ...extra,
});
const pr = (id: string, status: string, p: unknown, more: Record<string, unknown> = {}) => ({ id, status, kind: "order", mrfId: null, chainLog: {}, po: p, ...more });

describe("Total Material Purchase — approved and budgeted POs, at the PO total", () => {
  it("counts approved and budgeted (through received); leaves out pending, rejected and cancelled", () => {
    const one = po([{ description: "GI SHEET", qty: "10", unitPrice: "1000" }]); // 10,000
    const r = orderMaterialPurchase([
      pr("a", "APPROVED", one),
      pr("b", "VOUCHER_SIGNED", one),
      pr("c", "COMPLETED", one),
      pr("d", "PENDING_APPROVAL", one),
      pr("e", "REJECTED", one),
      pr("f", "CANCELLED", one),
    ]);
    expect(r).toEqual({ total: 30000, poCount: 3 });
  });
  it("the PO total, before EWT", () => {
    expect(orderMaterialPurchase([pr("a", "PURCHASED", po([{ description: "X", qty: "2", unitPrice: "560" }], { ewtPct: 2 }))]).total).toBe(1120);
  });
  it("a department request the Payment Approver hasn't approved is still pending", () => {
    const one = po([{ description: "X", qty: "1", unitPrice: "100" }]);
    expect(orderMaterialPurchase([pr("a", "APPROVED", one, { kind: "department" })]).total).toBe(0);
    expect(orderMaterialPurchase([pr("a", "APPROVED", one, { kind: "department", chainLog: { approve_po: { byName: "Rey Gil" } } })]).total).toBe(100);
  });
  it("no PO yet, nothing to count", () => {
    expect(orderMaterialPurchase([pr("a", "APPROVED", null)])).toEqual({ total: 0, poCount: 0 });
  });
});

describe("combined POs", () => {
  const lines = [
    { description: "MS PLATE 1/8", qty: "15", unitPrice: "2015", sku: "CON000466" }, // 30,225
    { description: "GI SHEET Z80 0.9mm", qty: "30", unitPrice: "1090", sku: "CON000399" }, // 32,700
  ];
  it("wholly this order's: the whole PO, once", () => {
    const shared = po(lines, { batchId: "B1", memberPrIds: ["a", "b"] });
    const r = orderMaterialPurchase([pr("a", "VOUCHER_SIGNED", shared), pr("b", "VOUCHER_SIGNED", shared)]);
    expect(r).toEqual({ total: 62925, poCount: 1 });
  });
  it("shared with another order: only this order's lines, at the PO's prices", () => {
    const shared = po(lines, { batchId: "B1", memberPrIds: ["a", "other-order-pr"] });
    const a = pr("a", "VOUCHER_SIGNED", shared, { items: ["15 pc · MS PLATE 1/8"], itemSkus: ["CON000466"] });
    expect(orderMaterialPurchase([a])).toEqual({ total: 30225, poCount: 1 });
  });
  it("matched by SKU, else by description; a line the PO no longer carries adds nothing", () => {
    expect(memberShare({ id: "a", status: "x", items: ["3 pc · gi sheet z80 0.9MM", "1 pc · Something removed"] }, lines.map((l) => ({ ...l, unit: "pc" })))).toBe(3270);
  });
});
