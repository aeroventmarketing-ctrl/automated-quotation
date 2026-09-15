import { describe, it, expect } from "vitest";
import { isDueForCheckIn } from "./marketing";

/**
 * The automatic check-in's two gates: not more often than every `everyDays`, and
 * never more than `maxNudges` times in all.
 *
 * On 14 September 2026 a client received this email **every hour for a day**.
 * Neither gate was wrong — both read the same record of what had already been
 * sent, and that record was being erased between runs by a concurrent writer of
 * the account registry (see `updateAccountsRegistry`). The rule is pinned here so
 * the two halves can never drift apart, and because the failure it guards is one
 * that reaches a client's inbox rather than a screen.
 */
describe("isDueForCheckIn", () => {
  const cfg = { everyDays: 30, maxNudges: 12 };
  const now = new Date("2026-09-15T02:00:00Z");
  const daysAgo = (n: number) => ({ at: new Date(now.getTime() - n * 86_400_000).toISOString() });

  it("a client never mailed is due", () => {
    expect(isDueForCheckIn([], now, cfg)).toBe(true);
  });

  it("an hour after the last one, it is not", () => {
    expect(isDueForCheckIn([{ at: new Date(now.getTime() - 3_600_000).toISOString() }], now, cfg)).toBe(false);
  });

  it("29 days later it is still not due; 30 days later it is", () => {
    expect(isDueForCheckIn([daysAgo(29)], now, cfg)).toBe(false);
    expect(isDueForCheckIn([daysAgo(30)], now, cfg)).toBe(true);
  });

  it("the cap is final — twelve sent, nothing more, however long ago", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => daysAgo(400 - i * 30));
    expect(isDueForCheckIn(twelve, now, cfg)).toBe(false);
    expect(isDueForCheckIn(twelve.slice(0, 11), now, cfg)).toBe(true);
  });

  it("reads the LAST stamp, not the first — order of the record decides nothing else", () => {
    // Eleven old sends and one an hour ago: under the cap, but far too soon.
    const history = [...Array.from({ length: 11 }, (_, i) => daysAgo(400 - i * 30))];
    expect(isDueForCheckIn(history, now, cfg)).toBe(true);
    expect(isDueForCheckIn([...history.slice(0, 10), { at: new Date(now.getTime() - 3_600_000).toISOString() }], now, cfg)).toBe(false);
  });

  /**
   * The safe direction for an unreadable stamp is silence. A record we cannot
   * date is still evidence that something WAS sent, and treating it as "never
   * mailed" is how one bad row turns into an hourly email.
   */
  it("an unreadable stamp means do not send", () => {
    expect(isDueForCheckIn([{ at: "not a date" }], now, cfg)).toBe(false);
  });

  it("a cap of zero sends nothing at all", () => {
    expect(isDueForCheckIn([], now, { everyDays: 30, maxNudges: 0 })).toBe(false);
  });
});
