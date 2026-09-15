import { describe, it, expect } from "vitest";
import { alertPasses, alertsSuppressedNow, DEFAULT_GOLIVE_AT, type AlertGoLive } from "./alert-golive";

/**
 * The testing stage, and what may never come out of it.
 *
 * The owner, 15 September 2026: *"Transactions before August 1, 2026 should not
 * give any alarm or notifications. Date before the said day is a testing stage."*
 *
 * The gate's default is exactly that moment — 1 Aug 2026, 05:00 Manila — so this
 * is mostly a rule about which TIMESTAMP each surface hands it. Every alert has
 * two: when the thing happened, and when someone last touched it. Judging by the
 * second is what let a July practice order ring the alarm in September: press one
 * button on it and it is "pending since September".
 */
describe("the alerts go-live gate", () => {
  const gate: AlertGoLive = { on: true, at: DEFAULT_GOLIVE_AT };

  it("defaults to 1 August 2026, 05:00 Manila", () => {
    // 2026-07-31T21:00Z is 2026-08-01 05:00 at UTC+8.
    expect(DEFAULT_GOLIVE_AT).toBe("2026-07-31T21:00:00.000Z");
    const manila = new Date(DEFAULT_GOLIVE_AT).toLocaleString("en-CA", { timeZone: "Asia/Manila", hour12: false });
    expect(manila).toMatch(/^2026-08-01/);
  });

  it("a transaction from the testing stage never alarms", () => {
    expect(alertPasses("2026-07-15T02:00:00.000Z", gate)).toBe(false);
    expect(alertPasses("2026-07-31T20:59:59.000Z", gate)).toBe(false);
  });

  it("a transaction after the launch moment does", () => {
    expect(alertPasses("2026-08-01T01:00:00.000Z", gate)).toBe(true);
  });

  /**
   * The case the fix is about. A July order stamped in September passes on the
   * stamp and fails on its own date — so a surface must ask about BOTH, and act
   * only when both agree.
   */
  it("a July transaction touched in September: the stamp passes, the transaction does not", () => {
    const stampedAt = "2026-09-15T02:00:00.000Z";
    const raisedAt = "2026-07-20T02:00:00.000Z";
    expect(alertPasses(stampedAt, gate)).toBe(true);
    expect(alertPasses(raisedAt, gate)).toBe(false);
    // Both must pass, which is how every alert surface now asks it.
    expect(alertPasses(stampedAt, gate) && alertPasses(raisedAt, gate)).toBe(false);
  });

  it("with the gate off, everything passes — the switch still means what it says", () => {
    const off: AlertGoLive = { on: false, at: DEFAULT_GOLIVE_AT };
    expect(alertPasses("2026-07-15T02:00:00.000Z", off)).toBe(true);
  });

  /**
   * A surface with no date to offer is not silenced — better a stray alert than a
   * silent one. Which is exactly why the surfaces that DO have a date must pass
   * it: `undefined` is a free pass.
   */
  it("no timestamp is a free pass, so a surface that has one must hand it over", () => {
    expect(alertPasses(undefined, gate)).toBe(true);
    expect(alertPasses(null, gate)).toBe(true);
    expect(alertPasses("not a date", gate)).toBe(true);
  });

  it("before the launch moment, nothing shows at all", () => {
    expect(alertsSuppressedNow(gate, new Date("2026-07-20T00:00:00Z"))).toBe(true);
    expect(alertsSuppressedNow(gate, new Date("2026-09-15T00:00:00Z"))).toBe(false);
  });
});
