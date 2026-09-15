import { describe, it, expect } from "vitest";
import { releaseDay, voucherMates, type VoucherRow } from "./commission-voucher-set";

/**
 * *"I attach once and auto attach to other."*
 *
 * Every test below is about the same question asked twice: which rows did this
 * one payment pay, and which rows did it NOT.
 */

const row = (over: Partial<VoucherRow> & { dealKey: string }): VoucherRow => ({
  id: over.dealKey,
  salespersonId: "rep-1",
  paid: true,
  paidYMD: "2026-09-15",
  receivedAt: null,
  ...over,
});

const keys = (rows: VoucherRow[]) => rows.map((r) => r.dealKey).sort();
const none = new Map<string, string>();

describe("the printed voucher decides, when there is one", () => {
  const v = new Map([
    ["order-a-base", "0000042"],
    ["order-b-base", "0000042"],
    ["order-c-base", "0000043"],
  ]);
  const rows = [
    row({ dealKey: "order-a-base", paidYMD: "2026-09-15" }),
    row({ dealKey: "order-b-base", paidYMD: "2026-09-16" }),
    row({ dealKey: "order-c-base", paidYMD: "2026-09-15" }),
    row({ dealKey: "order-d-base", paidYMD: "2026-09-15" }),
  ];

  it("covers every row the voucher covers", () => {
    expect(keys(voucherMates(rows[0], rows, v))).toEqual(["order-a-base", "order-b-base"]);
  });

  /** Voucher 43 is a different payment, even though it went out the same minute. */
  it("stops at the edge of the voucher — another voucher is another payment", () => {
    expect(keys(voucherMates(rows[0], rows, v))).not.toContain("order-c-base");
  });

  it("and does not spill onto a row that is on no voucher at all", () => {
    expect(keys(voucherMates(rows[0], rows, v))).not.toContain("order-d-base");
  });

  /** The other direction: a loose row must not reach INTO somebody's voucher. */
  it("a row on no voucher never joins one", () => {
    expect(keys(voucherMates(rows[3], rows, v))).toEqual(["order-d-base"]);
  });
});

describe("no voucher printed yet — the release that paid them", () => {
  it("rows released on the same day are one payment", () => {
    const rows = [
      row({ dealKey: "order-a-base" }),
      row({ dealKey: "order-b-base" }),
      row({ dealKey: "counter-c-base" }),
    ];
    expect(keys(voucherMates(rows[0], rows, none))).toEqual(["counter-c-base", "order-a-base", "order-b-base"]);
  });

  it("a release a day later is a different payment — once both are signed for", () => {
    const rows = [
      row({ dealKey: "order-a-base", paidYMD: "2026-09-15", receivedAt: "2026-09-15T06:00:00Z" }),
      row({ dealKey: "order-b-base", paidYMD: "2026-09-16", receivedAt: "2026-09-16T06:00:00Z" }),
    ];
    expect(keys(voucherMates(rows[0], rows, none))).toEqual(["order-a-base"]);
  });

  /**
   * The ordinary case, and the one an exact-timestamp rule would have failed:
   * Accounting pressing "Mark paid" on each row in turn. Different milliseconds,
   * one voucher.
   */
  it("rows marked paid one at a time, minutes apart, are still one voucher", () => {
    const rows = [
      row({ dealKey: "order-a-base", paidYMD: releaseDay("2026-09-15T02:00:00.000Z") }),
      row({ dealKey: "order-b-base", paidYMD: releaseDay("2026-09-15T02:04:31.000Z") }),
    ];
    expect(keys(voucherMates(rows[0], rows, none))).toEqual(["order-a-base", "order-b-base"]);
  });

  /**
   * A payment that straddled two days — released late on the 15th, the last row
   * marked after midnight. Rule 2 can't see them as one; rule 3 can, because
   * neither has been signed for.
   */
  it("a payout still in flight holds together across a day boundary", () => {
    const rows = [
      row({ dealKey: "order-a-base", paidYMD: "2026-09-15" }),
      row({ dealKey: "order-b-base", paidYMD: "2026-09-16" }),
    ];
    expect(keys(voucherMates(rows[0], rows, none))).toEqual(["order-a-base", "order-b-base"]);
  });

  it("but a signed-for row is finished, and is left out of one still in flight", () => {
    const rows = [
      row({ dealKey: "order-a-base", paidYMD: "2026-09-15" }),
      row({ dealKey: "order-b-base", paidYMD: "2026-09-10", receivedAt: "2026-09-11T00:00:00Z" }),
    ];
    expect(keys(voucherMates(rows[0], rows, none))).toEqual(["order-a-base"]);
  });

  /**
   * The owner's screenshot: rows confirmed at 2:14 PM, slip attached afterwards.
   * They were released together, so the slip belongs on all of them.
   */
  it("a whole confirmed release still takes one slip together", () => {
    const at = "2026-09-15";
    const rows = [
      row({ dealKey: "order-a-base", paidYMD: at, receivedAt: "2026-09-15T06:14:00Z" }),
      row({ dealKey: "order-b-base", paidYMD: at, receivedAt: "2026-09-15T06:14:00Z" }),
    ];
    expect(keys(voucherMates(rows[0], rows, none))).toEqual(["order-a-base", "order-b-base"]);
  });
});

describe("the boundaries that hold however the set is chosen", () => {
  it("never somebody else's commission", () => {
    const rows = [
      row({ dealKey: "order-a-base" }),
      row({ dealKey: "order-b-base", salespersonId: "rep-2" }),
    ];
    expect(keys(voucherMates(rows[0], rows, none))).toEqual(["order-a-base"]);
    const v = new Map([["order-a-base", "0000042"], ["order-b-base", "0000042"]]);
    expect(keys(voucherMates(rows[0], rows, v))).toEqual(["order-a-base"]);
  });

  it("never an unpaid row — there is no payment to evidence", () => {
    const rows = [row({ dealKey: "order-a-base" }), row({ dealKey: "order-b-base", paid: false, paidYMD: null })];
    expect(keys(voucherMates(rows[0], rows, none))).toEqual(["order-a-base"]);
  });

  it("and an unpaid target covers nothing at all", () => {
    const t = row({ dealKey: "order-a-base", paid: false, paidYMD: null });
    expect(voucherMates(t, [t], none)).toEqual([]);
  });

  it("the target is in the answer even when it isn't in the list", () => {
    const t = row({ dealKey: "order-a-base" });
    expect(keys(voucherMates(t, [], none))).toEqual(["order-a-base"]);
  });

  it("and is never doubled when it is", () => {
    const rows = [row({ dealKey: "order-a-base" })];
    expect(voucherMates(rows[0], rows, none)).toHaveLength(1);
  });
});

describe("the day a payout was released", () => {
  it("is the Philippine day, not the UTC one", () => {
    // 8:30 AM in Manila on the 16th is still the 15th in UTC.
    expect(releaseDay("2026-09-15T16:30:00.000Z")).toBe("2026-09-16");
  });

  it("agrees with UTC through the working day", () => {
    expect(releaseDay("2026-09-15T02:00:00.000Z")).toBe("2026-09-15");
    expect(releaseDay("2026-09-15T09:59:00.000Z")).toBe("2026-09-15");
  });

  it("and nothing is not a day", () => {
    expect(releaseDay(null)).toBeNull();
    expect(releaseDay("not a date")).toBeNull();
  });
});
