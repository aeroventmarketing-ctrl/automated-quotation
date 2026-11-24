import { describe, it, expect } from "vitest";
import { planMrfUnrelease, readMrfMovement, statusAfterUnrelease, undoneMovementId, unreleaseReason } from "./mrf-unrelease";
import { classifyMovement } from "./stock-history";
import type { MRFItem } from "./order-workflow";

const line = (description: string, qty: string, extra: Partial<MRFItem> = {}): MRFItem => ({ description, qty, unit: "pc", ...extra });

describe("the movement and its return", () => {
  it("reads which MRF a movement went out on, issued or released", () => {
    expect(readMrfMovement("MRF #0644")).toEqual({ formNo: "0644", releasedTo: null });
    expect(readMrfMovement("MRF #0644 released to Motor Controller")).toEqual({ formNo: "0644", releasedTo: "Motor Controller" });
    expect(readMrfMovement("Counter sale CS-1")).toBeNull();
  });
  it("the return names the MRF and the movement it undoes, and the history reads it as a return", () => {
    const r = unreleaseReason("0644", "Duct", "ckmv1");
    expect(undoneMovementId(r)).toBe("ckmv1");
    expect(classifyMovement("RECEIPT", 1, r)).toMatchObject({ category: "in", label: "Unreleased — returned", where: "Back from Duct (admin)", mrfNo: "0644" });
    expect(classifyMovement("RECEIPT", 1, unreleaseReason("0643", null, "x"))).toMatchObject({ where: "Back from production (admin)" });
  });
});

describe("the MRF line goes back to waiting", () => {
  it("issued from stock, all of it back → the line waits for the warehouse again; the MRF is Partial", () => {
    const items = [line("PULLEY 3 1/2", "1", { disposition: "issue", issuedQty: "1" }), line("BELT", "2", { disposition: "issue", issuedQty: "2" })];
    const p = planMrfUnrelease(items, { released: false, qty: 1, stockName: "PULLEY 3 1/2", stockSku: null });
    if ("error" in p) throw new Error(p.error);
    expect(p.items[0]).toMatchObject({ description: "PULLEY 3 1/2", qty: "1", disposition: undefined, issuedQty: undefined });
    expect(statusAfterUnrelease(p.items, "issued")).toBe("partial");
  });
  it("issued, part of it back → the rest stays issued, the returned part waits", () => {
    const p = planMrfUnrelease([line("BOLT", "5", { disposition: "issue", issuedQty: "5" })], { released: false, qty: 2, stockName: "BOLT", stockSku: null });
    if ("error" in p) throw new Error(p.error);
    expect(p.items).toEqual([
      line("BOLT", "3", { disposition: "issue", issuedQty: "3" }),
      line("BOLT", "2", { disposition: undefined, issuedQty: undefined }),
    ]);
  });
  it("released (bought) → the released count drops; awaiting release again; a completed MRF is Partial", () => {
    const items = [line("MOTOR 1HP", "2", { disposition: "purchase", issuedQty: "2" })];
    const p = planMrfUnrelease(items, { released: true, qty: 1, stockName: "MOTOR 1HP", stockSku: null });
    if ("error" in p) throw new Error(p.error);
    expect(p.items[0]).toMatchObject({ disposition: "purchase", issuedQty: "1" });
    expect(statusAfterUnrelease(p.items, "completed")).toBe("partial");
    const all = planMrfUnrelease(items, { released: true, qty: 2, stockName: "MOTOR 1HP", stockSku: null });
    if ("error" in all) throw new Error(all.error);
    expect(all.items[0].issuedQty).toBeUndefined();
  });
  it("finds the line by SKU when the names differ; refuses to guess between different articles", () => {
    const items = [line("Pulley A", "1", { disposition: "issue", issuedQty: "1" }), line("Pulley B", "1", { disposition: "issue", issuedQty: "1" })];
    const bySku = planMrfUnrelease(items, { released: false, qty: 1, stockName: "PULLEY 3.5 IN", stockSku: "P-B", skuOf: (d) => (d === "Pulley B" ? "P-B" : "P-A") });
    expect("error" in bySku ? bySku.error : bySku.lineIndex).toBe(1);
    const guess = planMrfUnrelease(items, { released: false, qty: 1, stockName: "UNKNOWN", stockSku: null });
    expect("error" in guess && guess.error).toMatch(/Couldn't tell which MRF line/);
  });
  it("returning in two steps leaves one waiting line, not two", () => {
    const first = planMrfUnrelease([line("BOLT", "2", { disposition: "issue", issuedQty: "2" })], { released: false, qty: 1, stockName: "BOLT", stockSku: null });
    if ("error" in first) throw new Error(first.error);
    const second = planMrfUnrelease(first.items, { released: false, qty: 1, stockName: "BOLT", stockSku: null });
    if ("error" in second) throw new Error(second.error);
    expect(second.items).toEqual([line("BOLT", "2", { disposition: undefined, issuedQty: undefined })]);
  });
  it("never more than went out on the line", () => {
    const p = planMrfUnrelease([line("BOLT", "2", { disposition: "issue", issuedQty: "2" })], { released: false, qty: 3, stockName: "BOLT", stockSku: null });
    expect("error" in p && p.error).toMatch(/Only 2 went out/);
  });
  it("a fully handled MRF with nothing waiting keeps its status (completed → issued, the confirmation is cleared)", () => {
    expect(statusAfterUnrelease([line("A", "1", { disposition: "issue", issuedQty: "1" })], "completed")).toBe("issued");
  });
});
