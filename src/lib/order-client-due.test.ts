import { describe, it, expect } from "vitest";
import { readClientDue, isYMD } from "./order-client-due";

describe("the order's Client Due Date", () => {
  it("reads what was saved", () => {
    expect(readClientDue({ clientDue: { date: "2026-11-20", byName: "Sam Sales", at: "2026-10-14T02:00:00.000Z" } })).toEqual({
      date: "2026-11-20", byName: "Sam Sales", at: "2026-10-14T02:00:00.000Z",
    });
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
});
