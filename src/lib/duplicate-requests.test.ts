import { describe, expect, it } from "vitest";
import { duplicateFlagsForOrder, findDuplicates, readNotDuplicate, sameItem, type DupMrf, type DupRequest } from "./duplicate-requests";

const label = (k: string | null) => (k ? k.toUpperCase() : "—");
const noSku = () => null;

const mrf = (id: string, formNo: string, at: string, items: DupMrf["items"], extra: Partial<DupMrf> = {}): DupMrf => ({
  id, formNo, dept: "fans", status: "purchasing", raisedAt: at, items, ...extra,
});
const pr = (id: string, at: string, items: string[], extra: Partial<DupRequest> = {}): DupRequest => ({
  id, mrfId: null, dept: "fans", status: "PENDING_APPROVAL", createdAt: at, items, itemSkus: [], ...extra,
});

describe("sameItem", () => {
  it("matches by SKU when both lines carry one, whatever the names", () => {
    expect(sameItem({ description: "Belt A", qty: "1", unit: "pc", sku: "CAT1" }, { description: "V-belt", qty: "2", unit: "pc", sku: "cat1" })).toBe(true);
    expect(sameItem({ description: "Belt", qty: "1", unit: "pc", sku: "CAT1" }, { description: "Belt", qty: "1", unit: "pc", sku: "CAT2" })).toBe(false);
  });
  it("falls back to the name, ignoring case, spacing and a trailing remark", () => {
    expect(sameItem({ description: "FAN  BELT A-42", qty: "1", unit: "pc", sku: null }, { description: "fan belt a-42 (spare)", qty: "1", unit: "pc", sku: "CAT9" })).toBe(true);
    expect(sameItem({ description: "Fan belt A-42", qty: "1", unit: "pc", sku: null }, { description: "Fan belt A-43", qty: "1", unit: "pc", sku: null })).toBe(false);
  });
});

describe("findDuplicates", () => {
  const line = (d: string, q = "1") => ({ description: d, qty: q, unit: "pc", sku: null });
  it("reports the EARLIEST earlier request, with both quantities", () => {
    const hits = findDuplicates({ prId: "p3", mrfId: "m3", at: "2026-11-03T00:00:00Z", lines: [line("Bolt", "5")] }, [
      { id: "m2", mrfId: "m2", ref: "MRF #0002", deptLabel: "Duct", at: "2026-11-02T00:00:00Z", lines: [line("Bolt", "3")] },
      { id: "m1", mrfId: "m1", ref: "MRF #0001 · PO-1", deptLabel: "Fans", at: "2026-11-01T00:00:00Z", lines: [line("Bolt", "2")] },
    ]);
    expect(hits).toEqual([{ item: "Bolt", qty: "5 pc", firstRef: "MRF #0001 · PO-1", firstAt: "2026-11-01T00:00:00Z", firstQty: "2 pc", firstDept: "Fans" }]);
  });
  it("never flags the first request, nor a request of the same MRF (a split)", () => {
    const src = [{ id: "m1", mrfId: "m1", ref: "MRF #0001", deptLabel: "Fans", at: "2026-11-01T00:00:00Z", lines: [line("Bolt")] }];
    expect(findDuplicates({ prId: "p1", mrfId: "m1", at: "2026-11-01T00:00:00Z", lines: [line("Bolt")] }, src)).toEqual([]);
    expect(findDuplicates({ prId: "p0", mrfId: null, at: "2026-10-01T00:00:00Z", lines: [line("Bolt")] }, src)).toEqual([]);
  });
});

describe("duplicateFlagsForOrder", () => {
  it("flags a later MRF's request for an item an earlier MRF already asked for — any department, any quantity", () => {
    const mrfs = [
      mrf("m1", "0001", "2026-11-01T01:00:00Z", [{ description: "Bolt M10", qty: "4", unit: "pc" }]),
      mrf("m2", "0002", "2026-11-02T01:00:00Z", [{ description: "Bolt M10", qty: "10", unit: "pc" }, { description: "Nut", qty: "1", unit: "pc" }], { dept: "duct" }),
    ];
    const prs = [
      pr("p1", "2026-11-01T02:00:00Z", ["4 pc · Bolt M10"], { mrfId: "m1", status: "BUDGETED", po: { poNumber: "PO-77" } }),
      pr("p2", "2026-11-02T02:00:00Z", ["10 pc · Bolt M10", "1 pc · Nut"], { mrfId: "m2", dept: "duct" }),
    ];
    const flags = duplicateFlagsForOrder(mrfs, prs, noSku, label);
    expect([...flags.keys()]).toEqual(["p2"]);
    expect(flags.get("p2")).toEqual([
      { item: "Bolt M10", qty: "10 pc", firstRef: "MRF #0001 · PO-77", firstAt: "2026-11-01T01:00:00Z", firstQty: "4 pc", firstDept: "FANS" },
    ]);
  });

  it("matches by SKU — an MRF line's code from the catalogue, a request line's recorded code", () => {
    const mrfs = [mrf("m1", "0001", "2026-11-01T01:00:00Z", [{ description: "Hex bolt 10mm", qty: "4", unit: "pc" }])];
    const prs = [pr("p9", "2026-11-05T00:00:00Z", ["2 pc · Bolt, hex, M10"], { itemSkus: ["CAT00010"] })];
    const flags = duplicateFlagsForOrder(mrfs, prs, (d) => (d === "Hex bolt 10mm" ? "CAT00010" : null), label);
    expect(flags.get("p9")?.[0].firstRef).toBe("MRF #0001");
  });

  it("ignores cancelled MRFs and rejected / cancelled requests, and doesn't flag finished ones", () => {
    const mrfs = [mrf("m1", "0001", "2026-11-01T01:00:00Z", [{ description: "Bolt", qty: "1", unit: "pc" }], { status: "cancelled" })];
    const prs = [
      pr("p0", "2026-11-01T00:00:00Z", ["1 pc · Bolt"], { status: "REJECTED" }),
      pr("p1", "2026-11-02T00:00:00Z", ["1 pc · Bolt"]),
      pr("p2", "2026-11-03T00:00:00Z", ["1 pc · Bolt"], { status: "COMPLETED" }),
    ];
    const flags = duplicateFlagsForOrder(mrfs, prs, noSku, label);
    expect(flags.has("p1")).toBe(false);
    expect(flags.has("p2")).toBe(false);
  });

  it("a request without an MRF is a first request too (its PO number), and 'Not a duplicate' silences the later one", () => {
    const prs = [
      pr("p1", "2026-11-01T00:00:00Z", ["1 pc · Bolt"], { status: "COMPLETED", po: { poNumber: "PO-5" } }),
      pr("p2", "2026-11-02T00:00:00Z", ["3 pc · Bolt"]),
    ];
    expect(duplicateFlagsForOrder([], prs, noSku, label).get("p2")?.[0]).toMatchObject({ firstRef: "PO-5", firstQty: "1 pc", qty: "3 pc" });
    const done = [prs[0], { ...prs[1], chainLog: { not_duplicate: { byName: "Rey", at: "2026-11-02T05:00:00Z" } } }];
    expect(duplicateFlagsForOrder([], done, noSku, label).size).toBe(0);
  });

  it("reads the stamp", () => {
    expect(readNotDuplicate({ not_duplicate: { byName: "Rey", at: "x" } })).toEqual({ byName: "Rey", at: "x" });
    expect(readNotDuplicate({})).toBeNull();
    expect(readNotDuplicate(null)).toBeNull();
  });
});
