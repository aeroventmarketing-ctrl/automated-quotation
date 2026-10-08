/**
 * Available, Value and Status — the three Inventory figures that are calculated,
 * not stored. The list and the edit panel's live preview both use these, so the
 * preview IS the row that appears after Save.
 *
 * The cases pin the formulas exactly as the list computed them before they were
 * shared, so moving them here changed no figure on anybody's screen.
 */
import { describe, it, expect } from "vitest";
import { stockAvailable, stockValue, stockStatus } from "./stock-figures";

describe("Available", () => {
  it("is on hand less reserved", () => {
    expect(stockAvailable(10, 3)).toBe(7);
  });
  it("can go negative — the list shows it red rather than hiding it", () => {
    expect(stockAvailable(1, 3)).toBe(-2);
  });
  it("does not drift on fractions", () => {
    expect(stockAvailable(0.3, 0.1)).toBe(0.2);
  });
});

describe("Value", () => {
  it("is on hand at unit cost, to the centavo", () => {
    expect(stockValue(3, 325)).toBe(975);
    expect(stockValue(1.5, 0.333)).toBe(0.5);
  });
  it("is nothing when nothing is on hand", () => {
    expect(stockValue(0, 325)).toBe(0);
  });
});

describe("Status", () => {
  it("Out at zero, and below — whatever the reorder level", () => {
    expect(stockStatus(0, 0)).toBe("out");
    expect(stockStatus(0, 5)).toBe("out");
    expect(stockStatus(-1, 0)).toBe("out");
  });
  it("Low at or under the reorder level", () => {
    expect(stockStatus(5, 5)).toBe("low");
    expect(stockStatus(2, 5)).toBe("low");
  });
  it("OK above it, or when no reorder level is set", () => {
    expect(stockStatus(6, 5)).toBe("ok");
    expect(stockStatus(1, 0)).toBe("ok");
  });
  it("is measured on ON HAND — a reserved unit is still on the shelf", () => {
    // 4 on hand, 4 reserved, reorder 2: available is 0, but the status is OK.
    expect(stockAvailable(4, 4)).toBe(0);
    expect(stockStatus(4, 2)).toBe("ok");
  });
});
