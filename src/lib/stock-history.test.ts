import { describe, it, expect } from "vitest";
import { classifyMovement, matchPurchaseReceipt } from "./stock-history";

describe("where the stock went — read from the ledger's reason", () => {
  it.each([
    ["RECEIPT", 10, "Purchase received", { category: "in", label: "Purchase received", where: "From supplier", purchase: true }],
    ["RECEIPT", 10, "Purchase received (combined PO)", { category: "in", where: "From supplier (combined PO)", purchase: true }],
    ["RECEIPT", 5, "Reorder received", { category: "in", label: "Reorder received" }],
    ["ISSUE", -3, "MRF #0042", { category: "out", label: "Issued on MRF", where: "Production (MRF)", mrfNo: "0042" }],
    ["ISSUE", -3, "MRF #0042 released to Duct", { category: "out", label: "Released on MRF", where: "Duct", mrfNo: "0042" }],
    ["ISSUE", -2, "Order 2026 - AFBM00004019J released from stock", { category: "out", where: "Client order 2026 - AFBM00004019J", orderNo: "2026 - AFBM00004019J" }],
    ["ISSUE", -1, "Requisition · Office", { category: "out", label: "Issued on requisition", where: "Office" }],
    ["ISSUE", -4, "Counter sale CS-2026-00012", { category: "out", label: "Counter sale", saleNo: "CS-2026-00012" }],
    ["ISSUE", -4, "Counter sale CS-2026-00012 (edited)", { category: "out", saleNo: "CS-2026-00012" }],
    ["RECEIPT", 4, "Void counter sale CS-2026-00012", { category: "in", label: "Returned — counter sale voided", saleNo: "CS-2026-00012" }],
    ["ISSUE", -6, "Transfer to Office (in transit) · for display", { category: "transfer", label: "Transfer out", where: "To Office", note: "for display" }],
    ["RECEIPT", 6, "Transfer received from Plant Warehouse", { category: "transfer", label: "Transfer in", where: "From Plant Warehouse" }],
    ["RECEIPT", 6, "Office transfer received from Plant Warehouse", { category: "transfer", label: "Transfer in" }],
    ["RECEIPT", 6, "Transfer to Office cancelled — returned", { category: "transfer", where: "Back from Office" }],
    ["ADJUSTMENT", 30, "Opening balance (import)", { category: "adjust", label: "Opening balance (import)" }],
    ["ADJUSTMENT", -2, "Set on the item list (Edit)", { category: "adjust", label: "On hand set (Edit)" }],
    ["RECEIPT", 2, "found in rack B", { category: "in", label: "Received", where: null, note: "found in rack B" }],
    ["ISSUE", -2, null, { category: "out", label: "Issued" }],
    ["ADJUSTMENT", -2, "cycle count", { category: "adjust", label: "Count adjusted down" }],
    ["ADJUSTMENT", 0, "cycle count", { category: "adjust", label: "Count checked — no change" }],
  ] as const)("%s %s %s", (kind, delta, reason, want) => {
    expect(classifyMovement(kind, delta, reason)).toMatchObject(want);
  });
  it("the system's own wording is not repeated as a note", () => {
    expect(classifyMovement("RECEIPT", 20, "Purchase received").note).toBeUndefined();
    expect(classifyMovement("ISSUE", -3, "Transfer to Office (in transit)").note).toBeUndefined();
  });
});

describe("which PO a receipt belongs to", () => {
  const receipts = [
    { id: "a", receivedAt: "2026-10-01T03:00:00.400Z", receivedByName: "Wena" },
    { id: "b", receivedAt: "2026-10-01T03:00:10.000Z", receivedByName: "Wena" },
    { id: "c", receivedAt: "2026-10-01T03:00:00.100Z", receivedByName: "Joel" },
  ];
  it("the same person's receipt, closest in time", () => {
    expect(matchPurchaseReceipt("2026-10-01T03:00:00.000Z", "Wena", receipts)?.id).toBe("a");
  });
  it("none when nobody by that name received within the minute", () => {
    expect(matchPurchaseReceipt("2026-10-01T03:05:00.000Z", "Wena", receipts)).toBeNull();
    expect(matchPurchaseReceipt("2026-10-01T03:00:00.000Z", "Rey", receipts)).toBeNull();
  });
});
