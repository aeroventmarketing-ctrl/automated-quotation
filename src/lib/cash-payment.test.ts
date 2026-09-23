import { describe, it, expect } from "vitest";
import { coerceCashPayment, isPaidInCash } from "./cash-payment";

/**
 * Reading a stored cash payment back.
 *
 * Strict about the DATE, forgiving about everything else — the date is what the
 * register renders and sorts by, so a bad one is not a cosmetic problem, it is a
 * row that would sort wrongly and print blank in the Cleared tab.
 */
describe("coerceCashPayment", () => {
  const good = { on: "2026-09-04", byName: "Michelle Cotura", at: "2026-09-04T09:00:00.000Z" };

  it("reads a payment back whole", () => {
    expect(coerceCashPayment(good)).toEqual(good);
  });

  it("keeps a note, trimmed, and drops an empty one", () => {
    expect(coerceCashPayment({ ...good, note: "  Petty cash  " })?.note).toBe("Petty cash");
    expect(coerceCashPayment({ ...good, note: "   " })).not.toHaveProperty("note");
  });

  /** Null is "not paid in cash", which is almost every purchase in the system. */
  it("says null for anything that is not a payment", () => {
    for (const v of [null, undefined, "", 0, [], "2026-09-04", {}]) {
      expect(coerceCashPayment(v)).toBeNull();
    }
  });

  /**
   * A malformed date is a REFUSAL, not a blank field. Without this the row
   * reaches the Cleared tab dated nothing, sorting ahead of everything, with no
   * hint that a payment was recorded badly.
   */
  it("refuses a date it cannot use", () => {
    for (const on of ["", "04/09/2026", "2026-9-4", "not a date", "20260904"]) {
      expect(coerceCashPayment({ ...good, on })).toBeNull();
    }
  });

  it("takes the date off a full timestamp", () => {
    expect(coerceCashPayment({ ...good, on: "2026-09-04T09:00:00.000Z" })?.on).toBe("2026-09-04");
  });

  it("survives a missing name — nobody recorded it is not nothing happened", () => {
    const r = coerceCashPayment({ on: "2026-09-04" });
    expect(r).not.toBeNull();
    expect(r!.byName).toBe("");
    expect(r!.at).toBe("");
  });

  it("isPaidInCash agrees with it", () => {
    expect(isPaidInCash(good)).toBe(true);
    expect(isPaidInCash(null)).toBe(false);
    expect(isPaidInCash({ ...good, on: "nope" })).toBe(false);
  });
});
