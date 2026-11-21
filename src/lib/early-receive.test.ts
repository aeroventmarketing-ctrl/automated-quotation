import { describe, it, expect } from "vitest";
import { canReceiveEarly, goesToClientNotStock, inEarlyReceiveWindow, readEarlyReceive } from "./early-receive";
import { planConfirm } from "./awaiting-delivery";

const pr = (status: string, extra: Record<string, unknown> = {}) => ({ status, kind: "order", dept: "fans", quotationId: "q1", chainLog: {}, ...extra });

describe("Goods arrived — Receive now", () => {
  it("is open from Cash & Check Released until the Plant Manager's final approval", () => {
    expect(inEarlyReceiveWindow("VOUCHER_SIGNED")).toBe(false);
    for (const s of ["CASH_RELEASED", "WITH_PURCHASER", "TASKED", "PURCHASED", "CHECKED", "DELIVERED", "RECEIVED"]) expect(inEarlyReceiveWindow(s)).toBe(true);
    expect(inEarlyReceiveWindow("PLANT_APPROVED")).toBe(false); // the ordinary Receive is open there
    expect(inEarlyReceiveWindow("COMPLETED")).toBe(false);
  });
  it("only for someone who may receive, only once, never for goods going straight to the client", () => {
    expect(canReceiveEarly(pr("TASKED"), true)).toBe(true);
    expect(canReceiveEarly(pr("TASKED"), false)).toBe(false);
    expect(canReceiveEarly(pr("TASKED", { chainLog: { early_receive: { byName: "Willy", at: "2026-11-21T01:00:00Z" } } }), true)).toBe(false);
    expect(goesToClientNotStock({ kind: "department", dept: "office", quotationId: "q1" })).toBe(true);
    expect(canReceiveEarly(pr("TASKED", { kind: "department", dept: "office" }), true)).toBe(false);
  });
  it("reads the stamp back, and nothing else", () => {
    expect(readEarlyReceive({ early_receive: { byName: "Willy Ho", at: "2026-11-21T01:00:00Z" } })).toEqual({ byName: "Willy Ho", at: "2026-11-21T01:00:00Z" });
    expect(readEarlyReceive({ early_receive: "yes" })).toBeNull();
    expect(readEarlyReceive(null)).toBeNull();
  });
});

describe("Delivered on the Inventory page, then the PO is received", () => {
  it("counts what was confirmed as in stock already — nothing added twice, nothing left to release", () => {
    const p = planConfirm([{ stockItemId: "plate", qty: 10 }], [{ id: "d1", stockItemId: "plate", qty: 10, createdAt: "2026-11-20T01:00:00Z", confirmed: true }]);
    expect(p).toMatchObject({ adds: [], release: [], reduce: [] });
  });
  it("a live hold on the same PO is still released; only true extra is added", () => {
    const p = planConfirm(
      [{ stockItemId: "plate", qty: 12 }],
      [
        { id: "d1", stockItemId: "plate", qty: 4, createdAt: "2026-11-20T02:00:00Z", confirmed: true },
        { id: "h1", stockItemId: "plate", qty: 6, createdAt: "2026-11-20T01:00:00Z" },
      ],
    );
    expect(p.release).toEqual(["h1"]);
    expect(p.adds).toEqual([{ stockItemId: "plate", qty: 2 }]);
  });
});
