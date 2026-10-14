import { describe, it, expect } from "vitest";
import { readClientDue, isYMD, describeClientDueChange } from "./order-client-due";

describe("the order's Client Due Date", () => {
  it("reads the date and its history", () => {
    expect(
      readClientDue({
        clientDue: {
          date: "2026-11-20", byName: "Sam Sales", at: "2026-10-14T02:00:00.000Z",
          history: [{ from: "2026-11-15", to: "2026-11-20", byName: "Sam Sales", at: "2026-10-14T02:00:00.000Z" }],
        },
      }),
    ).toEqual({
      date: "2026-11-20", byName: "Sam Sales", at: "2026-10-14T02:00:00.000Z",
      history: [{ from: "2026-11-15", to: "2026-11-20", byName: "Sam Sales", at: "2026-10-14T02:00:00.000Z" }],
    });
  });
  it("cleared, the history survives", () => {
    const r = readClientDue({ clientDue: { date: "", byName: "Ana", at: "x", history: [{ from: "2026-11-20", to: "", byName: "Ana", at: "x" }] } });
    expect(r?.date).toBeNull();
    expect(r?.history).toHaveLength(1);
  });
  it("nothing saved, or something malformed → none", () => {
    expect(readClientDue({})).toBeNull();
    expect(readClientDue(null)).toBeNull();
    expect(readClientDue({ clientDue: { date: "20 Nov" } })).toBeNull();
  });
  it("a date must be a real YYYY-MM-DD", () => {
    expect(isYMD("2026-11-20")).toBe(true);
    expect(isYMD("2026-13-01")).toBe(false);
    expect(isYMD("")).toBe(false);
  });
  it("describes each change in words", () => {
    const f = (s: string) => s;
    expect(describeClientDueChange({ from: "", to: "2026-11-20" }, f)).toBe("Set to 2026-11-20");
    expect(describeClientDueChange({ from: "2026-11-20", to: "" }, f)).toBe("Cleared (was 2026-11-20)");
    expect(describeClientDueChange({ from: "2026-11-15", to: "2026-11-20" }, f)).toBe("2026-11-15 → 2026-11-20");
  });
});
