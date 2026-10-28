import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import type { User } from "@prisma/client";
import { ewtPeriod, inPeriod, netOfVat, supplierPaidDate, ewtTotals, ewtStatus, sortEwtRows, coerceEwtProof, type EwtRow } from "./ewt-summary";
import { canUseEwtSummary } from "./ewt-access";
import { buildEwtXlsx } from "./excel/ewt-summary-xlsx";

const user = (id: string, role = "OTHER") => ({ id, name: id, email: `${id}@t`, role }) as unknown as User;

describe("who may use the EWT Summary", () => {
  // The owner: "In admin, payment approver and accounting My Dashboard".
  it.each([
    ["admin", user("a", "ADMIN"), {}, true],
    ["payment approver", user("pa"), { pa: ["payment_approver"] }, true],
    ["accounting", user("ac"), { ac: ["accounting"] }, true],
    ["purchaser", user("pu"), { pu: ["purchaser"] }, false],
    ["sales", user("s", "SALES"), {}, false],
    ["engineer", user("e", "ENGINEER"), {}, false],
    ["nobody signed in", null, {}, false],
  ] as const)("%s → %s", (_n, u, roles, want) => {
    expect(canUseEwtSummary(u, roles as never)).toBe(want);
  });
});

describe("generation — monthly or quarterly", () => {
  it("a month", () => {
    expect(ewtPeriod("month", "2026-02", "2026-10-27")).toMatchObject({ key: "2026-02", from: "2026-02-01", to: "2026-02-28", label: "February 2026" });
  });
  it("a quarter", () => {
    expect(ewtPeriod("quarter", "2026-Q4", "2026-10-27")).toMatchObject({ key: "2026-Q4", from: "2026-10-01", to: "2026-12-31", label: "Q4 2026 (October – December)" });
  });
  it("nothing asked → the current month; a quarter with no key → the current quarter", () => {
    expect(ewtPeriod(undefined, undefined, "2026-10-27").key).toBe("2026-10");
    expect(ewtPeriod("quarter", "junk", "2026-05-03").key).toBe("2026-Q2");
  });
  it("inclusive at both ends", () => {
    const p = ewtPeriod("month", "2026-10", "2026-10-27");
    expect(inPeriod("2026-10-01", p)).toBe(true);
    expect(inPeriod("2026-10-31", p)).toBe(true);
    expect(inPeriod("2026-11-01", p)).toBe(false);
    expect(inPeriod(null, p)).toBe(false);
  });
});

describe("the template's arithmetic", () => {
  it("column G is gross ÷ 1.12 (the sample row: 13,520.23 → 12,071.63)", () => {
    expect(netOfVat(13520.23)).toBe(12071.63);
  });
  it("a sale that charges no VAT keeps its gross", () => {
    expect(netOfVat(10000, false)).toBe(10000);
  });
});

describe("supplier EWT is dated when the supplier was paid", () => {
  const base = { checks: [], cashOn: null, paymentDates: [], poDate: "2026-09-05", createdYMD: "2026-09-04" };
  it("a cleared check beats its printed date", () => {
    expect(supplierPaidDate({ ...base, checks: [{ clearedOn: "2026-10-03", clearingYMD: "2026-10-01" }] })).toEqual({ date: "2026-10-03", basis: "Check cleared" });
  });
  it("an uncleared check uses its date", () => {
    expect(supplierPaidDate({ ...base, checks: [{ clearedOn: null, clearingYMD: "2026-10-15" }] })).toEqual({ date: "2026-10-15", basis: "Check date (not yet cleared)" });
  });
  it("cash, and payments in instalments — the last one", () => {
    expect(supplierPaidDate({ ...base, cashOn: "2026-09-20" }).basis).toBe("Paid in cash");
    expect(supplierPaidDate({ ...base, paymentDates: ["2026-09-10", "2026-10-02"] })).toEqual({ date: "2026-10-02", basis: "Payment to supplier" });
  });
  it("not paid yet → the PO date, said so", () => {
    expect(supplierPaidDate(base)).toEqual({ date: "2026-09-05", basis: "PO date (not yet paid)" });
    expect(supplierPaidDate({ ...base, poDate: null }).date).toBe("2026-09-04");
  });
});

const row = (over: Partial<EwtRow>): EwtRow => ({
  kind: "supplier", refKey: "r", date: "2026-10-01", dateBasis: "Check cleared", registeredName: "JSL ELECTRIC CORPORATION",
  address: "STA. CRUZ, MANILA", tin: "006-605-356-00000", siNumber: "232522", reference: "PO-AFBM20260000985", href: null,
  gross: 13520.23, netOfVat: 12071.63, ewt: 120.72, pop: null, ...over,
});
const proof = { path: "ewt/supplier/x.pdf", name: "BIR 0619-E Oct.pdf", uploadedAt: "", byName: "Michelle Cotura" };

describe("status and totals", () => {
  it("Paid once a proof of payment to BIR is attached", () => {
    expect(ewtStatus(row({}))).toBe("Unpaid");
    expect(ewtStatus(row({ pop: proof }))).toBe("Paid");
  });
  it("totals, and the EWT still to remit", () => {
    const t = ewtTotals([row({ refKey: "a" }), row({ refKey: "b", ewt: 100, gross: 11200, netOfVat: 10000, pop: proof })]);
    expect(t).toEqual({ count: 2, gross: 24720.23, netOfVat: 22071.63, ewt: 220.72, paid: 1, unpaid: 1, unpaidEwt: 120.72 });
  });
  it("oldest first", () => {
    expect(sortEwtRows([row({ refKey: "b", date: "2026-10-09" }), row({ refKey: "a", date: "2026-10-02" })]).map((r) => r.refKey)).toEqual(["a", "b"]);
  });
  it("a stored proof survives; junk doesn't", () => {
    expect(coerceEwtProof(JSON.parse(JSON.stringify(proof)))).toEqual(proof);
    expect(coerceEwtProof({ name: "x" })).toBeNull();
  });
});

describe("the Excel download follows the owner's template", () => {
  it("title, generation line, headers on row 4, G as =F/1.12, a SUM total", async () => {
    const period = ewtPeriod("month", "2026-10", "2026-10-27");
    const buf = await buildEwtXlsx("supplier", period, [row({ pop: proof })]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    expect(ws.getCell("A1").value).toBe("EWT SUMMARY");
    expect(String(ws.getCell("A2").value)).toBe("Generation: Monthly — October 2026 · Supplier EWT — 1601-EQ");
    expect(ws.getRow(4).values).toEqual([undefined, "DATE", "REGISTERED NAME", "SUPPLIER'S ADDRESS", "TIN", "S.I. #", "GROSS TAXABLE PURCHASE", "NET OF VAT", "EWT", "Status", "POP"]);
    expect(ws.getCell("B5").value).toBe("JSL ELECTRIC CORPORATION");
    expect(ws.getCell("G5").value).toMatchObject({ formula: "F5/1.12" });
    expect(ws.getCell("H5").value).toBe(120.72);
    expect(ws.getCell("I5").value).toBe("Paid");
    expect(ws.getCell("J5").value).toBe("BIR 0619-E Oct.pdf");
    expect(ws.getCell("H7").value).toMatchObject({ formula: "SUM(H5:H5)" });
  });
});
