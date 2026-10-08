/**
 * Typing a new Reserved figure on the Inventory list.
 *
 * The owner chose **"Correction entry"**: raising it adds a reservation named
 * "Inventory correction"; lowering it releases the corrections first, then the
 * OLDEST real reservations, and never just overwrites the total — the
 * reservations are what tie the stock to the orders holding it.
 */
import { describe, it, expect } from "vitest";
import { planReservedCorrection, CORRECTION_REF, NO_CHANGE } from "./reserved-correction";

const d = (day: number) => new Date(2026, 9, day);
const JO1 = { id: "jo1", qty: 3, forRef: "AFBM00003128J", createdAt: d(1) };
const JO2 = { id: "jo2", qty: 2, forRef: "AFBM00003494J", createdAt: d(3) };
const FIX_OLD = { id: "fix-old", qty: 1, forRef: CORRECTION_REF, createdAt: d(2) };
const FIX_NEW = { id: "fix-new", qty: 4, forRef: CORRECTION_REF, createdAt: d(5) };

describe("leaving it where it is", () => {
  it("changes nothing", () => {
    expect(planReservedCorrection([JO1, JO2], 5)).toEqual(NO_CHANGE);
  });
});

describe("raising Reserved", () => {
  it("adds ONE correction reservation for exactly the difference", () => {
    expect(planReservedCorrection([JO1, JO2], 8)).toEqual({ add: 3, release: [], reduce: null });
  });

  it("works from nothing reserved", () => {
    expect(planReservedCorrection([], 2.5)).toEqual({ add: 2.5, release: [], reduce: null });
  });

  it("never touches the orders' own reservations", () => {
    const plan = planReservedCorrection([JO1, JO2], 10);
    expect(plan.release).toEqual([]);
    expect(plan.reduce).toBeNull();
  });
});

describe("lowering Reserved", () => {
  it("releases correction entries before any order's reservation — newest correction first", () => {
    // 3 + 2 + 1 + 4 = 10 → 5: both corrections (5) go, no order is touched.
    const plan = planReservedCorrection([JO1, JO2, FIX_OLD, FIX_NEW], 5);
    expect(plan).toEqual({ add: 0, release: ["fix-new", "fix-old"], reduce: null });
  });

  it("then the OLDEST order reservation", () => {
    // 3 + 2 = 5 → 2: JO1 (oldest, 3) goes entirely.
    expect(planReservedCorrection([JO2, JO1], 2)).toEqual({ add: 0, release: ["jo1"], reduce: null });
  });

  it("reduces the last one in place rather than releasing more than asked", () => {
    // 5 → 4: one unit off the oldest, which keeps its order reference.
    expect(planReservedCorrection([JO1, JO2], 4)).toEqual({ add: 0, release: [], reduce: { id: "jo1", from: 3, to: 2 } });
  });

  it("mixes the two: a correction released, then part of an order", () => {
    // 3 + 2 + 4 = 9 → 3: fix-new (4) released, then 2 off JO1 (3 → 1).
    expect(planReservedCorrection([JO1, JO2, FIX_NEW], 3)).toEqual({
      add: 0,
      release: ["fix-new"],
      reduce: { id: "jo1", from: 3, to: 1 },
    });
  });

  it("to zero releases everything", () => {
    const plan = planReservedCorrection([JO1, JO2, FIX_OLD], 0);
    expect(plan.release.sort()).toEqual(["fix-old", "jo1", "jo2"]);
    expect(plan.reduce).toBeNull();
  });

  it("handles fractional quantities without drift", () => {
    const a = { id: "a", qty: 0.1, forRef: "X", createdAt: d(1) };
    const b = { id: "b", qty: 0.2, forRef: "Y", createdAt: d(2) };
    expect(planReservedCorrection([a, b], 0.2)).toEqual({ add: 0, release: ["a"], reduce: null });
  });
});

describe("refused", () => {
  it("a negative figure", () => {
    expect(() => planReservedCorrection([JO1], -1)).toThrow(/negative/);
  });
  it("something that is not a number", () => {
    expect(() => planReservedCorrection([JO1], Number.NaN)).toThrow();
  });
});
